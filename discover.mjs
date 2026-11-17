#!/usr/bin/env node
// Lists the token issuances that the standard ERC-3643 factory event announces. Read-only.
// Usage: node discover.mjs <list.json> [--meta data/discovery.json] [--rpc polygon=URL --rpc ethereum=URL] [--chunk 0] [--min-window 1000]
//
// Event: TREXSuiteDeployed(address indexed _token, address _ir, address _irs, address _tir, address _ctr, address _mc, string indexed _salt)
// Every contract that emits this event counts as a factory. Anyone can deploy one, so the list includes test and hobby deployments.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const TOPIC0 = "0x057adae5fa3e9caa8a0d584edff60f61558d33f073412ec2d66d558b739e0a41";
export const EVENT_SIGNATURE = "TREXSuiteDeployed(address,address,address,address,address,address,string)";
// Public gateways that return the full log history of a topic in one call. They can change or disappear; pass --rpc to use another.
export const DEFAULT_LOG_RPC = {
  polygon: "https://gateway.tenderly.co/public/polygon",
  ethereum: "https://gateway.tenderly.co/public/mainnet",
};

export async function rpc(url, method, params, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(90000) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || "rpc error");
      return j.result;
    } catch (e) {
      last = e;
      await new Promise((ok) => setTimeout(ok, 300 * 2 ** i));
    }
  }
  throw last;
}

/** Scans [from, to]. chunk 0 asks for the whole range at once; on an error the range is split until minWindow. */
export async function scanLogs(url, from, to, { chunk = 0, minWindow = 1000, tries = 3, topic = TOPIC0 } = {}) {
  const hex = (n) => "0x" + n.toString(16);
  const one = (a, b) => rpc(url, "eth_getLogs", [{ topics: [topic], fromBlock: hex(a), toBlock: hex(b) }], tries);
  const out = [];
  const range = async (a, b) => {
    try {
      out.push(...(await one(a, b)));
    } catch (e) {
      if (b - a + 1 <= minWindow) throw new Error(`eth_getLogs failed for blocks ${a}-${b}: ${e.message}`);
      const m = Math.floor((a + b) / 2);
      await range(a, m);
      await range(m + 1, b);
    }
  };
  if (chunk > 0) for (let a = from; a <= to; a += chunk) await range(a, Math.min(a + chunk - 1, to));
  else await range(from, to);
  return out;
}

export async function discover(rpcUrls = DEFAULT_LOG_RPC, { from = 0, chunk = 0, minWindow = 1000, tries = 3 } = {}) {
  const list = [];
  const meta = { event: EVENT_SIGNATURE, topic0: TOPIC0, scanned_at: new Date().toISOString(), nets: {} };
  for (const [net, url] of Object.entries(rpcUrls)) {
    const to = parseInt(await rpc(url, "eth_blockNumber", []), 16);
    const logs = await scanLogs(url, from, to, { chunk, minWindow, tries });
    const seen = new Set();
    let dup = 0;
    for (const l of logs) {
      const token = "0x" + String(l.topics?.[1] ?? "").slice(26).toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(token)) continue;
      if (seen.has(token)) { dup++; continue; }
      seen.add(token);
      list.push({ net, token, factory: String(l.address).toLowerCase(), block: parseInt(l.blockNumber, 16) });
    }
    const mine = list.filter((t) => t.net === net);
    meta.nets[net] = { from_block: from, to_block: to, events: logs.length, duplicates_skipped: dup, unique_tokens: mine.length, distinct_factories: new Set(mine.map((t) => t.factory)).size };
  }
  list.sort((a, b) => (a.net + a.token).localeCompare(b.net + b.token));
  return { list, meta };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const listPath = a[0];
  if (!listPath || listPath.startsWith("--")) { console.error("Usage: node discover.mjs <list.json> [--meta data/discovery.json] [--rpc net=URL] [--chunk N] [--min-window N]"); process.exit(2); }
  const urls = { ...DEFAULT_LOG_RPC };
  for (let i = 0; i < a.length; i++) if (a[i] === "--rpc") { const [n, u] = String(a[++i]).split(/=(.*)/s); urls[n] = u; }
  const opt = (name, def) => (a.includes(name) ? Number(a[a.indexOf(name) + 1]) : def);
  const { list, meta } = await discover(urls, { chunk: opt("--chunk", 0), minWindow: opt("--min-window", 1000) });
  mkdirSync(dirname(listPath), { recursive: true });
  writeFileSync(listPath, JSON.stringify(list));
  if (a.includes("--meta")) { const p = a[a.indexOf("--meta") + 1]; mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(meta, null, 1) + "\n"); }
  console.log(JSON.stringify(meta.nets, null, 1));
  console.log(`${list.length} tokens written to ${listPath}`);
}

#!/usr/bin/env node
// Counts who controls a list of ERC-3643 tokens. Read-only.
// Usage: node census.mjs <list.json> <outdir> [--rpc polygon=URL --rpc ethereum=URL] [--readme README.md]
// list.json: [{ "net": "polygon", "token": "0x..", "factory": "0x.." }, ...]   (data/tokens.json works too)
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { chartSvg } from "./lib/chart.mjs";
import { csvText } from "./lib/csv.mjs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { makeChain } from "./lib/chain.mjs";
import { SEL, decString, decUint, decBool, decAddress, decArrayLength } from "./lib/abi.mjs";
import { classify, ZERO, DEAD } from "./lib/classify.mjs";
import { summarize, headline, isActive, readableText } from "./lib/summary.mjs";
import { discarded, NUMBERS_RE, SUMMARY_RE } from "./lib/validate.mjs";

export const DEFAULT_RPC = {
  polygon: "https://polygon-bor-rpc.publicnode.com",
  ethereum: "https://ethereum-rpc.publicnode.com",
};
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const pool = async (items, n, fn) => {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
};
const chunks = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

export async function runCensus(list, rpcUrls = DEFAULT_RPC, { log = () => {}, chainOptions = {} } = {}) {
  const started = new Date().toISOString();
  const meta = { duplicates_skipped: 0, invalid_address_skipped: 0, transport_failures: 0, block_start: {}, block_end: {} };
  const seen = new Set();
  const input = [];
  for (const t of list) {
    if (!t || !ADDRESS.test(String(t.token)) || !rpcUrls[t.net]) { meta.invalid_address_skipped++; continue; }
    const k = t.net + ":" + t.token.toLowerCase();
    if (seen.has(k)) { meta.duplicates_skipped++; continue; }
    seen.add(k);
    input.push({ net: t.net, token: t.token.toLowerCase(), factory: String(t.factory || "").toLowerCase() });
  }
  const rows = [];
  for (const net of Object.keys(rpcUrls)) {
    const toks = input.filter((t) => t.net === net);
    if (!toks.length) continue;
    const ch = makeChain(rpcUrls[net], chainOptions);
    meta.block_start[net] = await ch.blockNumber();
    // round 1: properties of the tokens
    const calls = [];
    for (const t of toks) for (const f of ["symbol", "totalSupply", "paused", "owner"]) calls.push({ target: t.token, data: SEL[f] });
    const res = (await pool(chunks(calls, 200), 3, (d) => ch.multicall(d))).flat();
    toks.forEach((t, i) => {
      const [s, su, p, o] = res.slice(i * 4, i * 4 + 4);
      t.symbol = s.ok ? decString(s.data) ?? null : null;
      t.supply = su.ok ? decUint(su.data)?.toString() ?? null : null;
      t.paused = p.ok ? decBool(p.data) ?? null : null;
      t.owner = o.ok ? decAddress(o.data) ?? null : null;
      t.readable = t.symbol !== null || t.supply !== null || t.owner !== null;
    });
    // next rounds: the owners, and the owners of owners
    const code = new Map(), safe = new Map(), tl = new Set(), own = new Map(), delegated = new Set();
    let front = [...new Set(toks.map((t) => t.owner).filter((a) => a && a !== ZERO && a !== DEAD))];
    for (let depth = 0; depth < 6 && front.length; depth++) {
      const fresh = front.filter((a) => !code.has(a));
      const cm = await ch.codes(fresh);
      for (const [a, c] of cm) { code.set(a, c.size); if (c.delegated) delegated.add(a); }
      const contracts = fresh.filter((a) => (code.get(a) || 0) > 0);
      const cc = [];
      for (const a of contracts) for (const f of ["getThreshold", "getOwners", "getMinDelay", "owner"]) cc.push({ target: a, data: SEL[f] });
      const rr = (await pool(chunks(cc, 200), 3, (d) => ch.multicall(d))).flat();
      const next = new Set();
      contracts.forEach((a, i) => {
        const [th, ow, md, on] = rr.slice(i * 4, i * 4 + 4);
        const thr = th.ok ? decUint(th.data) : undefined;
        const n = ow.ok ? decArrayLength(ow.data) : undefined;
        if (thr !== undefined && n !== undefined) safe.set(a, { threshold: Number(thr), n });
        else if (md.ok) tl.add(a);
        else if (on.ok) {
          const x = decAddress(on.data);
          if (x) { own.set(a, x); if (!code.has(x) && x !== ZERO && x !== DEAD) next.add(x); }
        }
      });
      front = [...next];
    }
    const W = { code: (a) => code.get(a), safe: (a) => safe.get(a) || null, timelock: (a) => tl.has(a), owner: (a) => own.get(a) || null };
    for (const t of toks) {
      const r = { net: t.net, token: t.token, factory: t.factory, symbol: t.symbol, supply: t.supply, paused: t.paused, owner: t.owner, type: null, controller: null, chain: [], detail: null, e7702: false };
      if (!t.readable) r.type = "unreadable";
      else {
        const c = classify(t.token, t.owner, W);
        r.type = c.type; r.chain = c.chain; r.controller = c.controller || null; r.detail = c.detail || null;
        r.e7702 = r.controller ? delegated.has(r.controller) : false;
      }
      r.active = isActive(r);
      rows.push(r);
    }
    meta.block_end[net] = await ch.blockNumber();
    meta.transport_failures += ch.stats.transportFailures;
    log(`${net}: ${toks.length} tokens, ${ch.stats.transportFailures} transport failures`);
  }
  rows.sort((a, b) => (a.net + a.token).localeCompare(b.net + b.token));
  return { rows, meta: { ...meta, started, finished: new Date().toISOString(), list_lines: list.length, unique: input.length } };
}

/** Puts the NUMBERS block, the sentences and the fingerprint in the README on the new values. */
export function updateReadme(readmePath, rows, meta, hash) {
  let t = readFileSync(readmePath, "utf8");
  const s = summarize(rows);
  t = t.replace(NUMBERS_RE, `<!--NUMBERS ${JSON.stringify({ ...headline(s), discarded: discarded(rows, meta) })} -->`);
  t = t.replace(SUMMARY_RE, `<!--SUMMARY-->\n${readableText(s, meta)}\n<!--/SUMMARY-->`);
  t = t.replace(/(Data fingerprint \(sha256 of data\/tokens\.json\): `)[0-9a-f]*(`)/, `$1${hash}$2`);
  writeFileSync(readmePath, t);
}

// A file is written next to its target and renamed, so a crash never leaves a half-written file behind.
function atomicWrite(path, text) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function writeOutput(outDir, rows, meta) {
  mkdirSync(outDir, { recursive: true });
  // Token symbols are not published: they would make single issuers easy to pick out of a list of addresses.
  rows = rows.map(({ symbol, ...rest }) => rest);
  const tokensText = JSON.stringify(rows, null, 1) + "\n";
  const summary = summarize(rows);
  const hash = createHash("sha256").update(tokensText).digest("hex");
  atomicWrite(outDir + "/tokens.json", tokensText);
  atomicWrite(outDir + "/summary.json", JSON.stringify({ measured: meta, summary }, null, 1) + "\n");
  atomicWrite(outDir + "/SHA256SUMS", `${hash}  tokens.json\n`);
  const assets = join(dirname(resolve(outDir)), "assets");
  mkdirSync(assets, { recursive: true });
  atomicWrite(assets + "/key-control.svg", chartSvg(summary));
  atomicWrite(outDir + "/tokens.csv", csvText(rows));
  return { hash, headline: headline(summarize(rows)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , listPath, outDir, ...rest] = process.argv;
  if (!listPath || !outDir) { console.error("Usage: node census.mjs <list.json> <outdir> [--rpc net=URL] [--readme README.md]"); process.exit(2); }
  const rpcUrls = { ...DEFAULT_RPC };
  for (let i = 0; i < rest.length; i++) if (rest[i] === "--rpc") { const [n, u] = String(rest[++i]).split(/=(.*)/s); rpcUrls[n] = u; }
  const list = JSON.parse(readFileSync(listPath, "utf8"));
  const { rows, meta } = await runCensus(list, rpcUrls, { log: console.log });
  const out = writeOutput(outDir, rows, meta);
  if (rest.includes("--readme")) updateReadme(rest[rest.indexOf("--readme") + 1], rows, meta, out.hash);
  console.log(JSON.stringify(out.headline, null, 1));
  console.log("discarded or skipped: " + JSON.stringify(discarded(rows, meta)));
}

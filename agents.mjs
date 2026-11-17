#!/usr/bin/env node
// Reads who holds the agent role of every token in data/tokens.json, classifies each agent, and writes
// data/agents.json and data/agents-summary.json. Read-only: public logs and eth_call / eth_getCode only.
// Usage: node agents.mjs <tokens.json> <outdir> [--log-rpc net=URL] [--rpc net=URL] [--readme README.md]
//
// Events (T-REX AgentRoleUpgradeable): AgentAdded(address indexed _agent), AgentRemoved(address indexed _agent).
// Only the agents of the token contract itself are read. Agents of the identity registry are not.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { makeChain } from "./lib/chain.mjs";
import { classify } from "./lib/classify.mjs";
import { ADDED_TOPIC, REMOVED_TOPIC, reduceAgentLogs, rowLevel, summarizeAgents, headlineAgents, agentText } from "./lib/agents.mjs";
import { AGENT_NUMBERS_RE, AGENT_SUMMARY_RE, AGENT_FINGERPRINT_RE } from "./lib/validate-agents.mjs";
import { DEFAULT_LOG_RPC, scanLogs, rpc as logRpc } from "./discover.mjs";
import { DEFAULT_RPC, resolveWorld } from "./census.mjs";

function atomicWrite(path, text) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export async function runAgents(ownerRows, { logUrls = DEFAULT_LOG_RPC, rpcUrls = DEFAULT_RPC, log = () => {}, scan = scanLogs } = {}) {
  const started = new Date().toISOString();
  const measured = { log_source: logUrls, to_block: {}, events: { added: 0, removed: 0, duplicate_adds: 0, unmatched_removes: 0 }, transport_failures: 0 };
  const out = [];
  for (const net of Object.keys(logUrls)) {
    const toks = ownerRows.filter((r) => r.net === net);
    if (!toks.length) continue;
    const to = parseInt(await logRpc(logUrls[net], "eth_blockNumber", []), 16);
    measured.to_block[net] = to;
    const logs = [...(await scan(logUrls[net], 0, to, { topic: ADDED_TOPIC })), ...(await scan(logUrls[net], 0, to, { topic: REMOVED_TOPIC }))];
    const { agents, counts } = reduceAgentLogs(logs, new Set(toks.map((t) => t.token)));
    for (const k of Object.keys(counts)) measured.events[k] += counts[k];
    const ch = makeChain(rpcUrls[net]);
    const all = [...new Set([...agents.values()].flat())];
    const { W } = await resolveWorld(ch, all);
    for (const t of toks) {
      const list = (agents.get(t.token) || []).map((address) => {
        const c = classify(t.token, address, W);
        return { address, type: c.type, controller: c.controller || null, detail: c.detail || null };
      });
      const row = { net, token: t.token, active: t.active, owner_type: t.type, agents: list, level: null };
      row.level = rowLevel(row);
      out.push(row);
    }
    measured.transport_failures += ch.stats.transportFailures;
    log(`${net}: ${toks.length} tokens, ${logs.length} agent events scanned, ${all.length} distinct agents, ${ch.stats.transportFailures} transport failures`);
  }
  out.sort((a, b) => (a.net + a.token).localeCompare(b.net + b.token));
  return { rows: out, measured: { ...measured, started, finished: new Date().toISOString() } };
}

export function updateAgentReadme(readmePath, summary, measured, hash) {
  let t = readFileSync(readmePath, "utf8");
  t = t.replace(AGENT_NUMBERS_RE, `<!--AGENTNUMBERS ${JSON.stringify(headlineAgents(summary))} -->`);
  t = t.replace(AGENT_SUMMARY_RE, `<!--AGENTSUMMARY-->\n${agentText(summary, measured)}\n<!--/AGENTSUMMARY-->`);
  t = t.replace(AGENT_FINGERPRINT_RE, `$1${hash}$2`);
  writeFileSync(readmePath, t);
}

export function writeAgentOutput(outDir, rows, measured) {
  mkdirSync(outDir, { recursive: true });
  const text = JSON.stringify(rows, null, 1) + "\n";
  const summary = summarizeAgents(rows);
  const hash = createHash("sha256").update(text).digest("hex");
  atomicWrite(outDir + "/agents.json", text);
  atomicWrite(outDir + "/agents-summary.json", JSON.stringify({ measured, summary }, null, 1) + "\n");
  // the line for tokens.json stays; the line for agents.json is replaced
  let sums = "";
  try { sums = readFileSync(outDir + "/SHA256SUMS", "utf8"); } catch { /* first run */ }
  const kept = sums.split("\n").filter((l) => l.trim() && !/\sagents\.json\s*$/.test(l));
  atomicWrite(outDir + "/SHA256SUMS", [...kept, `${hash}  agents.json`].join("\n") + "\n");
  return { hash, summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , listPath, outDir, ...rest] = process.argv;
  if (!listPath || !outDir) { console.error("Usage: node agents.mjs <tokens.json> <outdir> [--log-rpc net=URL] [--rpc net=URL] [--readme README.md]"); process.exit(2); }
  const logUrls = { ...DEFAULT_LOG_RPC }, rpcUrls = { ...DEFAULT_RPC };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--log-rpc") { const [n, u] = String(rest[++i]).split(/=(.*)/s); logUrls[n] = u; }
    if (rest[i] === "--rpc") { const [n, u] = String(rest[++i]).split(/=(.*)/s); rpcUrls[n] = u; }
  }
  const ownerRows = JSON.parse(readFileSync(listPath, "utf8"));
  const { rows, measured } = await runAgents(ownerRows, { logUrls, rpcUrls, log: console.log });
  const { hash, summary } = writeAgentOutput(outDir, rows, measured);
  if (rest.includes("--readme")) updateAgentReadme(rest[rest.indexOf("--readme") + 1], summary, measured, hash);
  console.log(JSON.stringify(headlineAgents(summary), null, 1));
  console.log("events: " + JSON.stringify(measured.events));
}

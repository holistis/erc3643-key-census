#!/usr/bin/env node
// Recount. Usage:
//   node check.mjs                                  recount the data without a network (exit 0 green, 1 red)
//   node check.mjs --selftest                       plant errors in a copy and require every one to be caught
//   node check.mjs --verify-chain [--sample 200] [--strict]   re-measure a deterministic sample from the chains (type and controller)
//   node check.mjs --verify-agents [--sample 300] [--strict]   ask each token contract itself isAgent(address) for a deterministic sample of listed agents
//   node check.mjs --compare <tokens.json>          compare data/tokens.json with a full recount you made yourself
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkAll, discarded, NUMBERS_RE, SUMMARY_RE } from "./lib/validate.mjs";
import { summarize, headline, readableText } from "./lib/summary.mjs";
import { chartSvg } from "./lib/chart.mjs";
import { csvText } from "./lib/csv.mjs";
import { compareRows, verifyVerdict } from "./lib/compare.mjs";
import { runCensus, DEFAULT_RPC } from "./census.mjs";
import { makeChain } from "./lib/chain.mjs";
import { decBool } from "./lib/abi.mjs";
import { summarizeAgents, headlineAgents, agentText, rowLevel } from "./lib/agents.mjs";
import { AGENT_NUMBERS_RE, AGENT_SUMMARY_RE, AGENT_FINGERPRINT_RE } from "./lib/validate-agents.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const IS_AGENT = "0x1ffbb064"; // selector of isAgent(address)
const FILES = ["data/tokens.json", "data/summary.json", "data/SHA256SUMS", "data/discovery.json", "data/tokens.csv", "data/agents.json", "data/agents-summary.json", "history/series.csv", "history/latest.json", "README.md", "assets/key-control.svg"];

/** The mutation matrix: change, remove, add, duplicate, swap, empty, truncate, variant. */
export function mutations(baseTokens) {
  const edit = (fn) => (f) => { const rows = JSON.parse(baseTokens); fn(rows); f["data/tokens.json"] = JSON.stringify(rows, null, 1) + "\n"; };
  const find = (rows, fn) => rows.findIndex(fn);
  return [
    ["fake id (invalid address)", edit((r) => { r[r.length - 1].token = "0x123"; })],
    ["flipped statement (type changed)", edit((r) => { r[find(r, (x) => x.type === "account_direct")].type = "safe_multisig"; })],
    ["omission (one row removed from a non-empty list)", edit((r) => { r.splice(Math.floor(r.length / 2), 1); })],
    ["duplicate (row repeated)", edit((r) => { r.push(JSON.parse(JSON.stringify(r[0]))); })],
    ["emptied (empty list)", (f) => { f["data/tokens.json"] = "[]\n"; }],
    ["truncated (half of the json)", (f) => { f["data/tokens.json"] = f["data/tokens.json"].slice(0, Math.floor(f["data/tokens.json"].length / 2)); }],
    ["swapped (owner and controller)", edit((r) => { const i = find(r, (x) => x.type === "account_via_contract"); if (i >= 0) { const x = r[i]; [x.owner, x.controller] = [x.controller, x.owner]; } else r[0].owner = r[1].token; })],
    ["variant (upper-case address)", edit((r) => { r[0].token = "0x" + r[0].token.slice(2).toUpperCase(); })],
    ["added (new row, summary not updated)", edit((r) => { const x = JSON.parse(JSON.stringify(r[0])); x.token = "0x" + "ab".repeat(20); r.push(x); })],
    ["invalid type", edit((r) => { r[0].type = "secret"; })],
    ["owner missing on account_direct", edit((r) => { r[find(r, (x) => x.type === "account_direct")].owner = null; })],
    ["unknown network", edit((r) => { r[0].net = "solana"; })],
    ["active flag flipped", edit((r) => { r[find(r, (x) => x.active === true)].active = false; })],
    ["supply changed (active no longer follows)", edit((r) => { r[find(r, (x) => x.active === true)].supply = "0"; })],
    ["number changed in summary.json", (f) => { const s = JSON.parse(f["data/summary.json"]); s.summary.tokens += 1; f["data/summary.json"] = JSON.stringify(s, null, 1) + "\n"; }],
    ["number changed in the README", (f) => { f["README.md"] = f["README.md"].replace(/"single_key_pct_all":[0-9.]+/, '"single_key_pct_all":50'); }],
    ["discarded count changed in the README", (f) => { f["README.md"] = f["README.md"].replace(/"transport_failures":\d+/, '"transport_failures":99'); }],
    ["sentence changed in the README", (f) => { f["README.md"] = f["README.md"].replace(/Of \d+ token issuances/, "Of 1 token issuances"); }],
    ["measurement block changed in the README", (f) => { f["README.md"] = f["README.md"].replace(/at Polygon block \d+/, "at Polygon block 1"); }],
    ["number changed in the chart", (f) => { f["assets/key-control.svg"] = f["assets/key-control.svg"].replace(/(\d+(?:\.\d)?)% single key/, "10% single key"); }],
    ["chart file missing", (f) => { f["assets/key-control.svg"] = null; }],
    ["token count changed in discovery.json", (f) => { const d = JSON.parse(f["data/discovery.json"]); d.nets.polygon.unique_tokens += 1; f["data/discovery.json"] = JSON.stringify(d, null, 1) + "\n"; }],
    ["factory count changed in discovery.json", (f) => { const d = JSON.parse(f["data/discovery.json"]); d.nets.ethereum.distinct_factories += 1; f["data/discovery.json"] = JSON.stringify(d, null, 1) + "\n"; }],
    ["discovery.json missing", (f) => { f["data/discovery.json"] = null; }],
    ["value changed in tokens.csv", (f) => { f["data/tokens.csv"] = f["data/tokens.csv"].replace(/,(account_direct|account_via_contract),/, ",safe_multisig,"); }],
    ["tokens.csv missing", (f) => { f["data/tokens.csv"] = null; }],
    ["series.csv: tokens fell", (f) => { const l = f["history/series.csv"].trimEnd().split("\n"); const c = l[l.length - 1].split(","); c[0] = "2099-01-01"; c[3] = String(Number(c[3]) - 1); c[4] = String(Math.min(Number(c[4]), Number(c[3]))); f["history/series.csv"] = f["history/series.csv"].trimEnd() + "\n" + c.join(",") + "\n"; const x = JSON.parse(f["history/latest.json"]); x.pop(); f["history/latest.json"] = JSON.stringify(x); }],
    ["series.csv: date does not move forward", (f) => { const l = f["history/series.csv"].trimEnd().split("\n"); f["history/series.csv"] = f["history/series.csv"].trimEnd() + "\n" + l[l.length - 1] + "\n"; }],
    ["series.csv: token count differs from latest.json", (f) => { const l = f["history/series.csv"].trimEnd().split("\n"); const c = l[l.length - 1].split(","); c[3] = String(Number(c[3]) + 1); l[l.length - 1] = c.join(","); f["history/series.csv"] = l.join("\n") + "\n"; }],
    ["latest.json: invalid address", (f) => { const x = JSON.parse(f["history/latest.json"]); x[0].token = "0x123"; f["history/latest.json"] = JSON.stringify(x); }],
    ["latest.json: one row removed", (f) => { const x = JSON.parse(f["history/latest.json"]); x.pop(); f["history/latest.json"] = JSON.stringify(x); }],
    ["history/series.csv missing", (f) => { f["history/series.csv"] = null; }],
    ["fingerprint line changed", (f) => { f["data/SHA256SUMS"] = f["data/SHA256SUMS"].replace(/^./, (c) => (c === "0" ? "1" : "0")); }],
    ["file missing (summary.json)", (f) => { f["data/summary.json"] = null; }],
    ["self_owned row with a chain", edit((r) => { r[0].type = "self_owned"; r[0].owner = r[0].token; r[0].chain = ["0x" + "cd".repeat(20)]; r[0].controller = null; r[0].detail = null; })],
    ["cycle row without a chain", edit((r) => { r[0].type = "cycle"; r[0].controller = null; r[0].chain = []; r[0].detail = null; })],
  ];
}

/** Planted errors in the agent data. Each row mutation is also run resealed, so that exactly one check can see it. */
export function agentMutations(baseAgents) {
  const ed = (fn) => (f) => { const rows = JSON.parse(baseAgents); fn(rows); f["data/agents.json"] = JSON.stringify(rows, null, 1) + "\n"; };
  const withDirect = (r) => r.agents.some((a) => a.type === "account_direct");
  const twoDirect = (r) => r.agents.length >= 2 && r.agents[0].type === "account_direct" && r.agents[1].type === "account_direct";
  const direct = (rows) => rows.find(withDirect).agents.find((a) => a.type === "account_direct");
  const none = (r) => r.agents.length === 0;
  const rowMutations = [
    ["agent type flipped (account_direct to account_via_contract)", ed((rows) => { direct(rows).type = "account_via_contract"; })],
    ["agent controller differs from the agent (account_direct)", ed((rows) => { direct(rows).controller = "0x" + "ee".repeat(20); })],
    ["agent omitted from a row (omission, level unchanged)", ed((rows) => { rows.find(twoDirect).agents.splice(0, 1); })],
    ["agent replaced by a copy of another agent (duplicate)", ed((rows) => { const r = rows.find(twoDirect); r.agents[1] = JSON.parse(JSON.stringify(r.agents[0])); })],
    ["agent invalid address (fake id)", ed((rows) => { const a = direct(rows); a.address = "0x123"; a.controller = "0x123"; })],
    ["agent variant (upper-case address)", ed((rows) => { const a = direct(rows); a.address = "0x" + a.address.slice(2).toUpperCase(); a.controller = a.address; })],
    ["agent with an invalid type", ed((rows) => { const a = rows.find(twoDirect).agents[1]; a.type = "secret"; a.controller = null; a.detail = null; })],
    ["agent level flipped", ed((rows) => { rows.find((x) => x.level === 0).level = 1; })],
    ["owner_type differs from tokens.json (agents.json)", ed((rows) => { rows.find((x) => x.owner_type === "account_direct" && x.agents.length).owner_type = "account_via_contract"; })],
    ["active flag differs from tokens.json (agents.json)", ed((rows) => { rows[0].active = !rows[0].active; })],
    ["agents row removed (a token without agents)", ed((rows) => { rows.splice(rows.findIndex(none), 1); })],
    ["agents row for a token that is not in tokens.json (added)", ed((rows) => { rows.push({ net: "polygon", token: "0x" + "ab".repeat(20), active: false, owner_type: "no_owner", agents: [], level: null }); })],
    ["agents row repeated (a token without agents)", ed((rows) => { rows.push(JSON.parse(JSON.stringify(rows.find(none)))); })],
    ["agent added that no event announced", ed((rows) => { rows.find((x) => x.level === 0 && x.agents.length).agents.push({ address: "0x" + "cd".repeat(20), type: "account_direct", controller: "0x" + "cd".repeat(20), detail: null }); })],
  ];
  const replaceIn = (f, name, from, to) => { f[name] = f[name].replace(from, to); };
  const fileMutations = [
    ["agents.json emptied (empty list)", (f) => { f["data/agents.json"] = "[]\n"; }],
    ["agents.json truncated (half of the json)", (f) => { f["data/agents.json"] = f["data/agents.json"].slice(0, Math.floor(f["data/agents.json"].length / 2)); }],
    ["agents.json missing", (f) => { f["data/agents.json"] = null; }],
    ["agents-summary.json missing", (f) => { f["data/agents-summary.json"] = null; }],
    ["number changed in agents-summary.json", (f) => { const s = JSON.parse(f["data/agents-summary.json"]); s.summary.with_agents += 1; f["data/agents-summary.json"] = JSON.stringify(s, null, 1) + "\n"; }],
    ["event count changed in agents-summary.json (resealed, the README sentence follows)", (f) => { const s = JSON.parse(f["data/agents-summary.json"]); s.measured.events.added += 1; f["data/agents-summary.json"] = JSON.stringify(s, null, 1) + "\n"; resealAgents(f); }],
    ["agent numbers changed in the README", (f) => replaceIn(f, "README.md", /"level0_pct_all":[0-9.]+/, '"level0_pct_all":50')],
    ["agent sentence changed in the README", (f) => replaceIn(f, "README.md", /Of \d+ token issuances, \d+ have at least one agent/, "Of 1 token issuances, 1 have at least one agent")],
    ["agent fingerprint line changed in SHA256SUMS", (f) => replaceIn(f, "data/SHA256SUMS", /^.(?=[0-9a-f]{63}\s+agents\.json)/m, (c) => (c === "0" ? "1" : "0"))],
    ["agent fingerprint changed in the README", (f) => replaceIn(f, "README.md", /(Agent data fingerprint \(sha256 of data\/agents\.json\): `)([0-9a-f])/, (m, a, c) => a + (c === "0" ? "1" : "0"))],
  ];
  const sealed = rowMutations.map(([name, mutate]) => [name + " (resealed, only one agent check can see it)", (f) => { mutate(f); resealAgents(f); }]);
  return [...rowMutations, ...fileMutations, ...sealed];
}

/** Recompute the agent summary, fingerprint line and README blocks after a change to data/agents.json. The level column and the event counts stay as they are. */
export function resealAgents(f) {
  let rows, old;
  try { rows = JSON.parse(f["data/agents.json"]); old = JSON.parse(f["data/agents-summary.json"]); } catch { return; }
  if (!Array.isArray(rows) || rows.some((r) => !r || !Array.isArray(r.agents) || r.agents.some((a) => !a))) return;
  const s = summarizeAgents(rows);
  f["data/agents-summary.json"] = JSON.stringify({ measured: old.measured, summary: s }, null, 1) + "\n";
  const hash = createHash("sha256").update(f["data/agents.json"]).digest("hex");
  const lines = String(f["data/SHA256SUMS"]).split("\n").filter((l) => l.trim() && !/\sagents\.json\s*$/.test(l));
  f["data/SHA256SUMS"] = [...lines, `${hash}  agents.json`].join("\n") + "\n";
  let t = f["README.md"];
  t = t.replace(AGENT_NUMBERS_RE, `<!--AGENTNUMBERS ${JSON.stringify(headlineAgents(s))} -->`);
  t = t.replace(AGENT_SUMMARY_RE, `<!--AGENTSUMMARY-->\n${agentText(s, old.measured)}\n<!--/AGENTSUMMARY-->`);
  t = t.replace(AGENT_FINGERPRINT_RE, `$1${hash}$2`);
  f["README.md"] = t;
}

/** After an owner-row change the agent rows follow the new owner rows (token, active, owner_type, level), so that only the owner checks can see it. */
function followOwnerRows(f, rows) {
  let agentRows, old;
  try { agentRows = JSON.parse(f["data/agents.json"]); old = JSON.parse(f["data/agents-summary.json"]); } catch { return; }
  const mine = new Map(agentRows.map((r) => [r.net + ":" + r.token, r]));
  const out = [];
  const seen = new Set();
  for (const o of rows) {
    const k = o.net + ":" + o.token;
    if (seen.has(k)) continue;
    seen.add(k);
    const r = mine.get(k) || { net: o.net, token: o.token, agents: [] };
    r.active = o.active; r.owner_type = o.type; r.level = rowLevel(r);
    out.push(r);
  }
  f["data/agents.json"] = JSON.stringify(out, null, 1) + "\n";
  const total = out.reduce((n, r) => n + r.agents.length, 0);
  const removed = old.measured.events.removed || 0;
  old.measured.events = { added: total + removed, removed, duplicate_adds: 0, unmatched_removes: 0 };
  f["data/agents-summary.json"] = JSON.stringify(old, null, 1) + "\n";
  resealAgents(f);
}

/** Recompute summary, fingerprint, README numbers and chart after a change, so that only the row checks can see it. */
export function reseal(f) {
  let rows;
  try { rows = JSON.parse(f["data/tokens.json"]); } catch { return; }
  const s = summarize(rows);
  f["data/tokens.csv"] = csvText(rows);
  const summaryObj = JSON.parse(f["data/summary.json"]);
  summaryObj.summary = s;
  f["data/summary.json"] = JSON.stringify(summaryObj, null, 1) + "\n";
  try {
    const disc = JSON.parse(f["data/discovery.json"]);
    for (const net of ["polygon", "ethereum"]) {
      const mine = rows.filter((r) => r.net === net);
      if (disc.nets?.[net]) { disc.nets[net].unique_tokens = mine.length; disc.nets[net].distinct_factories = new Set(mine.map((r) => r.factory)).size; }
    }
    f["data/discovery.json"] = JSON.stringify(disc, null, 1) + "\n";
  } catch { /* no discovery file in this copy */ }
  const hash = createHash("sha256").update(f["data/tokens.json"]).digest("hex");
  f["data/SHA256SUMS"] = `${hash}  tokens.json\n`;
  let t = f["README.md"];
  t = t.replace(NUMBERS_RE, `<!--NUMBERS ${JSON.stringify({ ...headline(s), discarded: discarded(rows, summaryObj.measured) })} -->`);
  t = t.replace(SUMMARY_RE, `<!--SUMMARY-->\n${readableText(s, summaryObj.measured)}\n<!--/SUMMARY-->`);
  t = t.replace(/(Data fingerprint \(sha256 of data\/tokens\.json\): `)[0-9a-f]*(`)/, `$1${hash}$2`);
  f["README.md"] = t;
  f["assets/key-control.svg"] = chartSvg(s);
  if (f["data/agents.json"] != null && f["data/agents-summary.json"] != null) followOwnerRows(f, rows);
}

export function selftest(log = console.log) {
  let base;
  try { base = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(HERE, f), "utf8")])); }
  catch (e) { log("SELFTEST FAILS: a base file is missing: " + e.message); return { ok: false, caught: 0, total: 0 }; }
  const dir = mkdtempSync(join(tmpdir(), "census-selftest-"));
  const run = (mutate) => {
    const files = { ...base };
    if (mutate) mutate(files);
    rmSync(join(dir, "w"), { recursive: true, force: true });
    for (const f of FILES) {
      if (files[f] === null) continue;
      mkdirSync(dirname(join(dir, "w", f)), { recursive: true });
      writeFileSync(join(dir, "w", f), files[f]);
    }
    return checkAll(join(dir, "w"));
  };
  const control = run(null);
  if (!control.ok) { log("SELFTEST FAILS: the untouched copy is already red: " + control.errors[0]); rmSync(dir, { recursive: true, force: true }); return { ok: false, caught: 0, total: 0 }; }
  const raw = mutations(base["data/tokens.json"]);
  // the same row-level mutations again, but resealed: summary, fingerprint and README are consistent with the broken rows
  const rowLevel = ["fake id", "flipped statement", "duplicate", "swapped", "variant", "invalid type", "owner missing", "unknown network", "active flag", "supply changed", "self_owned", "cycle row"];
  const sealed = raw
    .filter(([name]) => rowLevel.some((k) => name.startsWith(k)))
    .map(([name, mutate]) => [name + " (resealed, only the row checks can see it)", (f) => { mutate(f); reseal(f); }]);
  const list = [...raw, ...sealed, ...agentMutations(base["data/agents.json"])];
  let caught = 0;
  for (const [name, mutate] of list) {
    let res;
    try { res = run(mutate); } catch (e) { res = { ok: false, errors: ["crash: " + e.message] }; }
    if (res.ok) log(`  NOT CAUGHT: ${name}`); else caught++;
  }
  rmSync(dir, { recursive: true, force: true });
  log(`selftest: ${caught} of ${list.length} planted errors caught, untouched copy green`);
  log("known limit: a simultaneous, consistent edit of rows, summary, fingerprint and README cannot be seen offline. --verify-chain re-measures a sample and would catch it only if edited rows are in the sample; a full recount (node census.mjs data/tokens.json out/ followed by node check.mjs --compare out/tokens.json) catches all of it.");
  return { ok: caught === list.length, caught, total: list.length };
}

async function verifyChain(sampleSize, strict) {
  const text = readFileSync(join(HERE, "data/tokens.json"));
  const rows = JSON.parse(text.toString("utf8"));
  let s = parseInt(createHash("sha256").update(text).digest("hex").slice(0, 8), 16);
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pool = [...rows];
  const pick = [];
  while (pick.length < sampleSize && pool.length) pick.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  const { rows: fresh } = await runCensus(pick.map((r) => ({ net: r.net, token: r.token, factory: r.factory })), DEFAULT_RPC);
  const cmp = compareRows(pick, fresh);
  const unreadable = fresh.filter((r, i) => r.type === "unreadable" && pick.find((p) => p.token === r.token)?.type !== "unreadable").length;
  for (const d of cmp.differs.slice(0, 10)) console.log(`  differs ${d.key.slice(0, 20)}: was ${d.was.slice(0, 40)} now ${d.now.slice(0, 40)}`);
  console.log(`verify-chain: sample of ${pick.length} re-measured (type and controller): ${cmp.same} same, ${cmp.differs.length} differ, ${unreadable} became unreadable. A difference can be legitimate if an owner changed since the measurement.`);
  const ok = verifyVerdict({ n: pick.length, differs: cmp.differs.length, unreadable }, strict);
  console.log(ok ? "verify-chain: OK" + (strict ? " (strict)" : " (up to 5 percent tolerated)") : "verify-chain: RED");
  return ok;
}

export async function verifyAgents(sampleSize, strict, { rpcUrls = DEFAULT_RPC, dataDir = HERE, log = console.log } = {}) {
  const text = readFileSync(join(dataDir, "data/agents.json"));
  const rows = JSON.parse(text.toString("utf8"));
  let s = parseInt(createHash("sha256").update(text).digest("hex").slice(0, 8), 16);
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pairs = rows.flatMap((r) => r.agents.map((a) => ({ net: r.net, token: r.token, agent: a.address })));
  const pick = [];
  while (pick.length < sampleSize && pairs.length) pick.push(pairs.splice(Math.floor(rnd() * pairs.length), 1)[0]);
  let no = 0, unknown = 0;
  for (const net of Object.keys(rpcUrls)) {
    const mine = pick.filter((p) => p.net === net);
    if (!mine.length) continue;
    const ch = makeChain(rpcUrls[net]);
    const res = await ch.multicall(mine.map((p) => ({ target: p.token, data: IS_AGENT + "0".repeat(24) + p.agent.slice(2) })));
    for (const r of res) { if (!r.ok) unknown++; else if (!decBool(r.data)) no++; }
  }
  log(`verify-agents: sample of ${pick.length} listed agents asked to the token contracts (isAgent): ${pick.length - no - unknown} yes, ${no} no, ${unknown} unanswered. A "no" can be legitimate if an agent was removed since the measurement. This direction cannot show an agent that is missing from the list.`);
  const ok = verifyVerdict({ n: pick.length, differs: no, unreadable: unknown }, strict);
  log(ok ? "verify-agents: OK" + (strict ? " (strict)" : " (up to 5 percent tolerated)") : "verify-agents: RED");
  return ok;
}

function compareFile(path) {
  const base = JSON.parse(readFileSync(join(HERE, "data/tokens.json"), "utf8"));
  const other = JSON.parse(readFileSync(path, "utf8"));
  const c = compareRows(base, other);
  for (const d of c.differs.slice(0, 20)) console.log(`  differs ${d.key.slice(0, 20)}: was ${d.was.slice(0, 40)} now ${d.now.slice(0, 40)}`);
  console.log(`compare: ${c.same} same, ${c.differs.length} differ, ${c.onlyA.length} only in data/tokens.json, ${c.onlyB.length} only in your file`);
  return c.differs.length === 0 && c.onlyA.length === 0 && c.onlyB.length === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const arg = (name, def) => (a.includes(name) ? a[a.indexOf(name) + 1] : def);
  if (a.includes("--selftest")) {
    process.exit(selftest().ok ? 0 : 1);
  } else if (a.includes("--verify-chain")) {
    process.exit((await verifyChain(Number(arg("--sample", 200)), a.includes("--strict"))) ? 0 : 1);
  } else if (a.includes("--verify-agents")) {
    process.exit((await verifyAgents(Number(arg("--sample", 300)), a.includes("--strict"))) ? 0 : 1);
  } else if (a.includes("--compare")) {
    process.exit(compareFile(arg("--compare")) ? 0 : 1);
  } else {
    const r = checkAll(HERE);
    if (r.ok) {
      console.log(`GREEN: ${r.info.rows} tokens recounted; summary, README numbers and fingerprint (${r.info.hash.slice(0, 12)}...) agree.`);
      console.log("discarded or skipped: " + JSON.stringify(r.info.discarded));
      console.log(JSON.stringify(r.info.headline));
      console.log(JSON.stringify(headlineAgents(summarizeAgents(JSON.parse(readFileSync(join(HERE, "data/agents.json"), "utf8"))))));
    } else {
      console.log("RED:");
      for (const e of r.errors.slice(0, 20)) console.log("  - " + e);
    }
    process.exit(r.ok ? 0 : 1);
  }
}

#!/usr/bin/env node
// Recount. Usage:
//   node check.mjs                                  recount the data without a network (exit 0 green, 1 red)
//   node check.mjs --selftest                       plant errors in a copy and require every one to be caught
//   node check.mjs --verify-chain [--sample 200] [--strict]   re-measure a deterministic sample from the chains (type and controller)
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

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = ["data/tokens.json", "data/summary.json", "data/SHA256SUMS", "data/discovery.json", "data/tokens.csv", "history/series.csv", "history/latest.json", "README.md", "assets/key-control.svg"];

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
  const list = [...raw, ...sealed];
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
  } else if (a.includes("--compare")) {
    process.exit(compareFile(arg("--compare")) ? 0 : 1);
  } else {
    const r = checkAll(HERE);
    if (r.ok) {
      console.log(`GREEN: ${r.info.rows} tokens recounted; summary, README numbers and fingerprint (${r.info.hash.slice(0, 12)}...) agree.`);
      console.log("discarded or skipped: " + JSON.stringify(r.info.discarded));
      console.log(JSON.stringify(r.info.headline));
    } else {
      console.log("RED:");
      for (const e of r.errors.slice(0, 20)) console.log("  - " + e);
    }
    process.exit(r.ok ? 0 : 1);
  }
}

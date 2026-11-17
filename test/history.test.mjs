import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compact, seriesRow, parseSeries, diffSnapshots, guard, checkHistory, SERIES_HEADER } from "../lib/history.mjs";
import { initHistory, updateHistory } from "../history.mjs";
import { summarize } from "../lib/summary.mjs";

const A = (n) => "0x" + n.toString(16).padStart(40, "0");
const row = (net, n, type = "account_direct", controller = A(0x900 + n), supply = "5", extra = {}) => ({
  net, token: A(n), factory: A(0x100), supply, paused: false, owner: controller, type, controller, chain: [controller], detail: null, e7702: false, active: supply !== "0", ...extra,
});
const measured = (date, polygon = 100, ethereum = 50, transport = 0) => ({ started: date + "T10:00:00.000Z", block_start: { polygon, ethereum }, transport_failures: transport });

test("compact keeps only the state we compare and sorts it", () => {
  const c = compact([row("polygon", 2), row("ethereum", 1)]);
  assert.deepEqual(Object.keys(c[0]).sort(), ["active", "controller", "net", "token", "type"]);
  assert.equal(c[0].net, "ethereum");
});

test("diffSnapshots finds added, removed, changed type, changed controller and activity changes", () => {
  const prev = compact([row("polygon", 1), row("polygon", 2), row("polygon", 3), row("polygon", 4, "account_direct", A(0x904), "0")]);
  const next = compact([
    row("polygon", 1),
    row("polygon", 2, "safe_multisig", A(0xaaa)), // type and controller changed
    row("polygon", 3, "account_direct", A(0xbbb)), // controller only
    row("polygon", 4, "account_direct", A(0x904), "9"), // became active
    row("polygon", 5), // new
  ]);
  const d = diffSnapshots(prev, next);
  assert.equal(d.added.length, 1);
  assert.equal(d.removed.length, 0);
  assert.equal(d.changed.length, 2);
  assert.deepEqual(d.transitions, { "account_direct->safe_multisig": 1 });
  assert.equal(d.activated, 1);
  const gone = diffSnapshots(prev, compact([row("polygon", 1)]));
  assert.equal(gone.removed.length, 3);
});

test("guard refuses a measurement that cannot be complete", () => {
  const rows = [row("polygon", 1), row("polygon", 2)];
  assert.equal(guard({ prevCount: 2, nextRows: compact(rows), removed: [], transportFailures: 0 }).ok, true);
  assert.equal(guard({ prevCount: 2, nextRows: [], removed: [], transportFailures: 0 }).ok, false); // empty
  assert.equal(guard({ prevCount: 2, nextRows: compact(rows), removed: ["polygon:0x1"], transportFailures: 0 }).ok, false); // a token vanished
  assert.equal(guard({ prevCount: 3, nextRows: compact(rows), removed: [], transportFailures: 0 }).ok, false); // fewer than before
  const unreadable = Array.from({ length: 100 }, (_, i) => row("polygon", i + 1, i < 3 ? "unreadable" : "account_direct"));
  assert.equal(guard({ prevCount: 100, nextRows: compact(unreadable), removed: [], transportFailures: 0 }).ok, false); // 3 percent unreadable
  assert.equal(guard({ prevCount: 100, nextRows: compact(unreadable.map((r) => ({ ...r, type: "account_direct" }))), removed: [], transportFailures: 2 }).ok, false); // 2 percent transport failures
});

test("seriesRow and parseSeries round trip, and the parser catches bad rows", () => {
  const rows = [row("polygon", 1), row("polygon", 2, "safe_multisig", A(0xaaa))];
  const line = seriesRow("2026-11-16", summarize(rows), measured("2026-11-16"));
  const ok = parseSeries(SERIES_HEADER + "\n" + line + "\n");
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.rows[0].tokens, 2);
  assert.ok(parseSeries("wrong header\n" + line + "\n").errors.length);
  assert.ok(parseSeries(SERIES_HEADER + "\n" + line.replace("2026-11-16", "16-11-2026") + "\n").errors.length);
  assert.ok(parseSeries(SERIES_HEADER + "\n" + line.split(",").slice(0, 11).join(",") + "\n").errors.length);
  const later = line.replace("2026-11-16", "2026-11-23");
  assert.deepEqual(parseSeries(SERIES_HEADER + "\n" + line + "\n" + later + "\n").errors, []);
  assert.ok(parseSeries(SERIES_HEADER + "\n" + later + "\n" + line + "\n").errors.some((e) => /does not come after/.test(e))); // dates go backwards
  const fewer = line.replace("2026-11-16", "2026-11-23").split(",");
  fewer[3] = "1";
  fewer[4] = "1";
  assert.ok(parseSeries(SERIES_HEADER + "\n" + line + "\n" + fewer.join(",") + "\n").errors.some((e) => /can only grow/.test(e))); // tokens fell
  const moreActive = line.split(",");
  moreActive[4] = String(Number(moreActive[3]) + 1);
  assert.ok(parseSeries(SERIES_HEADER + "\n" + moreActive.join(",") + "\n").errors.length);
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "census-history-"));
  const base = [row("polygon", 1), row("polygon", 2), row("ethereum", 3)];
  mkdirSync(root + "/data", { recursive: true });
  writeFileSync(root + "/data/tokens.json", JSON.stringify(base));
  writeFileSync(root + "/data/summary.json", JSON.stringify({ measured: measured("2026-11-16"), summary: summarize(base) }));
  initHistory(root);
  const census = (rows, date, transport = 0) => {
    const dir = mkdtempSync(join(tmpdir(), "census-run-"));
    writeFileSync(dir + "/tokens.json", JSON.stringify(rows));
    writeFileSync(dir + "/summary.json", JSON.stringify({ measured: measured(date, 200, 60, transport), summary: summarize(rows) }));
    return dir;
  };
  return { root, base, census };
}

test("init writes the baseline and the history folder passes its own check", () => {
  const { root } = setup();
  try {
    assert.deepEqual(checkHistory(root), []);
    assert.equal(parseSeries(readFileSync(root + "/history/series.csv", "utf8")).rows.length, 1);
    assert.throws(() => initHistory(root), /exists already/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("update records a new measurement, writes what moved, and a second run on the same day changes nothing", () => {
  const { root, base, census } = setup();
  try {
    const next = [row("polygon", 1), row("polygon", 2, "safe_multisig", A(0xaaa)), row("ethereum", 3), row("polygon", 9)];
    const r = updateHistory(root, census(next, "2026-11-23"));
    assert.equal(r.ok, true);
    assert.equal(r.added, 1);
    assert.equal(r.changed, 1);
    assert.deepEqual(checkHistory(root), []);
    assert.equal(parseSeries(readFileSync(root + "/history/series.csv", "utf8")).rows.length, 2);
    const changes = JSON.parse(readFileSync(root + "/history/changes/2026-11-23.json", "utf8"));
    assert.equal(changes.compared_with, "2026-11-16");
    assert.equal(changes.added_count, 1);
    assert.deepEqual(changes.transitions, { "account_direct->safe_multisig": 1 });
    assert.equal(JSON.parse(readFileSync(root + "/history/latest.json", "utf8")).length, 4);
    const before = readFileSync(root + "/history/series.csv", "utf8");
    const again = updateHistory(root, census(next, "2026-11-23"));
    assert.equal(again.ok, true);
    assert.ok(again.skipped);
    assert.equal(readFileSync(root + "/history/series.csv", "utf8"), before);
    void base;
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a partial measurement is refused and nothing is written", () => {
  const { root, census } = setup();
  try {
    const before = [readFileSync(root + "/history/series.csv", "utf8"), readFileSync(root + "/history/latest.json", "utf8")];
    const r = updateHistory(root, census([row("polygon", 1), row("ethereum", 3)], "2026-11-23")); // token 2 missing
    assert.equal(r.ok, false);
    assert.ok(r.problems.length);
    assert.deepEqual([readFileSync(root + "/history/series.csv", "utf8"), readFileSync(root + "/history/latest.json", "utf8")], before);
    assert.equal(existsSync(root + "/history/changes") ? readdirSync(root + "/history/changes").length : 0, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a measurement with no changes still adds a series row but no changes file", () => {
  const { root, base, census } = setup();
  try {
    const r = updateHistory(root, census(base, "2026-11-23"));
    assert.equal(r.ok, true);
    assert.equal(existsSync(root + "/history/changes") ? readdirSync(root + "/history/changes").length : 0, 0);
    assert.equal(parseSeries(readFileSync(root + "/history/series.csv", "utf8")).rows.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("checkHistory catches a tampered folder", () => {
  const { root } = setup();
  try {
    const latest = JSON.parse(readFileSync(root + "/history/latest.json", "utf8"));
    writeFileSync(root + "/history/latest.json", JSON.stringify(latest.slice(1)));
    assert.ok(checkHistory(root).some((e) => /last series row/.test(e)));
    latest[0].token = "0x123";
    writeFileSync(root + "/history/latest.json", JSON.stringify(latest));
    assert.ok(checkHistory(root).some((e) => /not valid/.test(e)));
    rmSync(root + "/history/series.csv");
    assert.ok(checkHistory(root).some((e) => /missing file/.test(e)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

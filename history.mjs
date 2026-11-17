#!/usr/bin/env node
// Keeps the time series. Read-only on the chains (the measurement itself is census.mjs); this file only compares and records.
//   node history.mjs init                     start the series from the published snapshot in data/
//   node history.mjs update --census out/data record a new measurement, if it passes the guard
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SERIES_HEADER, compact, seriesRow, parseSeries, diffSnapshots, guard, latestText } from "./lib/history.mjs";
import { summarize } from "./lib/summary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function initHistory(root, dataDir = root + "/data") {
  if (existsSync(root + "/history/series.csv")) throw new Error("history/series.csv exists already");
  const rows = readJson(dataDir + "/tokens.json");
  const { measured } = readJson(dataDir + "/summary.json");
  const date = String(measured.started).slice(0, 10);
  writeAtomic(root + "/history/series.csv", SERIES_HEADER + "\n" + seriesRow(date, summarize(rows), measured) + "\n");
  writeAtomic(root + "/history/latest.json", latestText(compact(rows)));
  return { date, tokens: rows.length };
}

/** Records a new measurement. Returns { ok, problems?, skipped?, ... }. Nothing is written unless ok. */
export function updateHistory(root, censusDir, { date } = {}) {
  const rows = readJson(censusDir + "/tokens.json");
  const { measured } = readJson(censusDir + "/summary.json");
  const day = date || String(measured.started).slice(0, 10);
  const prev = JSON.parse(readFileSync(root + "/history/latest.json", "utf8"));
  const seriesText = readFileSync(root + "/history/series.csv", "utf8");
  const parsed = parseSeries(seriesText);
  if (parsed.errors.length) return { ok: false, problems: ["the existing series is not valid: " + parsed.errors[0]] };
  const last = parsed.rows[parsed.rows.length - 1];
  if (last && day <= last.date) return { ok: true, skipped: `a measurement for ${last.date} or later exists already` };
  const next = compact(rows);
  const d = diffSnapshots(prev, next);
  const g = guard({ prevCount: prev.length, nextRows: next, removed: d.removed, transportFailures: measured.transport_failures ?? 0 });
  if (!g.ok) return { ok: false, problems: g.problems };
  const summary = summarize(rows);
  const csv = seriesText.replace(/\n*$/, "\n") + seriesRow(day, summary, measured) + "\n";
  if (d.added.length || d.changed.length || d.activated || d.deactivated) {
    writeAtomic(root + `/history/changes/${day}.json`, JSON.stringify({
      date: day,
      compared_with: last ? last.date : null,
      tokens_before: prev.length,
      tokens_after: next.length,
      added_count: d.added.length,
      changed_count: d.changed.length,
      activated: d.activated,
      deactivated: d.deactivated,
      transitions: d.transitions,
      added: d.added.slice(0, 200),
      changed: d.changed.slice(0, 500),
    }, null, 1) + "\n");
  }
  writeAtomic(root + "/history/series.csv", csv);
  writeAtomic(root + "/history/latest.json", latestText(next));
  return { ok: true, date: day, added: d.added.length, changed: d.changed.length, activated: d.activated, deactivated: d.deactivated, transitions: d.transitions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const arg = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] : null);
  if (a[0] === "init") {
    console.log(JSON.stringify(initHistory(HERE)));
  } else if (a[0] === "update") {
    const census = arg("--census");
    if (!census) { console.error("Usage: node history.mjs update --census <dir with tokens.json and summary.json>"); process.exit(2); }
    const r = updateHistory(HERE, resolve(census), { date: arg("--date") });
    console.log(JSON.stringify(r, null, 1));
    process.exit(r.ok ? 0 : 3);
  } else {
    console.error("Usage: node history.mjs init | update --census <dir>");
    process.exit(2);
  }
}

// The time series. A snapshot is one measurement; history keeps one row per measurement and the list of what moved.
// Issuances are announced by an event and can never be un-announced, so the list only grows. A new measurement
// that has fewer tokens than the previous one is a partial measurement, and nothing is written.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { TYPES } from "./classify.mjs";

export const SERIES_HEADER = "date,block_polygon,block_ethereum,tokens,active,single_key_pct_all,multi_party_pct_all,single_key_pct_active,multi_party_pct_active,factories,controllers_active,top50_share_active_pct";
const ADDR = /^0x[0-9a-f]{40}$/;
const NETS = new Set(["polygon", "ethereum"]);
const key = (r) => r.net + ":" + r.token;

/** The small state kept between measurements. */
export function compact(rows) {
  return rows
    .map((r) => ({ net: r.net, token: r.token, type: r.type, controller: r.controller ?? null, active: !!r.active }))
    .sort((a, b) => (a.net + a.token).localeCompare(b.net + b.token));
}

export function seriesRow(date, summary, measured) {
  return [
    date,
    measured?.block_start?.polygon ?? "",
    measured?.block_start?.ethereum ?? "",
    summary.tokens,
    summary.active,
    summary.all.single_key_pct,
    summary.all.multi_party_pct,
    summary.active_share.single_key_pct,
    summary.active_share.multi_party_pct,
    summary.distinct_factories,
    summary.distinct_controllers_active,
    summary.top50_controllers_share_active_pct,
  ].join(",");
}

/** Parses and checks series.csv. Returns { rows, errors }. */
export function parseSeries(text) {
  const errors = [];
  const lines = String(text).replace(/\r\n/g, "\n").split("\n").filter((l) => l.length);
  if (lines[0] !== SERIES_HEADER) return { rows: [], errors: ["series.csv: the header is not the expected one"] };
  const rows = [];
  lines.slice(1).forEach((l, i) => {
    const f = l.split(",");
    const p = `series.csv row ${i + 1}`;
    if (f.length !== 12) { errors.push(`${p}: expected 12 fields, found ${f.length}`); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f[0])) { errors.push(`${p}: the date is not YYYY-MM-DD`); return; }
    const n = f.slice(1).map((x) => (x === "" ? NaN : Number(x)));
    const ints = [0, 1, 2, 3, 8, 9].map((k) => n[k]); // block_polygon, block_ethereum, tokens, active, factories, controllers_active
    if (ints.some((x) => !Number.isInteger(x) || x < 0)) { errors.push(`${p}: a count is not a non-negative integer`); return; }
    const pcts = [4, 5, 6, 7, 10].map((k) => n[k]);
    if (pcts.some((x) => !Number.isFinite(x) || x < 0 || x > 100)) { errors.push(`${p}: a percentage is outside 0 to 100`); return; }
    if (n[3] > n[2]) { errors.push(`${p}: more active issuances than issuances`); return; }
    rows.push({ date: f[0], tokens: n[2], active: n[3] });
  });
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].date <= rows[i - 1].date) errors.push(`series.csv: the date ${rows[i].date} does not come after ${rows[i - 1].date}`);
    if (rows[i].tokens < rows[i - 1].tokens) errors.push(`series.csv: tokens fell from ${rows[i - 1].tokens} to ${rows[i].tokens} on ${rows[i].date}; the list can only grow`);
  }
  return { rows, errors };
}

/** What moved between two snapshots. */
export function diffSnapshots(prev, next) {
  const pm = new Map(prev.map((r) => [key(r), r]));
  const nm = new Map(next.map((r) => [key(r), r]));
  const added = [], removed = [], changed = [];
  const transitions = {};
  let activated = 0, deactivated = 0;
  for (const [k, n] of nm) {
    const p = pm.get(k);
    if (!p) { added.push(k); continue; }
    if (p.type !== n.type || (p.controller ?? null) !== (n.controller ?? null)) {
      changed.push({ key: k, was: `${p.type}:${p.controller ?? "-"}`, now: `${n.type}:${n.controller ?? "-"}` });
      if (p.type !== n.type) { const t = `${p.type}->${n.type}`; transitions[t] = (transitions[t] || 0) + 1; }
    }
    if (!p.active && n.active) activated++;
    if (p.active && !n.active) deactivated++;
  }
  for (const k of pm.keys()) if (!nm.has(k)) removed.push(k);
  return { added, removed, changed, transitions, activated, deactivated };
}

/** Refuse a measurement that cannot be complete. */
export function guard({ prevCount, nextRows, removed, transportFailures = 0 }) {
  const problems = [];
  const n = nextRows.length;
  if (n === 0) problems.push("the new measurement has no tokens");
  if (removed.length > 0) problems.push(`${removed.length} previously listed token(s) are missing; the list can only grow, so this measurement is partial`);
  if (n < prevCount) problems.push(`the new measurement has ${n} tokens, fewer than the ${prevCount} before`);
  const unreadable = nextRows.filter((r) => r.type === "unreadable").length;
  if (n && unreadable / n > 0.02) problems.push(`${unreadable} of ${n} tokens are unreadable (more than 2 percent)`);
  if (n && transportFailures / n > 0.01) problems.push(`${transportFailures} transport failures (more than 1 percent of the tokens)`);
  return { ok: problems.length === 0, problems };
}

export const latestText = (compactRows) => "[\n" + compactRows.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n";

/** Offline integrity check of the history folder. Returns a list of errors. */
export function checkHistory(root) {
  const errors = [];
  const rd = (p) => (existsSync(root + "/" + p) ? readFileSync(root + "/" + p, "utf8") : null);
  const seriesText = rd("history/series.csv"), latestRaw = rd("history/latest.json");
  if (seriesText === null) errors.push("missing file: history/series.csv");
  if (latestRaw === null) errors.push("missing file: history/latest.json");
  if (errors.length) return errors;
  const { rows, errors: se } = parseSeries(seriesText);
  errors.push(...se);
  let latest;
  try { latest = JSON.parse(latestRaw); } catch { return [...errors, "history/latest.json is not valid JSON"]; }
  if (!Array.isArray(latest) || latest.length === 0) return [...errors, "history/latest.json is empty or not a list"];
  const seen = new Set();
  latest.forEach((r, i) => {
    const p = `latest.json row ${i}`;
    if (!r || !NETS.has(r.net) || !ADDR.test(String(r.token))) { errors.push(`${p}: net or token is not valid`); return; }
    if (seen.has(key(r))) errors.push(`${p}: duplicate ${key(r).slice(0, 20)}`);
    seen.add(key(r));
    if (!TYPES.includes(r.type)) errors.push(`${p}: invalid type`);
    if (r.controller !== null && !ADDR.test(String(r.controller))) errors.push(`${p}: controller is not a valid address`);
    if (typeof r.active !== "boolean") errors.push(`${p}: active is not a boolean`);
  });
  if (rows.length && rows[rows.length - 1].tokens !== latest.length) errors.push(`history/latest.json has ${latest.length} tokens but the last series row says ${rows[rows.length - 1].tokens}`);
  const dir = root + "/history/changes";
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      try {
        const c = JSON.parse(readFileSync(dir + "/" + f, "utf8"));
        if (c.date + ".json" !== f) errors.push(`history/changes/${f}: the date inside does not match the file name`);
        if (!Number.isInteger(c.changed_count) || !Number.isInteger(c.added_count)) errors.push(`history/changes/${f}: counts are missing`);
      } catch { errors.push(`history/changes/${f}: not valid JSON`); }
    }
  }
  return errors;
}

// Recounting without a network: does the data agree with itself, the summary, the README and the fingerprint.
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { TYPES, ZERO, DEAD } from "./classify.mjs";
import { summarize, headline, isActive, readableText } from "./summary.mjs";
import { chartSvg } from "./chart.mjs";
import { csvText } from "./csv.mjs";

const ADDR_LOWER = /^0x[0-9a-f]{40}$/;
const NETS = new Set(["polygon", "ethereum"]);
export const NUMBERS_RE = /<!--NUMBERS (\{[^\n]*\}) -->/;
export const SUMMARY_RE = /<!--SUMMARY-->\n([\s\S]*?)\n<!--\/SUMMARY-->/;

function sorted(x) {
  if (Array.isArray(x)) return x.map(sorted);
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sorted(x[k])]));
  return x;
}
export const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

export function validateRows(rows) {
  const errors = [];
  if (!Array.isArray(rows) || rows.length === 0) return ["tokens.json is empty or not a list"];
  const seen = new Set();
  rows.forEach((r, i) => {
    const p = `row ${i}`;
    if (!r || typeof r !== "object") { errors.push(`${p}: not an object`); return; }
    if (!NETS.has(r.net)) errors.push(`${p}: unknown network ${JSON.stringify(r.net)}`);
    if (!ADDR_LOWER.test(String(r.token))) errors.push(`${p}: token is not a valid lowercase address: ${String(r.token).slice(0, 14)}`);
    const k = r.net + ":" + String(r.token).toLowerCase();
    if (seen.has(k)) errors.push(`${p}: duplicate ${k.slice(0, 20)}`);
    seen.add(k);
    if (!TYPES.includes(r.type)) { errors.push(`${p}: invalid type ${JSON.stringify(r.type)}`); return; }
    for (const field of ["owner", "controller"]) if (r[field] !== null && !ADDR_LOWER.test(String(r[field]))) errors.push(`${p}: ${field} is not a valid address`);
    if (!Array.isArray(r.chain) || r.chain.some((a) => !ADDR_LOWER.test(String(a)))) { errors.push(`${p}: chain is not a list of addresses`); return; }
    if (r.supply !== null && !/^\d+$/.test(String(r.supply))) errors.push(`${p}: supply is not an integer`);
    if (typeof r.e7702 !== "boolean") errors.push(`${p}: e7702 is missing`);
    if (r.active !== isActive(r)) errors.push(`${p}: active does not follow from supply and paused`);
    const last = r.chain[r.chain.length - 1];
    switch (r.type) {
      case "account_direct":
        if (!(r.chain.length === 1 && r.chain[0] === r.owner && r.controller === r.owner)) errors.push(`${p}: account_direct but chain and owner disagree`);
        break;
      case "account_via_contract":
        if (!(r.chain.length >= 2 && r.chain[0] === r.owner && r.controller === last)) errors.push(`${p}: account_via_contract but chain and owner disagree`);
        break;
      case "safe_multisig":
      case "safe_threshold_1": {
        const d = r.detail;
        const ok = d && Number.isInteger(d.threshold) && Number.isInteger(d.n) && d.threshold >= 1 && d.n >= d.threshold && r.controller === last && r.chain[0] === r.owner;
        const thresholdOk = d && (r.type === "safe_multisig" ? d.threshold >= 2 : d.threshold === 1);
        if (!ok || !thresholdOk) errors.push(`${p}: ${r.type} but detail, threshold or chain disagree`);
        break;
      }
      case "timelock":
      case "other_contract":
        if (!(r.controller === last && r.chain[0] === r.owner)) errors.push(`${p}: ${r.type} but chain and controller disagree`);
        break;
      case "renounced":
        if (![ZERO, DEAD].includes(r.controller)) errors.push(`${p}: renounced but controller is not the zero or dead address`);
        else if (r.chain.length ? r.chain[0] !== r.owner : r.owner !== r.controller) errors.push(`${p}: renounced but owner and chain disagree`);
        break;
      case "self_owned":
        if (!(r.owner === r.token && r.chain.length === 0 && r.controller === null)) errors.push(`${p}: self_owned but owner, chain or controller disagree`);
        break;
      case "cycle":
      case "too_deep":
      case "not_measured":
        if (!(r.controller === null && r.chain.length >= 1 && r.chain[0] === r.owner)) errors.push(`${p}: ${r.type} but chain, owner or controller disagree`);
        break;
      case "no_owner":
      case "unreadable":
        if (r.owner !== null || r.controller !== null || r.chain.length) errors.push(`${p}: ${r.type} but owner, controller or chain is filled`);
        if (r.type === "unreadable" && r.supply !== null) errors.push(`${p}: unreadable but supply is filled`);
        break;
      default:
        break;
    }
  });
  return errors;
}

export function discarded(rows, measured) {
  return {
    duplicates_skipped: measured?.duplicates_skipped ?? null,
    invalid_address_skipped: measured?.invalid_address_skipped ?? null,
    transport_failures: measured?.transport_failures ?? null,
    unreadable: rows.filter((r) => r.type === "unreadable").length,
  };
}

export function checkAll(root) {
  const errors = [];
  const read = (p) => (existsSync(root + "/" + p) ? readFileSync(root + "/" + p, "utf8") : null);
  const tokensText = read("data/tokens.json"), summaryText = read("data/summary.json"), sums = read("data/SHA256SUMS"), readme = read("README.md");
  for (const [name, v] of [["data/tokens.json", tokensText], ["data/summary.json", summaryText], ["data/SHA256SUMS", sums], ["README.md", readme]]) if (v === null) errors.push(`missing file: ${name}`);
  if (errors.length) return { ok: false, errors };
  let rows, summary;
  try { rows = JSON.parse(tokensText); } catch { return { ok: false, errors: ["data/tokens.json is not valid JSON (truncated?)"] }; }
  try { summary = JSON.parse(summaryText); } catch { return { ok: false, errors: ["data/summary.json is not valid JSON"] }; }
  errors.push(...validateRows(rows));
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, errors };
  const fresh = summarize(rows);
  if (!same(fresh, summary.summary)) errors.push("data/summary.json does not match a fresh count of the rows");
  const hash = createHash("sha256").update(tokensText).digest("hex");
  const m = /^([0-9a-f]{64})\s+tokens\.json\s*$/m.exec(sums);
  if (!m || m[1] !== hash) errors.push("fingerprint in data/SHA256SUMS does not match data/tokens.json");
  if (!readme.includes("`" + hash + "`")) errors.push("fingerprint of data/tokens.json is not in the README");
  const block = NUMBERS_RE.exec(readme);
  if (!block) errors.push("README has no NUMBERS block");
  else {
    let published;
    try { published = JSON.parse(block[1]); } catch { errors.push("NUMBERS block in the README is not valid JSON"); }
    if (published && !same(published, { ...headline(fresh), discarded: discarded(rows, summary.measured) })) errors.push("numbers in the README do not match a fresh count (or the discarded counts are wrong)");
  }
  const csvFile = read("data/tokens.csv");
  if (csvFile === null) errors.push("missing file: data/tokens.csv");
  else if (csvFile !== csvText(rows)) errors.push("data/tokens.csv does not match tokens.json");
  const discoveryText = read("data/discovery.json");
  if (discoveryText === null) errors.push("missing file: data/discovery.json");
  else {
    try {
      const disc = JSON.parse(discoveryText);
      for (const net of NETS) {
        const mine = rows.filter((r) => r.net === net);
        const d = disc.nets?.[net];
        if (!d) { errors.push(`data/discovery.json has no entry for ${net}`); continue; }
        if (d.unique_tokens !== mine.length) errors.push(`data/discovery.json says ${d.unique_tokens} tokens on ${net} but tokens.json has ${mine.length}`);
        if (d.distinct_factories !== new Set(mine.map((r) => r.factory)).size) errors.push(`data/discovery.json says ${d.distinct_factories} factories on ${net} but tokens.json has ${new Set(mine.map((r) => r.factory)).size}`);
      }
    } catch { errors.push("data/discovery.json is not valid JSON"); }
  }
  const chart = read("assets/key-control.svg");
  if (chart === null) errors.push("missing file: assets/key-control.svg");
  else if (chart !== chartSvg(fresh)) errors.push("assets/key-control.svg does not match a fresh drawing of the numbers");
  const sentences = SUMMARY_RE.exec(readme);
  if (!sentences) errors.push("README has no SUMMARY block");
  else if (sentences[1].trim() !== readableText(fresh, summary.measured)) errors.push("sentences in the README do not match a fresh count");
  return { ok: errors.length === 0, errors, info: { rows: rows.length, hash, headline: headline(fresh), discarded: discarded(rows, summary.measured) } };
}

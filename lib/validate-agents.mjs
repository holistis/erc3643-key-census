// Recounting the agent data without a network: rows against rows, summary, README, fingerprint and event counts.
import { createHash } from "node:crypto";
import { TYPES, ZERO, DEAD } from "./classify.mjs";
import { summarizeAgents, headlineAgents, agentText, rowLevel } from "./agents.mjs";

const ADDR_LOWER = /^0x[0-9a-f]{40}$/;
// classify() can give an agent every type except these two: an agent always has an address and the call is always answered
const AGENT_TYPES = TYPES.filter((t) => !["no_owner", "unreadable"].includes(t));
export const AGENT_NUMBERS_RE = /<!--AGENTNUMBERS (\{[^\n]*\}) -->/;
export const AGENT_SUMMARY_RE = /<!--AGENTSUMMARY-->\n([\s\S]*?)\n<!--\/AGENTSUMMARY-->/;
export const AGENT_FINGERPRINT_RE = /(Agent data fingerprint \(sha256 of data\/agents\.json\): `)[0-9a-f]*(`)/;

function sorted(x) {
  if (Array.isArray(x)) return x.map(sorted);
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sorted(x[k])]));
  return x;
}
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const key = (r) => r.net + ":" + r.token;

export function validateAgentRows(rows) {
  const errors = [];
  if (!Array.isArray(rows) || rows.length === 0) return ["agents.json is empty or not a list"];
  const seen = new Set();
  rows.forEach((r, i) => {
    const p = `agent row ${i}`;
    if (!r || typeof r !== "object" || !Array.isArray(r.agents)) { errors.push(`${p}: not an object with an agents list`); return; }
    if (seen.has(key(r))) errors.push(`${p}: duplicate token row ${key(r).slice(0, 20)}`);
    seen.add(key(r));
    if (typeof r.active !== "boolean") errors.push(`${p}: active is missing`);
    const addrs = new Set();
    for (const a of r.agents) {
      if (!a || !ADDR_LOWER.test(String(a.address))) { errors.push(`${p}: agent address is not a valid lowercase address`); continue; }
      if (addrs.has(a.address)) errors.push(`${p}: the same agent is listed twice`);
      addrs.add(a.address);
      if (!AGENT_TYPES.includes(a.type)) { errors.push(`${p}: invalid agent type ${JSON.stringify(a.type)}`); continue; }
      const c = a.controller;
      switch (a.type) {
        case "account_direct":
          if (c !== a.address) errors.push(`${p}: account_direct agent but the controller differs from the agent`);
          break;
        case "account_via_contract":
          if (!(ADDR_LOWER.test(String(c)) && c !== a.address)) errors.push(`${p}: account_via_contract agent but the controller is missing or equals the agent`);
          break;
        case "safe_multisig":
        case "safe_threshold_1": {
          const d = a.detail;
          const ok = d && Number.isInteger(d.threshold) && Number.isInteger(d.n) && d.threshold >= 1 && d.n >= d.threshold && ADDR_LOWER.test(String(c));
          const thresholdOk = d && (a.type === "safe_multisig" ? d.threshold >= 2 : d.threshold === 1);
          if (!ok || !thresholdOk) errors.push(`${p}: ${a.type} agent but detail, threshold or controller disagree`);
          break;
        }
        case "timelock":
        case "other_contract":
          if (!ADDR_LOWER.test(String(c))) errors.push(`${p}: ${a.type} agent without a controller`);
          break;
        case "renounced":
          if (![ZERO, DEAD].includes(c)) errors.push(`${p}: renounced agent but the controller is not the zero or dead address`);
          break;
        default:
          if (c !== null) errors.push(`${p}: ${a.type} agent but a controller is filled`);
      }
    }
    if (r.level !== rowLevel(r)) errors.push(`${p}: level ${JSON.stringify(r.level)} does not follow from the owner type and the agent types`);
  });
  return errors;
}

/** rows: the parsed data/tokens.json. read(path): the text of a file or null. */
export function checkAgents(rows, read) {
  const errors = [];
  const agentsText = read("data/agents.json"), summaryText = read("data/agents-summary.json"), sums = read("data/SHA256SUMS"), readme = read("README.md");
  for (const [name, v] of [["data/agents.json", agentsText], ["data/agents-summary.json", summaryText]]) if (v === null) errors.push(`missing file: ${name}`);
  if (errors.length) return errors;
  let agentRows, summary;
  try { agentRows = JSON.parse(agentsText); } catch { return ["data/agents.json is not valid JSON (truncated?)"]; }
  try { summary = JSON.parse(summaryText); } catch { return ["data/agents-summary.json is not valid JSON"]; }
  errors.push(...validateAgentRows(agentRows));
  if (!Array.isArray(agentRows) || agentRows.length === 0) return errors;
  // the agent rows mirror the owner rows: same tokens, same active flag, same owner type
  const owner = new Map(rows.map((r) => [key(r), r]));
  const mine = new Map(agentRows.map((r) => [key(r), r]));
  for (const k of owner.keys()) if (!mine.has(k)) errors.push(`agents.json has no row for ${k.slice(0, 20)}`);
  for (const k of mine.keys()) if (!owner.has(k)) errors.push(`agents.json has a row that is not in tokens.json: ${k.slice(0, 20)}`);
  for (const [k, r] of mine) {
    const o = owner.get(k);
    if (!o) continue;
    if (r.owner_type !== o.type) errors.push(`agents.json: owner_type of ${k.slice(0, 20)} differs from tokens.json`);
    if (r.active !== o.active) errors.push(`agents.json: active flag of ${k.slice(0, 20)} differs from tokens.json`);
  }
  const fresh = summarizeAgents(agentRows);
  if (!same(fresh, summary.summary)) errors.push("data/agents-summary.json does not match a fresh count of the agent rows");
  const m = summary.measured || {};
  const e = m.events || {};
  const counted = fresh.agents_total;
  const expected = e.added - e.duplicate_adds - (e.removed - e.unmatched_removes);
  if (![e.added, e.removed, e.duplicate_adds, e.unmatched_removes].every((x) => Number.isInteger(x) && x >= 0) || e.duplicate_adds > e.added || e.unmatched_removes > e.removed || counted !== expected) errors.push(`the number of agents (${counted}) does not follow from the event counts in data/agents-summary.json (${expected})`);
  const hash = createHash("sha256").update(agentsText).digest("hex");
  const fm = /^([0-9a-f]{64})\s+agents\.json\s*$/m.exec(sums || "");
  if (!fm || fm[1] !== hash) errors.push("fingerprint of agents.json in data/SHA256SUMS does not match data/agents.json");
  if (!readme.includes("`" + hash + "`")) errors.push("fingerprint of data/agents.json is not in the README");
  const block = AGENT_NUMBERS_RE.exec(readme);
  if (!block) errors.push("README has no AGENTNUMBERS block");
  else {
    let published;
    try { published = JSON.parse(block[1]); } catch { errors.push("AGENTNUMBERS block in the README is not valid JSON"); }
    if (published && !same(published, headlineAgents(fresh))) errors.push("agent numbers in the README do not match a fresh count");
  }
  const sentences = AGENT_SUMMARY_RE.exec(readme);
  if (!sentences) errors.push("README has no AGENTSUMMARY block");
  else if (sentences[1].trim() !== agentText(fresh, summary.measured)) errors.push("agent sentences in the README do not match a fresh count");
  return errors;
}

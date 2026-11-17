// Agent census: pure functions. Chain data comes in as plain objects, so the counting can be re-run offline.
import { SINGLE_KEY } from "./classify.mjs";
import { tokenLevel } from "./levels.mjs";

export const ADDED_TOPIC = "0xf68e73cec97f2d70aa641fb26e87a4383686e2efacb648f2165aeb02ac562ec5"; // AgentAdded(address indexed _agent)
export const REMOVED_TOPIC = "0xed9c8ad8d5a0a66898ea49d2956929c93ae2e8bd50281b2ed897c5d1a6737e0b"; // AgentRemoved(address indexed _agent)

const num = (h) => parseInt(h, 16);
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : 0);

/**
 * Logs of both events on ONE network -> the current agents of every token in tokenSet.
 * History is replayed in block and log order. The counts let a reader check that no agent was left out:
 * agents on the list = added - duplicate_adds - (removed - unmatched_removes).
 */
export function reduceAgentLogs(logs, tokenSet) {
  const mine = logs.filter((l) => tokenSet.has(String(l.address).toLowerCase()) && Array.isArray(l.topics) && l.topics.length === 2 && /^0x[0-9a-fA-F]{64}$/.test(String(l.topics[1])));
  mine.sort((a, b) => num(a.blockNumber) - num(b.blockNumber) || num(a.logIndex) - num(b.logIndex));
  const per = new Map();
  const c = { added: 0, removed: 0, duplicate_adds: 0, unmatched_removes: 0 };
  for (const l of mine) {
    const token = String(l.address).toLowerCase();
    const agent = "0x" + String(l.topics[1]).slice(26).toLowerCase();
    const kind = String(l.topics[0]).toLowerCase();
    if (!per.has(token)) per.set(token, new Set());
    const set = per.get(token);
    if (kind === ADDED_TOPIC) { c.added++; if (set.has(agent)) c.duplicate_adds++; set.add(agent); }
    else if (kind === REMOVED_TOPIC) { c.removed++; if (!set.has(agent)) c.unmatched_removes++; set.delete(agent); }
  }
  return { agents: new Map([...per].map(([t, s]) => [t, [...s].sort()])), counts: c };
}

const DIRECT_KEY = ["account_direct", "safe_threshold_1"];
export const agentTypes = (row) => row.agents.map((a) => a.type);
export const rowLevel = (row) => tokenLevel(row.owner_type, agentTypes(row));

export function summarizeAgents(rows) {
  const active = rows.filter((r) => r.active);
  const lv = (list) => ({
    level0: list.filter((r) => rowLevel(r) === 0).length,
    level1: list.filter((r) => rowLevel(r) === 1).length,
    not_classified: list.filter((r) => rowLevel(r) === null).length,
  });
  const dist = { 0: 0, 1: 0, 2: 0, 3: 0, "4_or_more": 0 };
  for (const r of rows) dist[r.agents.length >= 4 ? "4_or_more" : r.agents.length]++;
  const types = {};
  for (const r of rows) for (const a of r.agents) types[a.type] = (types[a.type] || 0) + 1;
  const hasSingle = (r) => r.agents.some((a) => SINGLE_KEY.includes(a.type));
  const hasDirect = (r) => r.agents.some((a) => DIRECT_KEY.includes(a.type));
  return {
    tokens: rows.length,
    active: active.length,
    with_agents: rows.filter((r) => r.agents.length > 0).length,
    agents_total: rows.reduce((n, r) => n + r.agents.length, 0),
    agents_distinct: new Set(rows.flatMap((r) => r.agents.map((a) => r.net + ":" + a.address))).size,
    agent_count: dist,
    agent_types: Object.fromEntries(Object.entries(types).sort((a, b) => a[0].localeCompare(b[0]))),
    single_key_agent_all: rows.filter(hasSingle).length,
    single_key_agent_active: active.filter(hasSingle).length,
    single_key_agent_direct_all: rows.filter(hasDirect).length,
    single_key_agent_direct_active: active.filter(hasDirect).length,
    level_all: lv(rows),
    level_active: lv(active),
    owner_multisig_held_down: rows.filter((r) => r.owner_type === "safe_multisig" && rowLevel(r) === 0).length,
  };
}

export function headlineAgents(s) {
  return {
    tokens_with_agents: s.with_agents,
    agents_distinct: s.agents_distinct,
    single_key_agent_direct_pct_all: pct(s.single_key_agent_direct_all, s.tokens),
    single_key_agent_direct_pct_active: pct(s.single_key_agent_direct_active, s.active),
    single_key_agent_pct_all: pct(s.single_key_agent_all, s.tokens),
    single_key_agent_pct_active: pct(s.single_key_agent_active, s.active),
    level0_pct_all: pct(s.level_all.level0, s.tokens),
    level1_pct_all: pct(s.level_all.level1, s.tokens),
    not_classified_pct_all: pct(s.level_all.not_classified, s.tokens),
    level0_pct_active: pct(s.level_active.level0, s.active),
    level1_pct_active: pct(s.level_active.level1, s.active),
    not_classified_pct_active: pct(s.level_active.not_classified, s.active),
    owner_multisig_held_down: s.owner_multisig_held_down,
  };
}

/** The plain sentences in the README; generated from the numbers so they cannot drift. */
export function agentText(s, measured) {
  const h = headlineAgents(s);
  const lines = [
    `Of ${s.tokens} token issuances, ${s.with_agents} have at least one agent (${s.agents_distinct} distinct agent addresses in total). In ERC-3643 an agent can mint, burn, freeze and force transfers on its own, and the owner can add and remove agents.`,
    `${h.single_key_agent_direct_pct_all}% of all issuances, and ${h.single_key_agent_direct_pct_active}% of the ${s.active} active ones, have at least one agent that is directly an account or a Safe that needs one signature. Counting also agents that are contracts whose owner() chain ends at an account, the shares are ${h.single_key_agent_pct_all}% and ${h.single_key_agent_pct_active}%.`,
    `By the weakest role holder (the owner and every agent), ${h.level0_pct_all}% of issuances are at Level 0, ${h.level1_pct_all}% at Level 1 and ${h.not_classified_pct_all}% are not classified. Among the active issuances the shares are ${h.level0_pct_active}%, ${h.level1_pct_active}% and ${h.not_classified_pct_active}%.`,
    s.owner_multisig_held_down === 0
      ? "No issuance whose owner is a Safe with a threshold of two or more is held at Level 0 by a single-key agent."
      : `${s.owner_multisig_held_down} issuances have an owner that is a Safe with a threshold of two or more, and are still at Level 0 because of a single-key agent.`,
  ];
  const e = measured && measured.events;
  if (e) lines.push(`Event counts behind the agent list: ${e.added} AgentAdded, ${e.removed} AgentRemoved, ${e.duplicate_adds} repeated adds and ${e.unmatched_removes} removals of an agent that was not listed, which leaves ${s.agents_total} agents.`);
  if (measured && measured.to_block) lines.push(`Agent events were read up to Polygon block ${measured.to_block.polygon} and Ethereum block ${measured.to_block.ethereum}.`);
  return lines.join("\n");
}

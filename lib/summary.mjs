// Summary of the rows. The same function runs when counting and when recounting.
import { SINGLE_KEY, MULTI_PARTY } from "./classify.mjs";

const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : 0);

export function isActive(row) {
  return row.supply !== null && row.supply !== undefined && /^\d+$/.test(row.supply) && BigInt(row.supply) > 0n && row.paused !== true;
}

function tally(rows) {
  const b = {};
  for (const r of rows) b[r.type] = (b[r.type] || 0) + 1;
  return Object.fromEntries(Object.entries(b).sort((a, c) => a[0].localeCompare(c[0])));
}
function share(rows) {
  const n = rows.length;
  return {
    single_key_pct: pct(rows.filter((r) => SINGLE_KEY.includes(r.type)).length, n),
    multi_party_pct: pct(rows.filter((r) => MULTI_PARTY.includes(r.type)).length, n),
  };
}
// Final controllers, counted per issuance. The zero and dead addresses (type renounced) are not a controller.
function controllerCounts(rows) {
  const m = new Map();
  for (const r of rows) if (r.controller && r.type !== "renounced") m.set(r.net + ":" + r.controller, (m.get(r.net + ":" + r.controller) || 0) + 1);
  return [...m.values()].sort((a, b) => b - a);
}

export function summarize(rows) {
  const active = rows.filter(isActive);
  const ca = controllerCounts(active);
  const totA = ca.reduce((a, b) => a + b, 0);
  const top = (k) => pct(ca.slice(0, k).reduce((a, b) => a + b, 0), totA);
  return {
    tokens: rows.length,
    polygon: rows.filter((r) => r.net === "polygon").length,
    ethereum: rows.filter((r) => r.net === "ethereum").length,
    active: active.length,
    distinct_factories: new Set(rows.map((r) => r.net + ":" + r.factory)).size,
    types_all: tally(rows),
    types_active: tally(active),
    all: share(rows),
    active_share: share(active),
    eip7702_tokens: rows.filter((r) => r.e7702).length,
    distinct_controllers_all: controllerCounts(rows).length,
    distinct_controllers_active: ca.length,
    top10_controllers_share_active_pct: top(10),
    top50_controllers_share_active_pct: top(50),
  };
}

/** The small block that sits in the README and is compared when recounting. */
export function headline(s) {
  return {
    tokens: s.tokens,
    active: s.active,
    single_key_pct_all: s.all.single_key_pct,
    multi_party_pct_all: s.all.multi_party_pct,
    single_key_pct_active: s.active_share.single_key_pct,
    multi_party_pct_active: s.active_share.multi_party_pct,
    distinct_factories: s.distinct_factories,
    distinct_controllers_active: s.distinct_controllers_active,
    top50_controllers_share_active_pct: s.top50_controllers_share_active_pct,
  };
}

/** The plain sentences in the README; generated from the numbers so they cannot drift. */
export function readableText(s, measured) {
  const h = headline(s);
  const lines = [
    `Of ${s.tokens} token issuances (${s.polygon} on Polygon, ${s.ethereum} on Ethereum), ${h.single_key_pct_all}% have a single account or a Safe that needs one signature as owner, and ${h.multi_party_pct_all}% need more than one party (a Safe with a threshold of two or more, or a timelock that answers getMinDelay()).`,
    `Among the ${s.active} active issuances (supply above zero, not paused) the shares are ${h.single_key_pct_active}% and ${h.multi_party_pct_active}%.`,
    `The 50 largest of the ${s.distinct_controllers_active} distinct final controllers of active issuances are the final controller of ${h.top50_controllers_share_active_pct}% of the active issuances (counted per issuance, not by supply).`,
    `The ${s.tokens} issuances come from ${s.distinct_factories} distinct factory contracts that emitted the standard event. Anyone can deploy such a factory, so the list includes small and test deployments.`,
  ];
  if (measured && measured.started && measured.block_start) {
    lines.push(`Measured on ${String(measured.started).slice(0, 10)} at Polygon block ${measured.block_start.polygon} and Ethereum block ${measured.block_start.ethereum}.`);
  }
  return lines.join("\n");
}

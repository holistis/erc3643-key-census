// The key-control card of one token: owner, agents and level, put into words. Pure: rows in, text out.
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const PLAIN = {
  account_direct: "one account address",
  account_via_contract: "a contract whose owner() chain ends at one account",
  timelock: "a timelock (it answers getMinDelay())",
  other_contract: "a contract that is not an account, a Safe or a timelock (not classified further)",
  renounced: "renounced (the zero or the dead address)",
  self_owned: "the token itself",
  no_owner: "the token has no owner()",
  cycle: "an owner chain that loops",
  too_deep: "an owner chain that is longer than the limit",
  not_measured: "not measured (code data was missing)",
  unreadable: "the token answered nothing",
};

export function typeText(type, detail) {
  if (type === "safe_multisig" || type === "safe_threshold_1") {
    return detail && Number.isInteger(detail.threshold) ? `a Safe that needs ${detail.threshold} of ${detail.n} signatures` : "a Safe";
  }
  return PLAIN[type] ?? type;
}

export const LEVEL_TEXT = {
  0: "Level 0: at least one role holder is a single address that can act alone",
  1: "Level 1: every role holder is a Safe that needs two or more signatures",
  null: "not classified: no single address was found, but not every role holder is a Safe that needs two or more signatures",
};

/** Finds the token (and its agent row) in the two data files. net is optional; without it every network that has the address is returned. */
export function findCards(tokens, agents, address, net = null) {
  const a = String(address).toLowerCase();
  const byKey = new Map(agents.map((r) => [r.net + ":" + r.token, r]));
  return tokens
    .filter((t) => t.token === a && (!net || t.net === net))
    .map((t) => ({ token: t, agents: byKey.get(t.net + ":" + t.token) ?? null }));
}

const short = (x) => (x === null || x === undefined ? "none" : x);

export function cardText({ token: t, agents: g }, { ownerBlock, agentBlock, recount }) {
  const out = [];
  out.push("ERC-3643 key-control card");
  out.push(`token     ${t.token}  (${t.net})`);
  out.push(`status    ${t.active ? "active (supply above zero, not paused)" : "not active (supply is zero or the token is paused)"}`);
  out.push(`measured  owner at block ${ownerBlock ?? "unknown"}, agent events up to block ${agentBlock ?? "unknown"}`);
  out.push("");
  out.push(`owner     ${short(t.owner)}`);
  out.push(`          ${typeText(t.type, t.detail)}`);
  if (t.controller && t.controller !== t.owner) out.push(`          final controller ${t.controller} (chain ${t.chain.join(" > ")})`);
  else if (t.controller) out.push(`          final controller is the owner itself`);
  if (g) {
    out.push(`agents    ${g.agents.length}`);
    g.agents.forEach((x, i) => {
      out.push(`  ${String(i + 1).padStart(2)}  ${x.address}`);
      out.push(`      ${typeText(x.type, x.detail)}`);
      if (x.controller && x.controller !== x.address) out.push(`      final controller ${x.controller}`);
    });
    out.push(`level     ${LEVEL_TEXT[g.level === null ? "null" : g.level]}`);
  } else {
    out.push("agents    not read for this token");
  }
  out.push("");
  out.push("This is structure, not safety. An account address can be custody software (MPC, HSM, a custodian), which a chain does not show.");
  out.push("Not read: agents of the identity registry, upgrade rights, and anything off chain. No issuer is named or judged.");
  out.push(`Recount of the data before this card: GREEN (${recount.rows} tokens, fingerprint ${recount.hash.slice(0, 12)}).`);
  out.push("Cite as: holistis (github.com/holistis), ERC-3643 key-control census, https://github.com/holistis/erc3643-key-census");
  return out.join("\n");
}

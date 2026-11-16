// Classification of who controls a token. Pure: all chain data comes in through the object w.
export const ZERO = "0x0000000000000000000000000000000000000000";
export const DEAD = "0x000000000000000000000000000000000000dead";
export const TYPES = [
  "account_direct", // owner() is an account (no code, or an EIP-7702 delegated account)
  "account_via_contract", // owner() is a contract whose owner() chain ends at an account
  "safe_multisig", // Safe with a threshold of two or more
  "safe_threshold_1", // Safe with threshold 1: a single signer is enough
  "timelock", // contract that answers getMinDelay()
  "other_contract", // contract without owner(), Safe or timelock: not classified further
  "renounced", // owner is the zero address or 0x...dead
  "self_owned", // the token is its own owner
  "no_owner", // the token has no owner()
  "cycle", // the owner chain loops
  "too_deep", // the owner chain is longer than the limit
  "not_measured", // code data is missing
  "unreadable", // the token answers nothing
];
export const SINGLE_KEY = ["account_direct", "account_via_contract", "safe_threshold_1"];
export const MULTI_PARTY = ["safe_multisig", "timelock"];

/**
 * w.code(address)     -> bytes of code, 0 for an account, undefined when unknown
 * w.safe(address)     -> { threshold, n } or null
 * w.timelock(address) -> boolean
 * w.owner(address)    -> owner() of that contract, or null
 */
export function classify(tokenAddr, ownerAddr, w, maxDepth = 5) {
  const token = String(tokenAddr).toLowerCase();
  const chain = [];
  const seen = new Set([token]);
  let cur = ownerAddr ? String(ownerAddr).toLowerCase() : null;
  for (let d = 0; d <= maxDepth; d++) {
    if (!cur) return { type: "no_owner", chain };
    if (cur === ZERO || cur === DEAD) return { type: "renounced", chain, controller: cur };
    if (cur === token) return { type: "self_owned", chain };
    if (seen.has(cur)) return { type: "cycle", chain };
    seen.add(cur);
    chain.push(cur);
    const code = w.code(cur);
    if (code === undefined || code === null) return { type: "not_measured", chain };
    if (code === 0) return { type: d === 0 ? "account_direct" : "account_via_contract", chain, controller: cur };
    const safe = w.safe(cur);
    if (safe) return { type: safe.threshold >= 2 ? "safe_multisig" : "safe_threshold_1", chain, controller: cur, detail: safe };
    if (w.timelock(cur)) return { type: "timelock", chain, controller: cur };
    const nx = w.owner(cur);
    if (!nx) return { type: "other_contract", chain, controller: cur };
    cur = String(nx).toLowerCase();
  }
  return { type: "too_deep", chain };
}

/** EIP-7702: an account with exactly 23 bytes of code starting with 0xef0100 is still an account. */
export function isDelegatedAccount(codeHex) {
  return typeof codeHex === "string" && codeHex.length === 48 && codeHex.slice(0, 8).toLowerCase() === "0xef0100" && /^0x[0-9a-fA-F]{46}$/.test(codeHex);
}

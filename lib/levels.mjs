// Control levels. One pure function; the definitions in LEVELS.md are written from this file.
import { SINGLE_KEY } from "./classify.mjs";

// A role holder that is the zero or dead address, or the token itself, cannot act, so it is not counted.
const INERT = ["renounced", "self_owned"];

/**
 * ownerType: the type of the final controller of owner() (see classify.mjs).
 * agentTypes: the types of the final controllers of every current agent.
 * Role holders are the owner and every agent, minus the ones that cannot act. The weakest role holder decides:
 * Level 0 if any of them is a single key, Level 1 if all of them are Safes with two or more signatures, otherwise null.
 */
export function tokenLevel(ownerType, agentTypes) {
  const holders = [ownerType, ...agentTypes].filter((t) => !INERT.includes(t));
  if (holders.some((t) => SINGLE_KEY.includes(t))) return 0;
  if (holders.length > 0 && holders.every((t) => t === "safe_multisig")) return 1;
  return null;
}

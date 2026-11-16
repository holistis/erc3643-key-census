import test from "node:test";
import assert from "node:assert/strict";
import { classify, isDelegatedAccount, ZERO, DEAD, TYPES } from "../lib/classify.mjs";

const mk = (o) => ({ code: (a) => o.code?.[a], safe: (a) => o.safe?.[a] || null, timelock: (a) => !!o.timelock?.[a], owner: (a) => o.owner?.[a] || null });
const T = "0xaaaa000000000000000000000000000000000001";
const A = "0xaaaa000000000000000000000000000000000002";
const B = "0xaaaa000000000000000000000000000000000003";

const cases = [
  ["account", () => classify(T, A, mk({ code: { [A]: 0 } })), "account_direct"],
  ["account via one contract", () => classify(T, A, mk({ code: { [A]: 99, [B]: 0 }, owner: { [A]: B } })), "account_via_contract"],
  ["safe 2 of 3", () => classify(T, A, mk({ code: { [A]: 99 }, safe: { [A]: { threshold: 2, n: 3 } } })), "safe_multisig"],
  ["safe threshold 1", () => classify(T, A, mk({ code: { [A]: 99 }, safe: { [A]: { threshold: 1, n: 3 } } })), "safe_threshold_1"],
  ["timelock", () => classify(T, A, mk({ code: { [A]: 99 }, timelock: { [A]: true } })), "timelock"],
  ["zero owner", () => classify(T, ZERO, mk({})), "renounced"],
  ["dead owner", () => classify(T, DEAD, mk({})), "renounced"],
  ["token owns itself", () => classify(T, T, mk({ code: { [T]: 99 } })), "self_owned"],
  ["cycle A to B to A", () => classify(T, A, mk({ code: { [A]: 9, [B]: 9 }, owner: { [A]: B, [B]: A } })), "cycle"],
  ["owner chain too deep", () => {
    const ad = Array.from({ length: 9 }, (_, i) => "0xbbbb00000000000000000000000000000000000" + i);
    const code = {}, owner = {};
    ad.forEach((x, i) => { code[x] = 9; if (i < 8) owner[x] = ad[i + 1]; });
    return classify(T, ad[0], mk({ code, owner }));
  }, "too_deep"],
  ["code unknown", () => classify(T, A, mk({})), "not_measured"],
  ["no owner()", () => classify(T, null, mk({})), "no_owner"],
  ["opaque contract", () => classify(T, A, mk({ code: { [A]: 9 } })), "other_contract"],
  ["a Safe above an owner chain wins", () => classify(T, A, mk({ code: { [A]: 9, [B]: 9 }, owner: { [A]: B }, safe: { [B]: { threshold: 2, n: 2 } } })), "safe_multisig"],
  ["upper-case owner address is normalised", () => classify(T.toUpperCase().replace("0X", "0x"), A.toUpperCase().replace("0X", "0x"), mk({ code: { [A]: 0 } })), "account_direct"],
];
for (const [name, run, want] of cases) test("classify: " + name, () => assert.equal(run().type, want));

test("every type produced is a declared type", () => {
  for (const [, run] of cases) assert.ok(TYPES.includes(run().type));
});
test("controller and chain are filled consistently", () => {
  const r = classify(T, A, mk({ code: { [A]: 99, [B]: 0 }, owner: { [A]: B } }));
  assert.deepEqual(r.chain, [A, B]);
  assert.equal(r.controller, B);
});
test("isDelegatedAccount: EIP-7702 delegation is an account, anything else is not", () => {
  const d = "0xef0100" + "ab".repeat(20);
  assert.equal(isDelegatedAccount(d), true);
  assert.equal(isDelegatedAccount(d.toUpperCase().replace("0X", "0x")), true);
  assert.equal(isDelegatedAccount("0xef0101" + "ab".repeat(20)), false); // other prefix
  assert.equal(isDelegatedAccount("0xef0100" + "ab".repeat(19)), false); // 22 bytes
  assert.equal(isDelegatedAccount("0xef0100" + "ab".repeat(21)), false); // 24 bytes
  assert.equal(isDelegatedAccount("0x"), false); // plain account
  assert.equal(isDelegatedAccount("0x6080" + "00".repeat(30)), false);
  assert.equal(isDelegatedAccount(undefined), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { compareRows, verifyVerdict } from "../lib/compare.mjs";
import { validateRows } from "../lib/validate.mjs";

const r = (token, type, controller = null, net = "polygon") => ({ net, token, type, controller });

test("compareRows: same, differs, only in one side", () => {
  const a = [r("0x1", "account_direct", "0xa"), r("0x2", "safe_multisig", "0xb"), r("0x3", "timelock", "0xc")];
  const b = [r("0x1", "account_direct", "0xa"), r("0x2", "account_direct", "0xb"), r("0x4", "account_direct", "0xd")];
  const c = compareRows(a, b);
  assert.equal(c.same, 1);
  assert.deepEqual(c.differs.map((d) => d.key), ["polygon:0x2"]);
  assert.deepEqual(c.onlyA, ["polygon:0x3"]);
  assert.deepEqual(c.onlyB, ["polygon:0x4"]);
});
test("compareRows: the same address on two networks is two different tokens", () => {
  const c = compareRows([r("0x1", "account_direct", "0xa", "polygon")], [r("0x1", "account_direct", "0xa", "ethereum")]);
  assert.equal(c.same, 0);
  assert.equal(c.onlyA.length, 1);
  assert.equal(c.onlyB.length, 1);
});
test("compareRows: a change of controller alone is a difference", () => {
  assert.equal(compareRows([r("0x1", "account_direct", "0xa")], [r("0x1", "account_direct", "0xb")]).differs.length, 1);
});
test("verifyVerdict: tolerates up to 5 percent, strict tolerates none, an empty sample is red", () => {
  assert.equal(verifyVerdict({ n: 200, differs: 10, unreadable: 0 }), true);
  assert.equal(verifyVerdict({ n: 200, differs: 11, unreadable: 0 }), false);
  assert.equal(verifyVerdict({ n: 200, differs: 0, unreadable: 11 }), false);
  assert.equal(verifyVerdict({ n: 200, differs: 1, unreadable: 0 }, true), false);
  assert.equal(verifyVerdict({ n: 200, differs: 0, unreadable: 0 }, true), true);
  assert.equal(verifyVerdict({ n: 0, differs: 0, unreadable: 0 }), false);
  // every sampled row differing must never pass by default
  assert.equal(verifyVerdict({ n: 60, differs: 60, unreadable: 0 }), false);
});

const base = { net: "polygon", token: "0x" + "11".repeat(20), factory: "0x" + "22".repeat(20), supply: "0", paused: false, owner: null, controller: null, chain: [], detail: null, e7702: false, active: false };
test("validateRows: self_owned must own itself, with no chain and no controller", () => {
  assert.deepEqual(validateRows([{ ...base, type: "self_owned", owner: base.token }]), []);
  assert.ok(validateRows([{ ...base, type: "self_owned", owner: "0x" + "33".repeat(20) }]).length > 0);
  assert.ok(validateRows([{ ...base, type: "self_owned", owner: base.token, chain: ["0x" + "33".repeat(20)] }]).length > 0);
});
test("validateRows: cycle, too_deep and not_measured need a chain that starts at the owner and no controller", () => {
  const o = "0x" + "33".repeat(20);
  for (const type of ["cycle", "too_deep", "not_measured"]) {
    assert.deepEqual(validateRows([{ ...base, type, owner: o, chain: [o] }]), []);
    assert.ok(validateRows([{ ...base, type, owner: o, chain: [] }]).length > 0, type + " without chain");
    assert.ok(validateRows([{ ...base, type, owner: o, chain: [o], controller: o }]).length > 0, type + " with controller");
  }
});
test("validateRows: renounced needs the zero or dead address and a consistent owner", () => {
  const dead = "0x000000000000000000000000000000000000dead";
  assert.deepEqual(validateRows([{ ...base, type: "renounced", owner: dead, controller: dead }]), []);
  assert.ok(validateRows([{ ...base, type: "renounced", owner: "0x" + "33".repeat(20), controller: dead }]).length > 0);
  assert.ok(validateRows([{ ...base, type: "renounced", owner: dead, controller: "0x" + "33".repeat(20) }]).length > 0);
});

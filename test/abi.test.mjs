import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SEL, encodeAggregate3, decodeAggregate3, decUint, decBool, decAddress, decString, decArrayLength } from "../lib/abi.mjs";

const fx = JSON.parse(readFileSync(new URL("./fixtures/abi-vectors.json", import.meta.url), "utf8"));

test("selectors match the vectors made with ethers", () => {
  assert.deepEqual(SEL, fx.selectors);
});
test("encodeAggregate3 reproduces the ethers calldata byte for byte", () => {
  assert.equal(encodeAggregate3(fx.calls), fx.encodedCalldata);
});
test("decodeAggregate3 reproduces the ethers results, including odd lengths and empty data", () => {
  assert.deepEqual(decodeAggregate3(fx.encodedResult), fx.results);
});
test("decodeAggregate3 refuses truncated and non-hex input", () => {
  assert.throws(() => decodeAggregate3(fx.encodedResult.slice(0, fx.encodedResult.length - 120)), /truncated/);
  assert.throws(() => decodeAggregate3("0xzz"), /hex/);
  assert.throws(() => decodeAggregate3("0x"), /truncated/);
});
test("encodeAggregate3 refuses bad input", () => {
  assert.throws(() => encodeAggregate3([]), /number of calls/);
  assert.throws(() => encodeAggregate3([{ target: "0x12", data: "0x" }]), /address/);
  assert.throws(() => encodeAggregate3([{ target: "0x" + "ab".repeat(20), data: "0xabc" }]), /data/);
});
test("value decoders accept good data and reject short or dirty data", () => {
  const A = "0x" + "00".repeat(12) + "0921785a4b0f184141a9afff0f8b3b37e50caf46";
  assert.equal(decAddress(A), "0x0921785a4b0f184141a9afff0f8b3b37e50caf46");
  assert.equal(decAddress("0x" + "11".repeat(32)), undefined); // upper bytes not zero
  assert.equal(decAddress("0x1234"), undefined);
  assert.equal(decUint("0x" + "00".repeat(31) + "05"), 5n);
  assert.equal(decBool("0x" + "00".repeat(31) + "01"), true);
  assert.equal(decBool("0x" + "00".repeat(32)), false);
  assert.equal(decUint("0x"), undefined);
});
test("decString reads a normal string, strips control characters, bounds length, rejects lies", () => {
  const enc = (s) => { const b = Buffer.from(s, "utf8"); return "0x" + "20".padStart(64, "0") + b.length.toString(16).padStart(64, "0") + b.toString("hex").padEnd(Math.ceil(b.length / 32) * 64, "0"); };
  assert.equal(decString(enc("RNCRrev")), "RNCRrev");
  assert.equal(decString(enc("a\u0000b\u0007c\nd")), "abcd");
  assert.equal(decString(enc("x".repeat(500))).length, 64);
  const lie = "0x" + "20".padStart(64, "0") + "ffff".padStart(64, "0") + "61".padEnd(64, "0"); // claims a long length
  assert.equal(decString(lie), undefined);
  assert.equal(decString("0x" + "20".padStart(64, "0")), undefined);
});
test("decArrayLength reads the length of an address array and rejects lies", () => {
  const arr = (n) => "0x" + "20".padStart(64, "0") + n.toString(16).padStart(64, "0") + "00".repeat(32 * n);
  assert.equal(decArrayLength(arr(3)), 3);
  assert.equal(decArrayLength(arr(0)), 0);
  assert.equal(decArrayLength("0x" + "20".padStart(64, "0") + "05".padStart(64, "0")), undefined); // claims 5 elements, has none
});

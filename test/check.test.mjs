import test from "node:test";
import assert from "node:assert/strict";
import { checkAll } from "../lib/validate.mjs";
import { selftest, mutations } from "../check.mjs";
import { summarize, isActive } from "../lib/summary.mjs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test("the published data recounts green", () => {
  const r = checkAll(ROOT);
  assert.ok(r.ok, r.errors?.join("; "));
});
test("the selftest catches every planted error", () => {
  const r = selftest(() => {});
  assert.equal(r.caught, r.total);
  assert.ok(r.total >= 30, "the mutation matrix must keep at least thirty planted errors");
  assert.ok(r.ok);
});
test("an empty directory is red, not a crash", () => {
  const r = checkAll(ROOT + "/test/fixtures");
  assert.equal(r.ok, false);
});
test("summarize on an empty list does not divide by zero", () => {
  const s = summarize([]);
  assert.equal(s.tokens, 0);
  assert.equal(s.all.single_key_pct, 0);
});
test("isActive: supply above zero and not paused", () => {
  assert.equal(isActive({ supply: "5", paused: false }), true);
  assert.equal(isActive({ supply: "5", paused: null }), true);
  assert.equal(isActive({ supply: "5", paused: true }), false);
  assert.equal(isActive({ supply: "0", paused: false }), false);
  assert.equal(isActive({ supply: null, paused: false }), false);
});
test("mutation matrix covers change, remove, add, duplicate, swap, empty, truncate, variant", () => {
  const names = mutations("[]").map((m) => m[0]).join(" | ");
  for (const w of ["flipped", "omission", "added", "duplicate", "swapped", "emptied", "truncated", "variant"]) assert.ok(names.includes(w), "missing mutation kind: " + w);
});

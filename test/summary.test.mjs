import test from "node:test";
import assert from "node:assert/strict";
import { summarize, headline, readableText } from "../lib/summary.mjs";

const row = (net, token, type, controller, supply = "1", paused = false, extra = {}) => ({ net, token, type, controller, supply, paused, e7702: false, ...extra });

test("summary counts shares over all and over active tokens", () => {
  const rows = [
    row("polygon", "0x1", "account_direct", "0xa"),
    row("polygon", "0x2", "account_direct", "0xa", "0"),
    row("polygon", "0x3", "safe_multisig", "0xb"),
    row("ethereum", "0x4", "timelock", "0xc"),
    row("ethereum", "0x5", "safe_threshold_1", "0xd", "1", true),
  ];
  const s = summarize(rows);
  assert.equal(s.tokens, 5);
  assert.equal(s.polygon, 3);
  assert.equal(s.ethereum, 2);
  assert.equal(s.active, 3);
  assert.equal(s.all.single_key_pct, 60);
  assert.equal(s.all.multi_party_pct, 40);
  assert.equal(s.active_share.single_key_pct, 33.3);
  assert.equal(s.active_share.multi_party_pct, 66.7);
  assert.equal(s.distinct_controllers_active, 3);
  assert.equal(s.top50_controllers_share_active_pct, 100);
});
test("the same controller address on two chains counts as two controllers", () => {
  const s = summarize([row("polygon", "0x1", "account_direct", "0xa"), row("ethereum", "0x2", "account_direct", "0xa")]);
  assert.equal(s.distinct_controllers_active, 2);
});
test("the readable sentences contain the headline numbers", () => {
  const s = summarize([row("polygon", "0x1", "account_direct", "0xa"), row("polygon", "0x2", "safe_multisig", "0xb")]);
  const t = readableText(s, { started: "2026-11-16T10:00:00Z", block_start: { polygon: 1, ethereum: 2 } });
  const h = headline(s);
  assert.ok(t.includes(`${h.single_key_pct_all}%`));
  assert.ok(t.includes(`${h.multi_party_pct_all}%`));
});
test("the measurement block sentence appears only when the blocks are known", () => {
  const s = summarize([row("polygon", "0x1", "account_direct", "0xa")]);
  assert.ok(readableText(s, { started: "2026-11-16T10:00:00Z", block_start: { polygon: 7, ethereum: 9 } }).includes("Polygon block 7 and Ethereum block 9"));
  assert.ok(!readableText(s).includes("block"));
});
test("renounced addresses are not counted as a controller, and factories are counted per network", () => {
  const rows = [row("polygon", "0x1", "renounced", "0x000000000000000000000000000000000000dead"), row("polygon", "0x2", "account_direct", "0xa", "1", false, { factory: "f1" }), row("ethereum", "0x3", "account_direct", "0xa", "1", false, { factory: "f1" })];
  const s = summarize(rows);
  assert.equal(s.distinct_controllers_active, 2);
  assert.equal(s.distinct_factories, 3); // undefined factory on the first row counts as one, f1 on two networks as two
});

// End-to-end test of the counting process against a local mock RPC server. No internet needed.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { runCensus } from "../census.mjs";
import { SEL, MULTICALL3 } from "../lib/abi.mjs";

const w32 = (hex) => hex.padStart(64, "0");
const encStr = (s) => { const b = Buffer.from(s, "utf8"); return "0x" + w32("20") + w32(b.length.toString(16)) + b.toString("hex").padEnd(Math.ceil(b.length / 32) * 64, "0"); };
const encAddr = (a) => "0x" + w32(a.slice(2));
const encUint = (n) => "0x" + w32(BigInt(n).toString(16));
const encBool = (b) => encUint(b ? 1 : 0);
const encArr = (n) => "0x" + w32("20") + w32(n.toString(16)) + "00".repeat(32 * n);

// parse aggregate3 calldata (our own layout, written independently in this test)
function parseCalls(data) {
  const h = data.slice(10);
  const word = (i) => parseInt(h.slice(i * 2, i * 2 + 64), 16);
  const base = word(0) + 32, n = word(word(0));
  const calls = [];
  for (let i = 0; i < n; i++) {
    const t = base + word(base + i * 32);
    const target = "0x" + h.slice((t + 12) * 2, (t + 32) * 2);
    const bo = t + word(t + 64), len = word(bo);
    calls.push({ target, data: "0x" + h.slice((bo + 32) * 2, (bo + 32 + len) * 2) });
  }
  return calls;
}
function encodeResults(results) {
  const tuples = results.map((r) => { const d = r.data.slice(2); const len = d.length / 2; return w32(r.ok ? "1" : "0") + w32("40") + w32(len.toString(16)) + d.padEnd(Math.ceil(len / 32) * 64, "0"); });
  let off = results.length * 32; const offs = [];
  for (const t of tuples) { offs.push(w32(off.toString(16))); off += t.length / 2; }
  return "0x" + w32("20") + w32(results.length.toString(16)) + offs.join("") + tuples.join("");
}

const a = (n) => "0x" + n.toString(16).padStart(40, "0");
const tok = (n) => a(0x1000 + n);
const ZERO = "0x" + "00".repeat(20);
const code = { // 0x2000 range: owners
  [a(0x2002)]: "0x" + "60".repeat(100), [a(0x2003)]: "0x" + "60".repeat(171), [a(0x2004)]: "0x" + "60".repeat(171),
  [a(0x2005)]: "0xef0100" + "ab".repeat(20), [a(0x2006)]: "0x" + "60".repeat(50), [a(0x2007)]: "0x" + "60".repeat(60),
  [a(0x2008)]: "0x" + "60".repeat(70), [a(0x2009)]: "0x" + "60".repeat(70),
};
const world = {
  tokens: {
    [tok(1)]: { symbol: "AAA", supply: 5, paused: false, owner: a(0x2001) }, // account, active
    [tok(2)]: { symbol: "BBB", supply: 0, paused: false, owner: a(0x2002) }, // via contract to account, inactive
    [tok(3)]: { symbol: "CCC", supply: 7, paused: false, owner: a(0x2003) }, // safe 2 of 3
    [tok(4)]: { symbol: "DDD", supply: 9, paused: true, owner: a(0x2004) }, // safe 1 of 2, paused
    [tok(5)]: { symbol: "EEE", supply: 3, paused: false, owner: a(0x2005) }, // EIP-7702 account
    [tok(6)]: { symbol: "FFF", supply: 1, paused: false, owner: ZERO }, // renounced
    [tok(7)]: { symbol: "GGG", supply: 1, paused: false }, // no owner()
    // tok(8): answers nothing
    [tok(9)]: { symbol: "III", supply: 4, paused: false, owner: a(0x2006) }, // timelock
    [tok(10)]: { symbol: "JJJ", supply: 4, paused: false, owner: a(0x2007) }, // opaque contract
    [tok(11)]: { symbol: "KKK", supply: 4, paused: false, owner: a(0x2008) }, // cycle 2008 <-> 2009
  },
  ctl: {
    [a(0x2002)]: { owner: a(0x2010) },
    [a(0x2003)]: { threshold: 2, owners: 3 },
    [a(0x2004)]: { threshold: 1, owners: 2 },
    [a(0x2006)]: { minDelay: 86400 },
    [a(0x2008)]: { owner: a(0x2009) },
    [a(0x2009)]: { owner: a(0x2008) },
  },
};
const FAIL = { ok: false, data: "0x" };
function answer(c) {
  const sel = c.data.slice(0, 10), t = world.tokens[c.target], x = world.ctl[c.target];
  if (t) {
    if (sel === SEL.symbol) return { ok: true, data: encStr(t.symbol) };
    if (sel === SEL.totalSupply) return { ok: true, data: encUint(t.supply) };
    if (sel === SEL.paused) return { ok: true, data: encBool(t.paused) };
    if (sel === SEL.owner) return t.owner ? { ok: true, data: encAddr(t.owner) } : FAIL;
  }
  if (x) {
    if (sel === SEL.getThreshold) return x.threshold ? { ok: true, data: encUint(x.threshold) } : FAIL;
    if (sel === SEL.getOwners) return x.owners ? { ok: true, data: encArr(x.owners) } : FAIL;
    if (sel === SEL.getMinDelay) return x.minDelay ? { ok: true, data: encUint(x.minDelay) } : FAIL;
    if (sel === SEL.owner) return x.owner ? { ok: true, data: encAddr(x.owner) } : FAIL;
  }
  return FAIL;
}
function startServer({ failCalls = 0 } = {}) {
  let n = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const first = JSON.parse(body);
      const isCall = !Array.isArray(first) && first.method === "eth_call";
      if (isCall && n++ < failCalls) { res.statusCode = 500; res.end("boom"); return; }
      const handle = (m) => {
        if (m.method === "eth_blockNumber") return { jsonrpc: "2.0", id: m.id, result: "0x10" };
        if (m.method === "eth_getCode") return { jsonrpc: "2.0", id: m.id, result: code[m.params[0].toLowerCase()] || "0x" };
        if (m.method === "eth_call" && m.params[0].to.toLowerCase() === MULTICALL3.toLowerCase()) return { jsonrpc: "2.0", id: m.id, result: encodeResults(parseCalls(m.params[0].data).map(answer)) };
        return { jsonrpc: "2.0", id: m.id, error: { message: "unsupported" } };
      };
      const j = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(Array.isArray(j) ? j.map(handle) : handle(j)));
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

const list = [
  ...Array.from({ length: 12 }, (_, i) => ({ net: "polygon", token: tok(i + 1), factory: a(0x3000) })),
  { net: "polygon", token: tok(1).toUpperCase().replace("0X", "0x"), factory: a(0x3000) }, // duplicate, upper case
  { net: "polygon", token: "0x123", factory: a(0x3000) }, // invalid address
  { net: "solana", token: tok(2), factory: a(0x3000) }, // unknown network
];
const want = { 1: "account_direct", 2: "account_via_contract", 3: "safe_multisig", 4: "safe_threshold_1", 5: "account_direct", 6: "renounced", 7: "no_owner", 8: "unreadable", 9: "timelock", 10: "other_contract", 11: "cycle", 12: "unreadable" };

test("end to end: every case is classified, duplicates and invalid input are counted, nothing is dropped silently", async () => {
  const { server, url } = await startServer();
  try {
    const { rows, meta } = await runCensus(list, { polygon: url }, { chainOptions: { tries: 1, backoffMs: 1 } });
    assert.equal(rows.length, 12);
    for (const r of rows) assert.equal(r.type, want[parseInt(r.token.slice(-4), 16) - 0x1000], "token " + r.token.slice(-4));
    assert.equal(meta.duplicates_skipped, 1);
    assert.equal(meta.invalid_address_skipped, 2);
    assert.equal(meta.transport_failures, 0);
    const byTok = (n) => rows.find((r) => r.token === tok(n));
    assert.equal(byTok(5).e7702, true);
    assert.equal(byTok(1).e7702, false);
    assert.deepEqual([1, 2, 3, 4, 5].map((n) => byTok(n).active), [true, false, true, false, true]); // supply 0 or paused is not active
    assert.equal(byTok(2).controller, a(0x2010));
    assert.deepEqual(byTok(3).detail, { threshold: 2, n: 3 });
    assert.equal(byTok(1).symbol, "AAA");
  } finally { server.close(); }
});

test("transport failures are retried and split, and still produce the same answer", async () => {
  const { server, url } = await startServer({ failCalls: 5 });
  try {
    const { rows } = await runCensus(list, { polygon: url }, { chainOptions: { tries: 1, backoffMs: 1 } });
    assert.equal(rows.length, 12);
    for (const r of rows) assert.equal(r.type, want[parseInt(r.token.slice(-4), 16) - 0x1000]);
  } finally { server.close(); }
});

test("an unreachable node is reported, not hidden", async () => {
  await assert.rejects(runCensus([{ net: "polygon", token: tok(1), factory: a(1) }], { polygon: "http://127.0.0.1:1" }, { chainOptions: { tries: 1, backoffMs: 1 } }));
});

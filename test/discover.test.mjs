import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { discover, scanLogs, TOPIC0, EVENT_SIGNATURE } from "../discover.mjs";

const fx = JSON.parse(readFileSync(new URL("./fixtures/abi-vectors.json", import.meta.url), "utf8"));
const addr = (n) => "0x" + n.toString(16).padStart(40, "0");
const topicOf = (a) => "0x" + "00".repeat(12) + a.slice(2);

test("the event topic matches the one computed with ethers", () => {
  assert.equal(EVENT_SIGNATURE, fx.event.signature);
  assert.equal(TOPIC0, fx.event.topic0);
});

// a mock chain with events at known blocks; optionally rejects ranges larger than maxRange
function mockServer({ events, head = 1000, maxRange = Infinity, other = [] }) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const m = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      if (m.method === "eth_blockNumber") return res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" + head.toString(16) }));
      if (m.method === "eth_getLogs") {
        const f = m.params[0];
        const a = parseInt(f.fromBlock, 16), b = parseInt(f.toBlock, 16);
        if (b - a + 1 > maxRange) return res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "range too large" } }));
        const logs = [...events, ...other].filter((e) => e.block >= a && e.block <= b && f.topics[0] === (e.topic0 ?? TOPIC0));
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: logs.map((e) => ({ address: e.factory, blockNumber: "0x" + e.block.toString(16), topics: [e.topic0 ?? TOPIC0, topicOf(e.token)] })) }));
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "unsupported" } }));
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
const events = [
  { block: 5, token: addr(1), factory: addr(100) },
  { block: 400, token: addr(2), factory: addr(100) },
  { block: 401, token: addr(3), factory: addr(101) },
  { block: 999, token: addr(4), factory: addr(102) },
  { block: 999, token: addr(4), factory: addr(102) }, // the same token announced twice
];
const other = [{ block: 7, token: addr(9), factory: addr(103), topic0: "0x" + "ee".repeat(32) }]; // a different event: must be ignored

test("discover lists every announced token once, with factories, and ignores other events", async () => {
  const { server, url } = await mockServer({ events, other });
  try {
    const { list, meta } = await discover({ polygon: url }, { minWindow: 10 });
    assert.deepEqual(list.map((t) => t.token), [addr(1), addr(2), addr(3), addr(4)]);
    assert.equal(meta.nets.polygon.events, 5);
    assert.equal(meta.nets.polygon.duplicates_skipped, 1);
    assert.equal(meta.nets.polygon.unique_tokens, 4);
    assert.equal(meta.nets.polygon.distinct_factories, 3);
    assert.equal(meta.nets.polygon.to_block, 1000);
  } finally { server.close(); }
});

test("a node that refuses large ranges is handled by splitting, and nothing is lost", async () => {
  const { server, url } = await mockServer({ events, maxRange: 50 });
  try {
    const { list } = await discover({ polygon: url }, { minWindow: 10, tries: 1 });
    assert.equal(list.length, 4);
  } finally { server.close(); }
});

test("fixed chunking covers the whole range including the last partial chunk", async () => {
  const { server, url } = await mockServer({ events, maxRange: 300 });
  try {
    const logs = await scanLogs(url, 0, 1000, { chunk: 250, minWindow: 10 });
    assert.equal(logs.length, 5);
  } finally { server.close(); }
});

test("when even the smallest window is refused, discovery fails loudly instead of returning a short list", async () => {
  const { server, url } = await mockServer({ events, maxRange: 0 });
  try {
    await assert.rejects(discover({ polygon: url }, { minWindow: 10, tries: 1 }), /eth_getLogs failed/);
  } finally { server.close(); }
});

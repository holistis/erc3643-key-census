// verify-agents asks each token contract isAgent(address). Tested against a local mock node, no internet needed.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyAgents } from "../check.mjs";

const w32 = (hex) => hex.padStart(64, "0");
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

async function withNode(isAgentNo, fn) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const q = JSON.parse(body);
      let result = null;
      if (q.method === "eth_call") {
        const calls = parseCalls(q.params[0].data);
        result = encodeResults(calls.map((c) => ({ ok: true, data: "0x" + w32(isAgentNo.has("0x" + c.data.slice(-40)) ? "0" : "1") })));
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: q.id, result }));
    });
  });
  await new Promise((ok) => server.listen(0, ok));
  const dir = mkdtempSync(join(tmpdir(), "census-verify-agents-"));
  mkdirSync(join(dir, "data"));
  writeFileSync(join(dir, "data/agents.json"), JSON.stringify([
    { net: "polygon", token: a(0x1000), active: true, owner_type: "account_direct", agents: [{ address: a(1), type: "account_direct", controller: a(1), detail: null }, { address: a(2), type: "account_direct", controller: a(2), detail: null }], level: 0 },
    { net: "polygon", token: a(0x1001), active: true, owner_type: "account_direct", agents: [{ address: a(3), type: "account_direct", controller: a(3), detail: null }], level: 0 },
  ]));
  try {
    return await fn({ rpcUrls: { polygon: "http://127.0.0.1:" + server.address().port }, dataDir: dir, log: () => {} });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("verify-agents is green when every listed agent answers yes", async () => {
  assert.equal(await withNode(new Set(), (o) => verifyAgents(10, true, o)), true);
});
test("verify-agents is red in strict mode when one listed agent answers no", async () => {
  assert.equal(await withNode(new Set([a(2)]), (o) => verifyAgents(10, true, o)), false);
});
test("verify-agents is red in the default mode when more than 5 percent answer no", async () => {
  assert.equal(await withNode(new Set([a(2)]), (o) => verifyAgents(10, false, o)), false, "1 of 3 is more than 5 percent");
});

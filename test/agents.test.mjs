import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ADDED_TOPIC, REMOVED_TOPIC, reduceAgentLogs, summarizeAgents, headlineAgents, agentText, rowLevel } from "../lib/agents.mjs";
import { tokenLevel } from "../lib/levels.mjs";
import { runAgents } from "../agents.mjs";

const a = (n) => "0x" + n.toString(16).padStart(40, "0");
const tok = a(0x1000);
const pad = (addr) => "0x" + "0".repeat(24) + addr.slice(2);
const log = (kind, agent, block, idx, token = tok) => ({ address: token, topics: [kind === "add" ? ADDED_TOPIC : REMOVED_TOPIC, pad(agent)], blockNumber: "0x" + block.toString(16), logIndex: "0x" + idx.toString(16) });

test("topic0 values are the keccak-256 of the T-REX event signatures", () => {
  // computed independently with a small keccak implementation; kept here as literals
  assert.equal(ADDED_TOPIC, "0xf68e73cec97f2d70aa641fb26e87a4383686e2efacb648f2165aeb02ac562ec5");
  assert.equal(REMOVED_TOPIC, "0xed9c8ad8d5a0a66898ea49d2956929c93ae2e8bd50281b2ed897c5d1a6737e0b");
});

test("reduceAgentLogs replays add and remove in block and log order, whatever order they arrive in", () => {
  const logs = [log("remove", a(1), 10, 0), log("add", a(1), 5, 0), log("add", a(2), 6, 3), log("add", a(3), 6, 1)];
  const r = reduceAgentLogs(logs, new Set([tok]));
  assert.deepEqual(r.agents.get(tok), [a(2), a(3)]);
  assert.deepEqual(r.counts, { added: 3, removed: 1, duplicate_adds: 0, unmatched_removes: 0 });
});

test("reduceAgentLogs: a removal before the first add of the same agent is unmatched, the later add stays", () => {
  const r = reduceAgentLogs([log("remove", a(1), 4, 0), log("add", a(1), 5, 0)], new Set([tok]));
  assert.deepEqual(r.agents.get(tok), [a(1)]);
  assert.equal(r.counts.unmatched_removes, 1);
});

test("reduceAgentLogs counts a repeated add and ignores other tokens and malformed logs", () => {
  const other = a(0x2000);
  const logs = [log("add", a(1), 1, 0), log("add", a(1), 2, 0), log("add", a(9), 3, 0, other), { address: tok, topics: [ADDED_TOPIC], blockNumber: "0x1", logIndex: "0x0" }];
  const r = reduceAgentLogs(logs, new Set([tok]));
  assert.deepEqual(r.agents.get(tok), [a(1)]);
  assert.equal(r.counts.duplicate_adds, 1);
  assert.equal(r.agents.has(other), false);
  assert.equal(r.counts.added, 2);
});

test("the number of agents follows from the event counts (the identity check.mjs relies on)", () => {
  const logs = [log("add", a(1), 1, 0), log("add", a(1), 2, 0), log("remove", a(5), 3, 0), log("add", a(2), 4, 0), log("remove", a(2), 5, 0), log("add", a(3), 6, 0)];
  const { agents, counts } = reduceAgentLogs(logs, new Set([tok]));
  const total = [...agents.values()].reduce((n, l) => n + l.length, 0);
  assert.equal(total, counts.added - counts.duplicate_adds - (counts.removed - counts.unmatched_removes));
});

test("tokenLevel: the weakest role holder decides", () => {
  assert.equal(tokenLevel("safe_multisig", ["safe_multisig"]), 1);
  assert.equal(tokenLevel("safe_multisig", []), 1);
  assert.equal(tokenLevel("safe_multisig", ["safe_multisig", "account_direct"]), 0);
  assert.equal(tokenLevel("account_direct", ["safe_multisig"]), 0);
  assert.equal(tokenLevel("safe_threshold_1", []), 0);
  assert.equal(tokenLevel("account_via_contract", []), 0);
  assert.equal(tokenLevel("safe_multisig", ["other_contract"]), null);
  assert.equal(tokenLevel("renounced", ["safe_multisig"]), 1);
  assert.equal(tokenLevel("safe_multisig", ["renounced", "safe_multisig"]), 1, "an agent at the zero or dead address cannot act");
  assert.equal(tokenLevel("self_owned", ["safe_multisig"]), 1);
  assert.equal(tokenLevel("self_owned", []), null);
  assert.equal(tokenLevel("safe_multisig", ["renounced", "account_direct"]), 0);
  assert.equal(tokenLevel("renounced", []), null);
  assert.equal(tokenLevel("timelock", ["safe_multisig"]), null);
  assert.equal(tokenLevel("other_contract", ["account_direct"]), 0);
});

const row = (owner_type, agents, active = true) => ({ net: "polygon", token: a(Math.random() * 1e9 | 0), active, owner_type, agents: agents.map((t, i) => ({ address: a(100 + i), type: t, controller: a(100 + i), detail: null })), level: null });

test("summarizeAgents counts levels, single-key agents and held-down owners", () => {
  const rows = [row("safe_multisig", ["account_direct"]), row("safe_multisig", ["safe_multisig"]), row("account_direct", []), row("other_contract", ["other_contract"], false), row("account_direct", ["account_via_contract", "safe_threshold_1"])];
  rows.forEach((r) => (r.level = rowLevel(r)));
  const s = summarizeAgents(rows);
  assert.equal(s.tokens, 5);
  assert.equal(s.with_agents, 4);
  assert.deepEqual(s.level_all, { level0: 3, level1: 1, not_classified: 1 });
  assert.equal(s.owner_multisig_held_down, 1);
  assert.equal(s.single_key_agent_all, 2);
  assert.equal(s.single_key_agent_direct_all, 2);
  assert.equal(s.active, 4);
  assert.deepEqual(s.agent_count, { 0: 1, 1: 3, 2: 1, 3: 0, "4_or_more": 0 });
  const h = headlineAgents(s);
  assert.equal(h.level0_pct_all, 60);
  assert.match(agentText(s, { to_block: { polygon: 1, ethereum: 2 } }), /Polygon block 1 and Ethereum block 2/);
});

test("summarizeAgents on an empty list does not divide by zero", () => {
  const s = summarizeAgents([]);
  assert.equal(headlineAgents(s).level0_pct_all, 0);
});

test("runAgents end to end against a local mock node (all agents are plain accounts)", async () => {
  const added = [log("add", a(7), 3, 0), log("add", a(8), 4, 0), log("add", a(9), 5, 0), log("remove", a(8), 6, 0)];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const one = (q) => {
        if (q.method === "eth_blockNumber") return "0x64";
        if (q.method === "eth_getCode") return "0x";
        if (q.method === "eth_getLogs") return added.filter((l) => l.topics[0] === q.params[0].topics[0]);
        return null;
      };
      const j = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(Array.isArray(j) ? j.map((q) => ({ jsonrpc: "2.0", id: q.id, result: one(q) })) : { jsonrpc: "2.0", id: j.id, result: one(j) }));
    });
  });
  await new Promise((ok) => server.listen(0, ok));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const owners = [
      { net: "polygon", token: tok, active: true, type: "account_direct" },
      { net: "polygon", token: a(0x1001), active: false, type: "safe_multisig" },
    ];
    const { rows, measured } = await runAgents(owners, { logUrls: { polygon: url }, rpcUrls: { polygon: url } });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].agents.map((x) => [x.address, x.type]), [[a(7), "account_direct"], [a(9), "account_direct"]]);
    assert.equal(rows[0].level, 0);
    assert.equal(rows[1].agents.length, 0);
    assert.equal(rows[1].level, 1);
    assert.deepEqual(measured.events, { added: 3, removed: 1, duplicate_adds: 0, unmatched_removes: 0 });
    assert.equal(measured.to_block.polygon, 100);
  } finally {
    server.close();
  }
});

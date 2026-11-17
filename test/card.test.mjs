// card.mjs prints one token from the census, and refuses to print when the data does not recount.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { typeText, findCards } from "../lib/card.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAFE_TOKEN = "0x07cef9011cc524b5d3800490d60bbe5e592ee0fa"; // polygon, owner and its one agent are Safes that need 2 of 3
const run = (args, root = ROOT) => spawnSync(process.execPath, [join(ROOT, "card.mjs"), ...args, "--root", root], { encoding: "utf8" });

function copyOfData() {
  const dir = mkdtempSync(join(tmpdir(), "card-"));
  for (const p of ["data", "assets", "history", "README.md"]) cpSync(join(ROOT, p), join(dir, p), { recursive: true });
  return dir;
}

test("a known token prints owner, agent, level and the caveat", () => {
  const r = run([SAFE_TOKEN]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /a Safe that needs 2 of 3 signatures/);
  assert.match(r.stdout, /Level 1: every role holder is a Safe/);
  assert.match(r.stdout, /structure, not safety/);
  assert.match(r.stdout, /Recount of the data before this card: GREEN \(3427 tokens/);
  assert.match(r.stdout, /Cite as: holistis \(github\.com\/holistis\)/);
});

test("the address may be written in capitals", () => {
  const r = run(["0x" + SAFE_TOKEN.slice(2).toUpperCase()]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(SAFE_TOKEN));
});

test("--json prints the two rows and the blocks", () => {
  const r = run([SAFE_TOKEN, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const [c] = JSON.parse(r.stdout);
  assert.equal(c.token.token, SAFE_TOKEN);
  assert.equal(c.agents.agents.length, 1);
  assert.equal(c.agents.level, 1);
  assert.ok(Number.isInteger(c.measured.owner_block) && Number.isInteger(c.measured.agent_events_to_block));
});

test("an address that is not in the census exits 1 and says what the census lists", () => {
  const r = run(["0x0000000000000000000000000000000000000001"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not in the census/);
  assert.equal(r.stdout, "");
});

test("the right address on the wrong network is not found", () => {
  assert.equal(run([SAFE_TOKEN, "--net", "ethereum"]).status, 1);
  assert.equal(run([SAFE_TOKEN, "--net", "polygon"]).status, 0);
});

test("bad input exits 2 and prints no card", () => {
  for (const bad of [[], ["0x123"], ["not-an-address"], ["0xZZ" + "0".repeat(38)], [SAFE_TOKEN, "--net", "solana"]]) {
    const r = run(bad);
    assert.equal(r.status, 2, JSON.stringify(bad));
    assert.equal(r.stdout, "");
  }
});

test("control group: an untouched copy of the data still prints a card", () => {
  const dir = copyOfData();
  try {
    assert.equal(run([SAFE_TOKEN], dir).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("planted errors: when the data does not recount, no card is printed", () => {
  const plants = {
    "a changed value in tokens.json": (d) => { const p = join(d, "data/tokens.json"); const t = readFileSync(p, "utf8"); assert.ok(t.includes('"active": true')); writeFileSync(p, t.replace('"active": true', '"active": false')); },
    "one agent dropped from agents.json": (d) => { const p = join(d, "data/agents.json"); const rows = JSON.parse(readFileSync(p, "utf8")); const i = rows.findIndex((r) => r.agents.length > 1); rows[i].agents.pop(); writeFileSync(p, JSON.stringify(rows, null, 1) + "\n"); },
    "agents.json emptied": (d) => writeFileSync(join(d, "data/agents.json"), "[]\n"),
    "agents.json missing": (d) => rmSync(join(d, "data/agents.json")),
    "tokens.json truncated": (d) => { const p = join(d, "data/tokens.json"); writeFileSync(p, readFileSync(p, "utf8").slice(0, 5000)); },
  };
  for (const [name, plant] of Object.entries(plants)) {
    const dir = copyOfData();
    try {
      plant(dir);
      const r = run([SAFE_TOKEN], dir);
      assert.equal(r.status, 3, name + ": " + r.stderr.slice(0, 200));
      assert.equal(r.stdout, "", name);
      assert.match(r.stderr, /does not recount/, name);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("typeText names the threshold of a Safe and every type has words", () => {
  assert.equal(typeText("safe_multisig", { threshold: 3, n: 5 }), "a Safe that needs 3 of 5 signatures");
  assert.equal(typeText("safe_threshold_1", { threshold: 1, n: 2 }), "a Safe that needs 1 of 2 signatures");
  assert.equal(typeText("account_direct", null), "one account address");
  const tokens = JSON.parse(readFileSync(join(ROOT, "data/tokens.json"), "utf8"));
  for (const t of new Set(tokens.map((x) => x.type))) assert.notEqual(typeText(t, { threshold: 1, n: 1 }), t, "no plain words for " + t);
});

test("findCards returns every network that has the address and tolerates a missing agent row", () => {
  const tokens = [{ net: "polygon", token: "0xaa" }, { net: "ethereum", token: "0xaa" }];
  assert.equal(findCards(tokens, [], "0xAA").length, 2);
  assert.equal(findCards(tokens, [], "0xaa", "ethereum").length, 1);
  assert.equal(findCards(tokens, [], "0xaa")[0].agents, null);
});

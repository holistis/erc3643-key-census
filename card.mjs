#!/usr/bin/env node
// Shows who holds the owner role and the agent roles of one token from the census, in words. Read-only, no network.
// Usage: node card.mjs <0xTokenAddress> [--net polygon|ethereum] [--json] [--root <folder>]
// The data is recounted first (the same recount as `node check.mjs`). If it does not recount, no card is printed.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkAll } from "./lib/validate.mjs";
import { ADDRESS, findCards, cardText } from "./lib/card.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const root = resolve(value("--root") ?? dirname(fileURLToPath(import.meta.url)));
const net = value("--net");
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--net", "--root"].includes(args[i - 1])));
const address = positional[0];

if (!address || !ADDRESS.test(address) || (net !== null && !["polygon", "ethereum"].includes(net))) {
  console.error("Usage: node card.mjs <0xTokenAddress (40 hex digits)> [--net polygon|ethereum] [--json] [--root <folder>]");
  process.exit(2);
}

const result = checkAll(root);
if (!result.ok) {
  console.error("The data in this folder does not recount, so no card is printed:");
  for (const e of result.errors.slice(0, 5)) console.error("  " + e);
  process.exit(3);
}

const read = (p) => JSON.parse(readFileSync(root + "/" + p, "utf8"));
const tokens = read("data/tokens.json");
const agents = read("data/agents.json");
const summary = read("data/summary.json");
const agentSummary = read("data/agents-summary.json");
const cards = findCards(tokens, agents, address, net);
if (!cards.length) {
  console.error("That address is not in the census. The census lists the issuances announced by the standard TREXSuiteDeployed factory event on Polygon and Ethereum, nothing else.");
  process.exit(1);
}

const recount = { rows: result.info.rows, hash: result.info.hash };
const meta = (c) => ({ ownerBlock: summary.measured?.block_end?.[c.token.net], agentBlock: agentSummary.measured?.to_block?.[c.token.net], recount });
if (flag("--json")) {
  console.log(JSON.stringify(cards.map((c) => ({ ...c, measured: { owner_block: meta(c).ownerBlock, agent_events_to_block: meta(c).agentBlock }, recount })), null, 1));
} else {
  console.log(cards.map((c) => cardText(c, meta(c))).join("\n\n"));
}

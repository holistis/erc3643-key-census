// Test the tester: break one check at a time in a copy of the repo and require that the selftest turns red.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const AG = "lib/validate-agents.mjs";
const breaks = [
  ["fingerprint check", "if (!m || m[1] !== hash) errors.push(", "if (false) errors.push("],
  ["summary comparison", "if (!same(fresh, summary.summary)) errors.push(", "if (false) errors.push("],
  ["README numbers comparison", "if (published && !same(", "if (false && !same("],
  ["README sentences comparison", "else if (sentences[1].trim() !== readableText(fresh, summary.measured)) errors.push(", "else if (false) errors.push("],
  ["discovery comparison", "if (d.unique_tokens !== mine.length) errors.push(", "if (false) errors.push("],
  ["self_owned consistency", "if (!(r.owner === r.token && r.chain.length === 0 && r.controller === null)) errors.push(", "if (false) errors.push("],
  ["cycle consistency", "if (!(r.controller === null && r.chain.length >= 1 && r.chain[0] === r.owner)) errors.push(", "if (false) errors.push("],
  ["csv comparison", 'else if (csvFile !== csvText(rows)) errors.push(', "else if (false) errors.push("],
  ["history: tokens may not fall", "if (rows[i].tokens < rows[i - 1].tokens) errors.push(", "if (false) errors.push(", "lib/history.mjs"],
  ["history: dates must move forward", "if (rows[i].date <= rows[i - 1].date) errors.push(", "if (false) errors.push(", "lib/history.mjs"],
  ["history: latest.json count equals the last series row", "if (rows.length && rows[rows.length - 1].tokens !== latest.length) errors.push(", "if (false) errors.push(", "lib/history.mjs"],
  ["history: latest.json addresses", "if (!r || !NETS.has(r.net) || !ADDR.test(String(r.token))) { errors.push(", "if (false) { errors.push(", "lib/history.mjs"],
  ["chart comparison", 'else if (chart !== chartSvg(fresh)) errors.push(', "else if (false) errors.push("],
  ["address format check", "if (!ADDR_LOWER.test(String(r.token))) errors.push(", "if (false) errors.push("],
  ["duplicate check", "if (seen.has(k)) errors.push(", "if (false) errors.push("],
  ["type check", "if (!TYPES.includes(r.type)) {", "if (false) {"],
  ["network check", "if (!NETS.has(r.net)) errors.push(", "if (false) errors.push("],
  ["active flag check", "if (r.active !== isActive(r)) errors.push(", "if (false) errors.push("],
  ["account_direct consistency", "errors.push(`${p}: account_direct but chain and owner disagree`)", "void 0"],
  // agent data: every check below needs a planted error that no other check can see (see agentMutations in check.mjs)
  ["agent summary comparison", "if (!same(fresh, summary.summary)) errors.push(", "if (false) errors.push(", AG],
  ["agent event count identity", "|| counted !== expected) errors.push(", "|| false) errors.push(", AG],
  ["agent level check", "if (r.level !== rowLevel(r)) errors.push(", "if (false) errors.push(", AG],
  ["agent owner_type mirror", "if (r.owner_type !== o.type) errors.push(", "if (false) errors.push(", AG],
  ["agent active mirror", "if (r.active !== o.active) errors.push(", "if (false) errors.push(", AG],
  ["agents row missing for a token", "for (const k of owner.keys()) if (!mine.has(k)) errors.push(", "for (const k of owner.keys()) if (false) errors.push(", AG],
  ["agents row not in tokens.json", "for (const k of mine.keys()) if (!owner.has(k)) errors.push(", "for (const k of mine.keys()) if (false) errors.push(", AG],
  ["agent duplicate token row", "if (seen.has(key(r))) errors.push(", "if (false) errors.push(", AG],
  ["agent address format", "if (!a || !ADDR_LOWER.test(String(a.address))) {", "if (false) {", AG],
  ["agent listed twice", "if (addrs.has(a.address)) errors.push(", "if (false) errors.push(", AG],
  ["agent type check", "if (!AGENT_TYPES.includes(a.type)) {", "if (false) {", AG],
  ["account_direct agent consistency", "if (c !== a.address) errors.push(", "if (false) errors.push(", AG],
  ["account_via_contract agent consistency", "if (!(ADDR_LOWER.test(String(c)) && c !== a.address)) errors.push(", "if (false) errors.push(", AG],
  ["agent fingerprint in SHA256SUMS", "if (!fm || fm[1] !== hash) errors.push(", "if (false) errors.push(", AG],
  ["agent fingerprint in the README", 'if (!readme.includes("`" + hash + "`")) errors.push(', "if (false) errors.push(", AG],
  ["agent README numbers comparison", "if (published && !same(published, headlineAgents(fresh))) errors.push(", "if (false) errors.push(", AG],
  ["agent README sentences comparison", "else if (sentences[1].trim() !== agentText(fresh, summary.measured)) errors.push(", "else if (false) errors.push(", AG],
  // The empty list is guarded twice on purpose (validateRows and checkAll), so disabling one guard
  // must NOT turn the selftest red; that case is covered by the "emptied" mutation in check.mjs.
];

for (const [name, from, to, file = "lib/validate.mjs"] of breaks) {
  test(`selftest turns red when the ${name} is disabled`, () => {
    const dir = mkdtempSync(join(tmpdir(), "census-meta-"));
    try {
      for (const f of ["lib", "data", "assets", "history", "check.mjs", "census.mjs", "discover.mjs", "history.mjs", "README.md", "package.json"]) cpSync(join(ROOT, f), join(dir, f), { recursive: true });
      const p = join(dir, file);
      const src = readFileSync(p, "utf8");
      assert.ok(src.includes(from), "the patch target was not found, so this test would prove nothing: " + from);
      writeFileSync(p, src.replace(from, to));
      const r = spawnSync(process.execPath, ["check.mjs", "--selftest"], { cwd: dir, encoding: "utf8" });
      assert.notEqual(r.status, 0, `the selftest stayed green with the ${name} disabled, so it does not test that check`);
      assert.match(r.stdout, /NOT CAUGHT/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

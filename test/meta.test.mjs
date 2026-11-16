// Test the tester: break one check at a time in a copy of the repo and require that the selftest turns red.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const breaks = [
  ["fingerprint check", "if (!m || m[1] !== hash) errors.push(", "if (false) errors.push("],
  ["summary comparison", "if (!same(fresh, summary.summary)) errors.push(", "if (false) errors.push("],
  ["README numbers comparison", "if (published && !same(", "if (false && !same("],
  ["README sentences comparison", "else if (sentences[1].trim() !== readableText(fresh, summary.measured)) errors.push(", "else if (false) errors.push("],
  ["discovery comparison", "if (d.unique_tokens !== mine.length) errors.push(", "if (false) errors.push("],
  ["self_owned consistency", "if (!(r.owner === r.token && r.chain.length === 0 && r.controller === null)) errors.push(", "if (false) errors.push("],
  ["cycle consistency", "if (!(r.controller === null && r.chain.length >= 1 && r.chain[0] === r.owner)) errors.push(", "if (false) errors.push("],
  ["csv comparison", 'else if (csvFile !== csvText(rows)) errors.push(', "else if (false) errors.push("],
  ["chart comparison", 'else if (chart !== chartSvg(fresh)) errors.push(', "else if (false) errors.push("],
  ["address format check", "if (!ADDR_LOWER.test(String(r.token))) errors.push(", "if (false) errors.push("],
  ["duplicate check", "if (seen.has(k)) errors.push(", "if (false) errors.push("],
  ["type check", "if (!TYPES.includes(r.type)) {", "if (false) {"],
  ["network check", "if (!NETS.has(r.net)) errors.push(", "if (false) errors.push("],
  ["active flag check", "if (r.active !== isActive(r)) errors.push(", "if (false) errors.push("],
  ["account_direct consistency", "errors.push(`${p}: account_direct but chain and owner disagree`)", "void 0"],
  // The empty list is guarded twice on purpose (validateRows and checkAll), so disabling one guard
  // must NOT turn the selftest red; that case is covered by the "emptied" mutation in check.mjs.
];

for (const [name, from, to] of breaks) {
  test(`selftest turns red when the ${name} is disabled`, () => {
    const dir = mkdtempSync(join(tmpdir(), "census-meta-"));
    try {
      for (const f of ["lib", "data", "assets", "check.mjs", "census.mjs", "discover.mjs", "README.md", "package.json"]) cpSync(join(ROOT, f), join(dir, f), { recursive: true });
      const p = join(dir, "lib/validate.mjs");
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

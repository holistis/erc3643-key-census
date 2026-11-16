// Compare two lists of rows by token: same type and controller, different, or only in one of them.
export function compareRows(a, b) {
  const key = (r) => r.net + ":" + r.token;
  const rest = new Map(b.map((r) => [key(r), r]));
  const differs = [];
  const onlyA = [];
  let same = 0;
  for (const r of a) {
    const o = rest.get(key(r));
    if (!o) { onlyA.push(key(r)); continue; }
    rest.delete(key(r));
    if (o.type === r.type && (o.controller ?? null) === (r.controller ?? null)) same++;
    else differs.push({ key: key(r), was: `${r.type}:${r.controller ?? "-"}`, now: `${o.type}:${o.controller ?? "-"}` });
  }
  return { same, differs, onlyA, onlyB: [...rest.keys()] };
}

/** Verdict of a sample re-measurement. strict: any difference or unreadable token is red. Otherwise up to 5 percent is tolerated. */
export function verifyVerdict({ n, differs, unreadable }, strict = false) {
  if (!n) return false;
  if (strict) return differs === 0 && unreadable === 0;
  return differs / n <= 0.05 && unreadable / n <= 0.05;
}

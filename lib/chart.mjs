// The one picture. Generated from the summary, and recounted by check.mjs, so the picture cannot drift from the data.
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function chartSvg(s) {
  const rows = [
    ["All issuances", s.tokens, s.all.single_key_pct, s.all.multi_party_pct],
    ["Active issuances", s.active, s.active_share.single_key_pct, s.active_share.multi_party_pct],
  ];
  const x0 = 190, bw = 560;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 330" width="800" height="330" role="img" aria-labelledby="t d">`);
  out.push(`<title id="t">Who holds the keys of ERC-3643 token issuances</title>`);
  out.push(`<desc id="d">${esc(`Of ${s.tokens} issuances, ${s.all.single_key_pct}% have a single key as owner and ${s.all.multi_party_pct}% need more than one party. Of ${s.active} active issuances, ${s.active_share.single_key_pct}% and ${s.active_share.multi_party_pct}%.`)}</desc>`);
  out.push(`<rect width="800" height="330" fill="#ffffff"/>`);
  out.push(`<text x="30" y="46" font-family="system-ui, sans-serif" font-size="22" font-weight="700" fill="#111827">Who holds the keys of ERC-3643 token issuances?</text>`);
  out.push(`<text x="30" y="72" font-family="system-ui, sans-serif" font-size="14" fill="#374151">Polygon and Ethereum, read-only count, 16 November 2026</text>`);
  rows.forEach(([label, n, single, multi], i) => {
    const y = 105 + i * 80;
    const other = Math.max(0, Math.round((100 - single - multi) * 10) / 10);
    const w = [single, multi, other].map((p) => (bw * p) / 100);
    out.push(`<text x="30" y="${y + 24}" font-family="system-ui, sans-serif" font-size="15" fill="#111827">${esc(label)} (${n})</text>`);
    out.push(`<rect x="${x0}" y="${y}" width="${w[0].toFixed(1)}" height="34" fill="#1f2937"/>`);
    out.push(`<rect x="${(x0 + w[0]).toFixed(1)}" y="${y}" width="${w[1].toFixed(1)}" height="34" fill="#16a34a"/>`);
    out.push(`<rect x="${(x0 + w[0] + w[1]).toFixed(1)}" y="${y}" width="${w[2].toFixed(1)}" height="34" fill="#d1d5db"/>`);
    out.push(`<text x="${x0 + 12}" y="${y + 23}" font-family="system-ui, sans-serif" font-size="15" font-weight="700" fill="#ffffff">${single}% single key</text>`);
    out.push(`<text x="${x0}" y="${y + 54}" font-family="system-ui, sans-serif" font-size="13" fill="#111827">${multi}% need more than one party, ${other}% other</text>`);
  });
  out.push(`<rect x="30" y="268" width="14" height="14" fill="#1f2937"/><text x="52" y="280" font-family="system-ui, sans-serif" font-size="13" fill="#111827">single key: one account, or a Safe that needs one signature</text>`);
  out.push(`<rect x="30" y="290" width="14" height="14" fill="#16a34a"/><text x="52" y="302" font-family="system-ui, sans-serif" font-size="13" fill="#111827">more than one party: Safe with 2+ signatures, or a timelock</text>`);
  out.push(`<text x="520" y="318" font-family="system-ui, sans-serif" font-size="12" fill="#4b5563">github.com/holistis/erc3643-key-census</text>`);
  out.push(`</svg>`);
  return out.join("\n") + "\n";
}

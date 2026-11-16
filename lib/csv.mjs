// The csv is derived from tokens.json. One function builds it, so the recount can compare it exactly.
export function csvText(rows) {
  const head = "net,token,factory,supply,paused,type,controller,e7702,active";
  const lines = rows.map((r) => [r.net, r.token, r.factory, r.supply ?? "", r.paused ?? "", r.type, r.controller ?? "", r.e7702, r.active].join(","));
  return [head, ...lines].join("\n") + "\n";
}

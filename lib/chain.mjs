// Read-only: eth_call through Multicall3, eth_getCode (batch), eth_blockNumber. No write methods exist in this file.
import { encodeAggregate3, decodeAggregate3, MULTICALL3 } from "./abi.mjs";
import { isDelegatedAccount } from "./classify.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeChain(url, { tries = 3, timeoutMs = 30000, backoffMs = 400 } = {}) {
  const stats = { transportFailures: 0 };

  async function rpc(method, params, t = tries) {
    let laatste;
    for (let i = 0; i < t; i++) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const j = await r.json();
        if (j.error) throw new Error(j.error.message || "rpc-fout");
        return j.result;
      } catch (e) {
        laatste = e;
        await sleep(backoffMs * 2 ** i);
      }
    }
    throw laatste;
  }

  /** calls: [{target, data}] -> [{ok, data}]. Splits on an error; only real transport failures are counted. */
  async function multicall(calls) {
    if (!calls.length) return [];
    try {
      const ret = await rpc("eth_call", [{ to: MULTICALL3, data: encodeAggregate3(calls) }, "latest"], 2);
      const dec = decodeAggregate3(ret);
      if (dec.length !== calls.length) throw new Error("number of answers does not match");
      return dec.map((r) => ({ ok: r.success && r.data.length > 2, data: r.data }));
    } catch {
      if (calls.length === 1) {
        stats.transportFailures++;
        return [{ ok: false, data: "0x", transport: true }];
      }
      const m = Math.floor(calls.length / 2);
      return [...(await multicall(calls.slice(0, m))), ...(await multicall(calls.slice(m)))];
    }
  }

  /** addresses -> Map(address -> {size, delegated}); size is 0 for an account, also with EIP-7702 delegation. */
  async function codes(adressen) {
    const res = new Map();
    const zet = (a, hex) => {
      const l = a.toLowerCase();
      const delegated = isDelegatedAccount(hex);
      res.set(l, { size: delegated ? 0 : (hex.length - 2) / 2, delegated });
    };
    for (let i = 0; i < adressen.length; i += 40) {
      const st = adressen.slice(i, i + 40);
      try {
        const body = st.map((a, k) => ({ jsonrpc: "2.0", id: k, method: "eth_getCode", params: [a, "latest"] }));
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
        const j = await r.json();
        if (!Array.isArray(j)) throw new Error("not a batch answer");
        for (const x of j) if (typeof x.result === "string" && st[x.id] !== undefined) zet(st[x.id], x.result);
      } catch {
        /* fall back to single calls */
      }
      for (const a of st) {
        if (res.has(a.toLowerCase())) continue;
        try {
          zet(a, await rpc("eth_getCode", [a, "latest"], 2));
        } catch {
          stats.transportFailures++;
        }
      }
    }
    return res;
  }

  const blockNumber = async () => parseInt(await rpc("eth_blockNumber", []), 16);
  return { rpc, multicall, codes, blockNumber, stats };
}

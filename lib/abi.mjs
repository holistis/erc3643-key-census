// Minimal ABI encoding for Multicall3.aggregate3 and the few answers we read. No dependencies.
// test/abi.test.mjs compares the output byte for byte with vectors made with ethers.

export const SEL = {
  aggregate3: "0x82ad56cb",
  symbol: "0x95d89b41",
  totalSupply: "0x18160ddd",
  paused: "0x5c975abb",
  owner: "0x8da5cb5b",
  getThreshold: "0xe75235b8",
  getOwners: "0xa0e67e2b",
  getMinDelay: "0xf27a0c92",
};
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

const strip = (h) => (h.startsWith("0x") || h.startsWith("0X") ? h.slice(2) : h);
const pad32 = (hex) => hex.padStart(64, "0");
const MAX_CALLS = 100000;

export function encodeAggregate3(calls) {
  if (!Array.isArray(calls) || calls.length === 0 || calls.length > MAX_CALLS) throw new Error("aggregate3: invalid number of calls");
  const tuples = calls.map((c) => {
    const target = strip(c.target).toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(target)) throw new Error("aggregate3: invalid address " + c.target);
    const d = strip(c.data).toLowerCase();
    if (d.length % 2 !== 0 || !/^[0-9a-f]*$/.test(d)) throw new Error("aggregate3: invalid data");
    const len = d.length / 2;
    const padded = d.padEnd(Math.ceil(len / 32) * 64, "0");
    return pad32(target) + pad32("1") + pad32((0x60).toString(16)) + pad32(len.toString(16)) + padded;
  });
  let off = calls.length * 32;
  const offsets = [];
  for (const t of tuples) {
    offsets.push(pad32(off.toString(16)));
    off += t.length / 2;
  }
  return SEL.aggregate3 + pad32("20") + pad32(calls.length.toString(16)) + offsets.join("") + tuples.join("");
}

export function decodeAggregate3(ret) {
  const h = strip(String(ret)).toLowerCase();
  if (!/^[0-9a-f]*$/.test(h) || h.length % 2 !== 0) throw new Error("aggregate3: response is not hex");
  const bytes = h.length / 2;
  const word = (at) => {
    if (at < 0 || at + 32 > bytes) throw new Error("aggregate3: response truncated");
    return BigInt("0x" + h.slice(at * 2, at * 2 + 64));
  };
  const arr = Number(word(0));
  const n = Number(word(arr));
  if (n > MAX_CALLS) throw new Error("aggregate3: too many results");
  const base = arr + 32;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = base + Number(word(base + i * 32));
    const success = word(t) !== 0n;
    const b = t + Number(word(t + 32));
    const len = Number(word(b));
    if (b + 32 + len > bytes) throw new Error("aggregate3: response truncated");
    out.push({ success, data: "0x" + h.slice((b + 32) * 2, (b + 32 + len) * 2) });
  }
  return out;
}

const okWord = (d) => typeof d === "string" && /^0x[0-9a-fA-F]*$/.test(d) && d.length >= 66;
export function decUint(d) {
  return okWord(d) ? BigInt("0x" + d.slice(2, 66)) : undefined;
}
export function decBool(d) {
  const v = decUint(d);
  return v === undefined ? undefined : v !== 0n;
}
export function decAddress(d) {
  if (!okWord(d)) return undefined;
  if (!/^0{24}$/.test(d.slice(2, 26))) return undefined; // the upper 12 bytes must be zero
  return "0x" + d.slice(26, 66).toLowerCase();
}
export function decString(d, max = 64) {
  if (!okWord(d) || d.length < 130) return undefined;
  const off = Number(BigInt("0x" + d.slice(2, 66)));
  const bytes = (d.length - 2) / 2;
  if (off + 32 > bytes) return undefined;
  const len = Number(BigInt("0x" + d.slice(2 + off * 2, 2 + (off + 32) * 2)));
  if (off + 32 + len > bytes || len > 4096) return undefined;
  const raw = Buffer.from(d.slice(2 + (off + 32) * 2, 2 + (off + 32 + len) * 2), "hex").toString("utf8");
  // token metadata is hostile input: control characters removed, length bounded
  return raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "").slice(0, max);
}
export function decArrayLength(d) {
  if (!okWord(d) || d.length < 130) return undefined;
  const off = Number(BigInt("0x" + d.slice(2, 66)));
  const bytes = (d.length - 2) / 2;
  if (off + 32 > bytes) return undefined;
  const n = Number(BigInt("0x" + d.slice(2 + off * 2, 2 + (off + 32) * 2)));
  if (off + 32 + n * 32 > bytes || n > 10000) return undefined;
  return n;
}

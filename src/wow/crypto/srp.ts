import { createHash, randomBytes } from "node:crypto";

export type SRPResult = {
  A: Uint8Array;
  K: Uint8Array;
  M1: Uint8Array;
  M2: bigint;
};

export function sha1(...buffers: Uint8Array[]): Uint8Array {
  const hash = createHash("sha1");
  for (const buf of buffers) hash.update(buf);
  return new Uint8Array(hash.digest());
}

export function leBytesToBigInt(bytes: Uint8Array): bigint {
  const hex: string[] = [];
  for (const byte of Uint8Array.from(bytes).reverse()) {
    hex.push(byte.toString(16).padStart(2, "0"));
  }
  if (hex.length === 0) return 0n;
  return BigInt(`0x${hex.join("")}`);
}

export function bigIntToLeBytes(n: bigint, size: number): Uint8Array {
  const result = new Uint8Array(size);
  let remaining = n;
  for (let i = 0; i < size; i++) {
    result[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

export function beBytesToBigInt(bytes: Uint8Array): bigint {
  const hex: string[] = [];
  for (const byte of bytes) {
    hex.push(byte.toString(16).padStart(2, "0"));
  }
  if (hex.length === 0) return 0n;
  return BigInt(`0x${hex.join("")}`);
}

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e % 2n === 1n) {
      result = (result * b) % mod;
      e -= 1n;
    } else {
      b = (b * b) % mod;
      e /= 2n;
    }
  }
  return result;
}

function deriveSessionKey(sBytes: Uint8Array, padLen: number): Uint8Array {
  const S1 = new Uint8Array(16);
  const S2 = new Uint8Array(16);
  for (const [i, byte] of sBytes.subarray(0, 32).entries()) {
    if (i % 2 === 0) {
      S1[i >> 1] = byte;
    } else {
      S2[i >> 1] = byte;
    }
  }

  let p = 0;
  while (p < padLen && sBytes[p] === 0) p++;
  if (p & 1) p++;
  p = Math.trunc(p / 2);

  const S1h = sha1(S1.subarray(p));
  const S2h = sha1(S2.subarray(p));
  const K = new Uint8Array(40);
  for (const [i, byte] of S1h.subarray(0, 20).entries()) {
    K[i * 2] = byte;
  }
  for (const [i, byte] of S2h.subarray(0, 20).entries()) {
    K[i * 2 + 1] = byte;
  }
  return K;
}

function xorNg(N: bigint, g: bigint, padLen: number): Uint8Array {
  const nHash = sha1(bigIntToLeBytes(N, padLen)).subarray(0, 20);
  const gHash = sha1(new Uint8Array([Number(g)]));
  return nHash.map((byte, i) => byte ^ (gHash[i] ?? 0));
}

export type SRPServerParams = {
  g: bigint;
  N: bigint;
  salt: Uint8Array;
  B: bigint;
};

export class SRP {
  private readonly account: string;
  private readonly password: string;

  constructor(account: string, password: string) {
    this.account = account.toUpperCase();
    this.password = password.toUpperCase();
  }

  calculate(
    { g, N, salt: saltBytes, B }: SRPServerParams,
    aOverride?: bigint,
  ): SRPResult {
    const nBits = N.toString(2).length;
    const padLen = Math.trunc((nBits + 7) / 8);

    const a =
      aOverride === undefined
        ? leBytesToBigInt(new Uint8Array(randomBytes(padLen)))
        : aOverride;

    if (B % N === 0n) throw new Error("SRP: invalid server B value");

    const B_bytes = bigIntToLeBytes(B, padLen);

    const identityHash = sha1(
      new TextEncoder().encode(`${this.account}:${this.password}`),
    );
    const x = leBytesToBigInt(sha1(saltBytes, identityHash));

    const A = modPow(g, a, N);
    const A_bytes = bigIntToLeBytes(A, padLen);

    const uHash = sha1(A_bytes, B_bytes);
    const u = leBytesToBigInt(uHash);
    if (u === 0n) throw new Error("SRP: invalid u value");

    const exp = u * x + a;
    const kgx = (modPow(g, x, N) * 3n) % N;
    const S_INT = modPow(B + N - kgx, exp, N);

    const K = deriveSessionKey(bigIntToLeBytes(S_INT, padLen), padLen);

    const NgXor = xorNg(N, g, padLen);

    const usernameHash = sha1(new TextEncoder().encode(this.account));

    const M1 = sha1(NgXor, usernameHash, saltBytes, A_bytes, B_bytes, K);

    const M2_hash = sha1(A_bytes, M1, K);

    return {
      K,
      A: A_bytes,
      M1,
      M2: beBytesToBigInt(M2_hash),
    };
  }
}

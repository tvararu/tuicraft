import { createHash, randomBytes } from "node:crypto";

export interface SRPResult {
  A: Uint8Array;
  K: Uint8Array;
  M1: Uint8Array;
  M2: bigint;
}

export function sha1(...buffers: Uint8Array[]): Uint8Array {
  const hash = createHash("sha1");
  for (const buf of buffers) hash.update(buf);
  return new Uint8Array(hash.digest());
}

export function leBytesToBigInt(bytes: Uint8Array): bigint {
  const hex: string[] = [];
  for (let i = bytes.length - 1; i >= 0; i--) {
    hex.push(bytes[i]!.toString(16).padStart(2, "0"));
  }
  if (hex.length === 0) return 0n;
  return BigInt("0x" + hex.join(""));
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
  for (let i = 0; i < bytes.length; i++) {
    hex.push(bytes[i]!.toString(16).padStart(2, "0"));
  }
  if (hex.length === 0) return 0n;
  return BigInt("0x" + hex.join(""));
}

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
      exp -= 1n;
    } else {
      base = (base * base) % mod;
      exp /= 2n;
    }
  }
  return result;
}

export class SRP {
  private account: string;
  private password: string;

  constructor(account: string, password: string) {
    this.account = account.toUpperCase();
    this.password = password.toUpperCase();
  }

  calculate(
    g: bigint,
    N: bigint,
    saltBytes: Uint8Array,
    B: bigint,
    a?: bigint,
  ): SRPResult {
    const nBits = N.toString(2).length;
    const padLen = Math.trunc((nBits + 7) / 8);

    if (a === undefined) {
      a = leBytesToBigInt(new Uint8Array(randomBytes(padLen)));
    }

    if (B % N === 0n) throw new Error("SRP: invalid server B value");

    const B_bytes = bigIntToLeBytes(B, padLen);

    const identityHash = sha1(
      new TextEncoder().encode(this.account + ":" + this.password),
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

    const S_bytes = bigIntToLeBytes(S_INT, padLen);
    const S1 = new Uint8Array(16);
    const S2 = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      S1[i] = S_bytes[i * 2]!;
      S2[i] = S_bytes[i * 2 + 1]!;
    }

    let p = 0;
    while (p < padLen && S_bytes[p] === 0) p++;
    if (p & 1) p++;
    p = Math.trunc(p / 2);

    const S1h = sha1(S1.subarray(p));
    const S2h = sha1(S2.subarray(p));
    const K = new Uint8Array(40);
    for (let i = 0; i < 20; i++) {
      K[i * 2] = S1h[i]!;
      K[i * 2 + 1] = S2h[i]!;
    }

    const nHash = sha1(bigIntToLeBytes(N, padLen));
    const gHash = sha1(new Uint8Array([Number(g)]));
    const NgXor = new Uint8Array(20);
    for (let i = 0; i < 20; i++) {
      NgXor[i] = nHash[i]! ^ gHash[i]!;
    }

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

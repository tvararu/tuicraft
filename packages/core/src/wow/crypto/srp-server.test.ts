import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { bigIntToLeBytes, leBytesToBigInt, modPow, SRP } from "#wow/crypto/srp";

const N = BigInt(
  "0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7",
);
const g = 7n;
const WIDTH = 32;
const ACCOUNT = "SRPTEST";
const PASSWORD = "HUNTER2";

function sha1(...buffers: Uint8Array[]): Uint8Array {
  const hash = createHash("sha1");
  for (const buf of buffers) hash.update(buf);
  return new Uint8Array(hash.digest());
}

function sha1Interleave(S: Uint8Array): Uint8Array {
  const buf0 = new Uint8Array(WIDTH / 2);
  const buf1 = new Uint8Array(WIDTH / 2);
  for (let i = 0; i < WIDTH / 2; i++) {
    buf0[i] = S[2 * i] ?? 0;
    buf1[i] = S[2 * i + 1] ?? 0;
  }
  let p = 0;
  while (p < WIDTH && S[p] === 0) p++;
  if (p & 1) p++;
  p /= 2;
  const hash0 = sha1(buf0.subarray(p));
  const hash1 = sha1(buf1.subarray(p));
  const K = new Uint8Array(40);
  for (let i = 0; i < 20; i++) {
    K[2 * i] = hash0[i] ?? 0;
    K[2 * i + 1] = hash1[i] ?? 0;
  }
  return K;
}

function referenceServer(salt: Uint8Array, b: bigint) {
  const encoder = new TextEncoder();
  const x = leBytesToBigInt(
    sha1(salt, sha1(encoder.encode(`${ACCOUNT}:${PASSWORD}`))),
  );
  const v = modPow(g, x, N);
  const B = (3n * v + modPow(g, b, N)) % N;
  const Bbytes = bigIntToLeBytes(B, WIDTH);
  const verify = (Abytes: Uint8Array, M1: Uint8Array) => {
    const A = leBytesToBigInt(Abytes);
    const u = leBytesToBigInt(sha1(Abytes, Bbytes));
    const S = modPow((A * modPow(v, u, N)) % N, b, N);
    const Sbytes = bigIntToLeBytes(S, WIDTH);
    const K = sha1Interleave(Sbytes);
    const NHash = sha1(bigIntToLeBytes(N, WIDTH));
    const gHash = sha1(new Uint8Array([Number(g)]));
    const NgHash = NHash.map((byte, i) => byte ^ (gHash[i] ?? 0));
    const expectedM1 = sha1(
      NgHash,
      sha1(encoder.encode(ACCOUNT)),
      salt,
      Abytes,
      Bbytes,
      K,
    );
    return {
      K,
      M1ok: Buffer.from(expectedM1).equals(Buffer.from(M1)),
      S: Sbytes,
    };
  };
  return { B, verify };
}

function saltWith(first: number, last: number): Uint8Array {
  const salt = new Uint8Array(WIDTH);
  for (let i = 0; i < WIDTH; i++) salt[i] = (i * 37 + 11) & 0xff;
  salt[0] = first;
  salt[WIDTH - 1] = last;
  return salt;
}

function byteAt(n: bigint, index: number): number {
  return bigIntToLeBytes(n, WIDTH)[index] ?? -1;
}

function topByte(n: bigint): number {
  return byteAt(n, WIDTH - 1);
}

function findB(salt: Uint8Array, index = WIDTH - 1): bigint {
  for (let b = 1n; ; b++) {
    if (byteAt(referenceServer(salt, b).B, index) === 0) return b;
  }
}

function findA(): bigint {
  for (let a = 1n; ; a++) {
    if (topByte(modPow(g, a, N)) === 0) return a;
  }
}

function handshake(salt: Uint8Array, b: bigint, a: bigint) {
  const server = referenceServer(salt, b);
  const client = new SRP(ACCOUNT, PASSWORD).calculate(
    { g, N, salt, B: server.B },
    a,
  );
  return { client, server: server.verify(client.A, client.M1), B: server.B };
}

describe("SRP against a reference 3.3.5a server", () => {
  test("proof and session key match for ordinary values", () => {
    const { client, server } = handshake(
      saltWith(0x5a, 0xa5),
      12_345n,
      67_890n,
    );
    expect(server.M1ok).toBe(true);
    expect(client.K).toEqual(server.K);
  });

  test("salt with a zero first byte stays 32 bytes in the proof", () => {
    const { client, server } = handshake(
      saltWith(0x00, 0xa5),
      12_345n,
      67_890n,
    );
    expect(server.M1ok).toBe(true);
    expect(client.K).toEqual(server.K);
  });

  test("salt with a zero last byte stays 32 bytes in the proof", () => {
    const { server } = handshake(saltWith(0x5a, 0x00), 12_345n, 67_890n);
    expect(server.M1ok).toBe(true);
  });

  test("B whose most significant byte is zero keeps its width", () => {
    const salt = saltWith(0x5a, 0xa5);
    const { client, server, B } = handshake(salt, findB(salt), 67_890n);
    expect(topByte(B)).toBe(0);
    expect(server.M1ok).toBe(true);
    expect(client.K).toEqual(server.K);
  });

  test("B whose least significant byte is zero keeps its width", () => {
    const salt = saltWith(0x5a, 0xa5);
    const { client, server, B } = handshake(salt, findB(salt, 0), 67_890n);
    expect(byteAt(B, 0)).toBe(0);
    expect(server.M1ok).toBe(true);
    expect(client.K).toEqual(server.K);
  });

  test("A whose most significant byte is zero is sent as 32 bytes", () => {
    const a = findA();
    const { client, server } = handshake(saltWith(0x5a, 0xa5), 12_345n, a);
    expect(client.A.byteLength).toBe(WIDTH);
    expect(client.A[WIDTH - 1]).toBe(0);
    expect(server.M1ok).toBe(true);
  });

  for (const [name, index] of [
    ["most significant", WIDTH - 1],
    ["least significant", 0],
  ] as const) {
    test(`S with a zero ${name} byte derives the server's session key`, () => {
      const salt = saltWith(0x5a, 0xa5);
      let matches = 0;
      for (let b = 1n; b < 3_000n && matches < 2; b++) {
        const { client, server } = handshake(salt, b, 67_890n);
        if (server.S[index] !== 0) continue;
        matches++;
        expect(server.M1ok).toBe(true);
        expect(client.K).toEqual(server.K);
      }
      expect(matches).toBe(2);
    });
  }

  test("every value at once with zero edges", () => {
    const salt = saltWith(0x00, 0x00);
    const { client, server } = handshake(salt, findB(salt), findA());
    expect(server.M1ok).toBe(true);
    expect(client.K).toEqual(server.K);
  });
});

test("fixed-width LE encoding round-trips values with zero high bytes", () => {
  for (const n of [0n, 1n, 0xffn, 1n << 240n, (1n << 248n) - 1n, N - 1n]) {
    const bytes = bigIntToLeBytes(n, WIDTH);
    expect(bytes.byteLength).toBe(WIDTH);
    expect(leBytesToBigInt(bytes)).toBe(n);
  }
});

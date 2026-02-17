import { test, expect } from "bun:test";
import { SRP, bigIntToLeBytes, leBytesToBigInt, modPow } from "./srp";

test("bigIntToLeBytes converts correctly", () => {
  const n = BigInt("0x0102030405060708");
  const bytes = bigIntToLeBytes(n, 8);
  expect(bytes).toEqual(
    new Uint8Array([0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01]),
  );
});

test("leBytesToBigInt converts correctly", () => {
  const bytes = new Uint8Array([
    0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01,
  ]);
  expect(leBytesToBigInt(bytes)).toBe(BigInt("0x0102030405060708"));
});

test("bigIntToLeBytes and leBytesToBigInt round-trip", () => {
  const original = BigInt("0xdeadbeefcafe1234");
  const bytes = bigIntToLeBytes(original, 8);
  expect(leBytesToBigInt(bytes)).toBe(original);
});

test("modPow computes correctly", () => {
  expect(modPow(2n, 10n, 1000n)).toBe(24n);
  expect(modPow(3n, 7n, 50n)).toBe(37n);
});

test("SRP computes session key from known parameters", () => {
  const srp = new SRP("TEST", "PASSWORD");
  const g = 7n;
  const N = BigInt(
    "0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7",
  );
  const salt = new Uint8Array(32);
  for (let i = 0; i < 32; i++) salt[i] = i;
  const a = BigInt(
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  );

  const result = srp.calculate(g, N, salt, BigInt("0x2"), a);
  expect(result.A.byteLength).toBe(32);
  expect(result.M1.byteLength).toBe(20);
  expect(result.K.byteLength).toBe(40);
});

test("SRP session key K is 40 bytes with interleaved hashing", () => {
  const srp = new SRP("ADMIN", "ADMIN");
  const g = 7n;
  const N = BigInt(
    "0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7",
  );
  const salt = new Uint8Array(32).fill(0xaa);
  const a = BigInt(
    "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  );

  const result = srp.calculate(g, N, salt, BigInt("0x3"), a);
  expect(result.K.byteLength).toBe(40);
  const allZero = result.K.every((b) => b === 0);
  expect(allZero).toBe(false);
});

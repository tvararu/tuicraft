import { test, expect } from "bun:test";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { leBytesToBigInt } from "wow/crypto/srp";
import {
  buildLogonChallenge,
  buildLogonProof,
  buildRealmListRequest,
  parseLogonChallengeResponse,
  parseLogonProofResponse,
  parseRealmList,
} from "wow/protocol/auth";
import { beBytesToBigInt } from "wow/crypto/srp";

test("buildLogonChallenge produces correct packet", () => {
  const pkt = buildLogonChallenge("Test");
  expect(pkt[0]).toBe(0x00);
  const account = "TEST";
  const tail = new TextDecoder().decode(pkt.slice(pkt.length - account.length));
  expect(tail).toBe(account);
});

test("buildLogonChallenge uppercases account", () => {
  const pkt = buildLogonChallenge("admin");
  const account = "ADMIN";
  const tail = new TextDecoder().decode(pkt.slice(pkt.length - account.length));
  expect(tail).toBe(account);
});

test("parseLogonChallengeResponse extracts SRP params on success", () => {
  const w = new PacketWriter();
  w.uint8(0x00);
  w.uint8(0x00);

  const B = new Uint8Array(32);
  B[0] = 0x42;
  w.rawBytes(B);

  w.uint8(1);
  w.uint8(7);

  w.uint8(32);
  const N = new Uint8Array(32);
  N[0] = 0xb7;
  N[31] = 0x89;
  w.rawBytes(N);

  const salt = new Uint8Array(32);
  for (let i = 0; i < 32; i++) salt[i] = i;
  w.rawBytes(salt);

  w.rawBytes(new Uint8Array(16));
  w.uint8(0);

  const r = new PacketReader(w.finish());
  const result = parseLogonChallengeResponse(r);

  expect(result.status).toBe(0x00);
  expect(result.B).toBeDefined();
  expect(result.B!).toBe(leBytesToBigInt(B));
  expect(result.g).toBeDefined();
  expect(result.g!).toBe(7n);
  expect(result.N).toBeDefined();
  expect(result.N!).toBe(leBytesToBigInt(N));
  expect(result.salt).toEqual(salt);
});

test("parseLogonChallengeResponse returns error status", () => {
  const w = new PacketWriter();
  w.uint8(0x00);
  w.uint8(0x05);

  const r = new PacketReader(w.finish());
  const result = parseLogonChallengeResponse(r);

  expect(result.status).toBe(0x05);
  expect(result.B).toBeUndefined();
});

test("buildLogonProof produces correct packet", () => {
  const A = new Uint8Array(32).fill(0xaa);
  const M1 = new Uint8Array(20).fill(0xbb);
  const K = new Uint8Array(40);
  const pkt = buildLogonProof({ A, M1, K, M2: 0n });

  expect(pkt[0]).toBe(0x01);
  expect(pkt.slice(1, 33)).toEqual(A);
  expect(pkt.slice(33, 53)).toEqual(M1);
  expect(pkt.byteLength).toBe(75);
});

test("parseLogonProofResponse extracts M2 on success", () => {
  const w = new PacketWriter();
  w.uint8(0x00);
  const m2Bytes = new Uint8Array(20);
  m2Bytes[0] = 0xde;
  m2Bytes[19] = 0xad;
  w.rawBytes(m2Bytes);

  const r = new PacketReader(w.finish());
  const result = parseLogonProofResponse(r);

  expect(result.status).toBe(0x00);
  expect(result.M2).toBe(beBytesToBigInt(m2Bytes));
});

test("parseLogonProofResponse returns error status", () => {
  const w = new PacketWriter();
  w.uint8(0x05);

  const r = new PacketReader(w.finish());
  const result = parseLogonProofResponse(r);

  expect(result.status).toBe(0x05);
  expect(result.M2).toBeUndefined();
});

test("buildRealmListRequest produces correct packet", () => {
  const pkt = buildRealmListRequest();

  expect(pkt[0]).toBe(0x10);
  expect(pkt.byteLength).toBe(5);
});

test("parseRealmList extracts realm info", () => {
  const w = new PacketWriter();

  const bodyWriter = new PacketWriter();
  bodyWriter.uint32LE(0);
  bodyWriter.uint16LE(1);

  bodyWriter.uint8(0);
  bodyWriter.uint8(0);
  bodyWriter.uint8(0);
  bodyWriter.cString("Lordaeron");
  bodyWriter.cString("127.0.0.1:8085");
  bodyWriter.uint32LE(0);
  bodyWriter.uint8(2);
  bodyWriter.uint8(1);
  bodyWriter.uint8(42);

  const body = bodyWriter.finish();
  w.uint16LE(body.length);
  w.rawBytes(body);

  const r = new PacketReader(w.finish());
  const realms = parseRealmList(r);

  expect(realms).toHaveLength(1);
  expect(realms[0]!.name).toBe("Lordaeron");
  expect(realms[0]!.host).toBe("127.0.0.1");
  expect(realms[0]!.port).toBe(8085);
  expect(realms[0]!.characters).toBe(2);
  expect(realms[0]!.timezone).toBe(1);
  expect(realms[0]!.id).toBe(42);
});

test("parseRealmList throws on address without port", () => {
  const w = new PacketWriter();
  const bodyWriter = new PacketWriter();
  bodyWriter.uint32LE(0);
  bodyWriter.uint16LE(1);
  bodyWriter.uint8(0);
  bodyWriter.uint8(0);
  bodyWriter.uint8(0);
  bodyWriter.cString("Bad Realm");
  bodyWriter.cString("127.0.0.1");
  bodyWriter.uint32LE(0);
  bodyWriter.uint8(0);
  bodyWriter.uint8(0);
  bodyWriter.uint8(1);
  const body = bodyWriter.finish();
  w.uint16LE(body.length);
  w.rawBytes(body);
  expect(() => parseRealmList(new PacketReader(w.finish()))).toThrow(
    "Invalid realm address",
  );
});

test("parseRealmList throws on non-numeric port", () => {
  const w = new PacketWriter();
  const bodyWriter = new PacketWriter();
  bodyWriter.uint32LE(0);
  bodyWriter.uint16LE(1);
  bodyWriter.uint8(0);
  bodyWriter.uint8(0);
  bodyWriter.uint8(0);
  bodyWriter.cString("Bad Realm");
  bodyWriter.cString("127.0.0.1:abc");
  bodyWriter.uint32LE(0);
  bodyWriter.uint8(0);
  bodyWriter.uint8(0);
  bodyWriter.uint8(1);
  const body = bodyWriter.finish();
  w.uint16LE(body.length);
  w.rawBytes(body);
  expect(() => parseRealmList(new PacketReader(w.finish()))).toThrow(
    "Invalid realm port",
  );
});

test("parseRealmList skips version info when flags & 0x04", () => {
  const w = new PacketWriter();

  const bodyWriter = new PacketWriter();
  bodyWriter.uint32LE(0);
  bodyWriter.uint16LE(1);

  bodyWriter.uint8(0);
  bodyWriter.uint8(0);
  bodyWriter.uint8(0x04);
  bodyWriter.cString("PTR");
  bodyWriter.cString("10.0.0.1:8085");
  bodyWriter.uint32LE(0);
  bodyWriter.uint8(1);
  bodyWriter.uint8(2);
  bodyWriter.uint8(7);
  bodyWriter.uint8(3);
  bodyWriter.uint8(3);
  bodyWriter.uint8(5);
  bodyWriter.uint8(0);

  const body = bodyWriter.finish();
  w.uint16LE(body.length);
  w.rawBytes(body);

  const r = new PacketReader(w.finish());
  const realms = parseRealmList(r);

  expect(realms).toHaveLength(1);
  expect(realms[0]!.name).toBe("PTR");
  expect(realms[0]!.host).toBe("10.0.0.1");
  expect(realms[0]!.port).toBe(8085);
  expect(realms[0]!.id).toBe(7);
});

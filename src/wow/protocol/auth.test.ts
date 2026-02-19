import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { leBytesToBigInt } from "wow/crypto/srp";
import { ChallengeResult } from "wow/protocol/opcodes";
import {
  buildLogonChallenge,
  buildLogonProof,
  buildRealmListRequest,
  buildReconnectProof,
  parseLogonChallengeResponse,
  parseLogonProofResponse,
  parseRealmList,
  parseReconnectChallengeResponse,
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

test("ChallengeResult has all 19 WoW 3.3.5a auth result codes", () => {
  expect(ChallengeResult.SUCCESS).toBe(0x00);
  expect(ChallengeResult.FAIL_UNKNOWN0).toBe(0x01);
  expect(ChallengeResult.FAIL_UNKNOWN1).toBe(0x02);
  expect(ChallengeResult.ACCOUNT_BANNED).toBe(0x03);
  expect(ChallengeResult.ACCOUNT_INVALID).toBe(0x04);
  expect(ChallengeResult.PASSWORD_INVALID).toBe(0x05);
  expect(ChallengeResult.ALREADY_ONLINE).toBe(0x06);
  expect(ChallengeResult.NO_TIME).toBe(0x07);
  expect(ChallengeResult.DB_BUSY).toBe(0x08);
  expect(ChallengeResult.BUILD_INVALID).toBe(0x09);
  expect(ChallengeResult.BUILD_UPDATE).toBe(0x0a);
  expect(ChallengeResult.INVALID_SERVER).toBe(0x0b);
  expect(ChallengeResult.ACCOUNT_SUSPENDED).toBe(0x0c);
  expect(ChallengeResult.NO_ACCESS).toBe(0x0d);
  expect(ChallengeResult.SUCCESS_SURVEY).toBe(0x0e);
  expect(ChallengeResult.PARENTAL_CONTROL).toBe(0x0f);
  expect(ChallengeResult.LOCKED_ENFORCED).toBe(0x10);
  expect(ChallengeResult.TRIAL_EXPIRED).toBe(0x11);
  expect(ChallengeResult.USE_BATTLENET).toBe(0x12);
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
  bodyWriter.uint16LE(2);

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
  bodyWriter.uint16LE(12340);

  bodyWriter.uint8(0);
  bodyWriter.uint8(0);
  bodyWriter.uint8(0);
  bodyWriter.cString("Normal");
  bodyWriter.cString("10.0.0.2:8086");
  bodyWriter.uint32LE(0);
  bodyWriter.uint8(0);
  bodyWriter.uint8(1);
  bodyWriter.uint8(42);

  const body = bodyWriter.finish();
  w.uint16LE(body.length);
  w.rawBytes(body);

  const r = new PacketReader(w.finish());
  const realms = parseRealmList(r);

  expect(realms).toHaveLength(2);
  expect(realms[0]!.name).toBe("PTR");
  expect(realms[0]!.host).toBe("10.0.0.1");
  expect(realms[0]!.port).toBe(8085);
  expect(realms[0]!.id).toBe(7);
  expect(realms[1]!.name).toBe("Normal");
  expect(realms[1]!.host).toBe("10.0.0.2");
  expect(realms[1]!.port).toBe(8086);
  expect(realms[1]!.id).toBe(42);
});

test("parseReconnectChallengeResponse extracts challenge data on success", () => {
  const w = new PacketWriter();
  w.uint8(0x00);
  w.uint8(0x00);
  const challengeData = new Uint8Array(16);
  for (let i = 0; i < 16; i++) challengeData[i] = i + 0xa0;
  w.rawBytes(challengeData);
  w.uint16LE(0);
  w.uint32LE(0);

  const r = new PacketReader(w.finish());
  const result = parseReconnectChallengeResponse(r);

  expect(result.status).toBe(0x00);
  expect(result.challengeData).toEqual(challengeData);
});

test("parseReconnectChallengeResponse returns error status", () => {
  const w = new PacketWriter();
  w.uint8(0x00);
  w.uint8(0x05);

  const r = new PacketReader(w.finish());
  const result = parseReconnectChallengeResponse(r);

  expect(result.status).toBe(0x05);
  expect(result.challengeData).toBeUndefined();
});

test("buildReconnectProof produces correct packet with MD5 proof", () => {
  const account = "TEST";
  const challengeData = new Uint8Array(16).fill(0xaa);
  const testSessionKey = new Uint8Array(40).fill(0xbb);
  const clientData = new Uint8Array(16).fill(0xcc);

  const expectedProof = createHash("md5")
    .update(new TextEncoder().encode(account))
    .update(challengeData)
    .update(clientData)
    .update(testSessionKey)
    .digest();

  const pkt = buildReconnectProof(
    account,
    challengeData,
    testSessionKey,
    clientData,
  );

  expect(pkt[0]).toBe(0x03);
  expect(pkt.slice(1, 17)).toEqual(clientData);
  expect(pkt.slice(17, 37)).toEqual(
    new Uint8Array([...expectedProof, 0, 0, 0, 0]),
  );
  expect(pkt.slice(37, 57)).toEqual(new Uint8Array(20));
  expect(pkt[57]).toBe(0x00);
  expect(pkt.byteLength).toBe(58);
});

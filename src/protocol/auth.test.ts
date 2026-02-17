import { test, expect } from "bun:test";
import { PacketReader, PacketWriter } from "./packet";
import { leBytesToBigInt } from "../crypto/srp";
import {
  buildLogonChallenge,
  parseLogonChallengeResponse,
  parseRealmList,
} from "./auth";

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

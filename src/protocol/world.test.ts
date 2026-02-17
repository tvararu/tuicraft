import { test, expect } from "bun:test";
import { PacketReader, PacketWriter } from "protocol/packet";
import {
  buildWorldAuthPacket,
  parseCharacterList,
  OpcodeDispatch,
  AccumulatorBuffer,
  buildOutgoingPacket,
  decryptIncomingHeader,
  INCOMING_HEADER_SIZE,
  OUTGOING_HEADER_SIZE,
} from "protocol/world";
import { Arc4 } from "crypto/arc4";

test("buildWorldAuthPacket produces valid packet", async () => {
  const sessionKey = new Uint8Array(40);
  const serverSeed = new Uint8Array(4);
  const result = await buildWorldAuthPacket("Test", sessionKey, serverSeed, 1);
  expect(result.byteLength).toBeGreaterThan(6);
});

test("parseCharacterList extracts character names and GUIDs", () => {
  const w = new PacketWriter();
  w.uint8(1);

  w.uint32LE(0x01);
  w.uint32LE(0x00);
  w.cString("Arthas");
  w.uint8(1);
  w.uint8(2);
  w.uint8(0);
  w.uint32LE(0);
  w.uint8(0);
  w.uint8(80);
  w.uint32LE(1);
  w.uint32LE(0);
  w.floatLE(0);
  w.floatLE(0);
  w.floatLE(0);
  w.uint32LE(0);
  w.uint32LE(0);
  w.uint32LE(0);
  w.uint8(0);
  w.uint32LE(0);
  w.uint32LE(0);
  w.uint32LE(0);
  for (let i = 0; i < 23; i++) {
    w.uint32LE(0);
    w.uint8(0);
    w.uint32LE(0);
  }

  const r = new PacketReader(w.finish());
  const chars = parseCharacterList(r);
  expect(chars).toHaveLength(1);
  expect(chars[0]!.name).toBe("Arthas");
  expect(chars[0]!.guidLow).toBe(0x01);
  expect(chars[0]!.guidHigh).toBe(0x00);
  expect(chars[0]!.race).toBe(1);
  expect(chars[0]!.classId).toBe(2);
  expect(chars[0]!.gender).toBe(0);
  expect(chars[0]!.level).toBe(80);
  expect(chars[0]!.zone).toBe(1);
  expect(chars[0]!.map).toBe(0);
});

test("OpcodeDispatch persistent handler fires on matching opcode", () => {
  const dispatch = new OpcodeDispatch();
  let called = false;
  dispatch.on(0x01, () => {
    called = true;
  });
  dispatch.handle(0x01, new PacketReader(new Uint8Array(0)));
  expect(called).toBe(true);
});

test("OpcodeDispatch expect resolves on matching opcode", async () => {
  const dispatch = new OpcodeDispatch();
  const promise = dispatch.expect(0x02);
  const reader = new PacketReader(new Uint8Array([0x42]));
  dispatch.handle(0x02, reader);
  const result = await promise;
  expect(result.uint8()).toBe(0x42);
});

test("OpcodeDispatch expect takes priority over persistent handler", async () => {
  const dispatch = new OpcodeDispatch();
  let persistentCalled = false;
  dispatch.on(0x03, () => {
    persistentCalled = true;
  });
  const promise = dispatch.expect(0x03);
  dispatch.handle(0x03, new PacketReader(new Uint8Array([0xff])));
  const result = await promise;
  expect(result.uint8()).toBe(0xff);
  expect(persistentCalled).toBe(false);
});

test("AccumulatorBuffer accumulates and drains", () => {
  const buf = new AccumulatorBuffer();
  buf.append(new Uint8Array([1, 2, 3]));
  buf.append(new Uint8Array([4, 5]));
  expect(buf.length).toBe(5);
  const drained = buf.drain(3);
  expect(drained).toEqual(new Uint8Array([1, 2, 3]));
  expect(buf.length).toBe(2);
  const rest = buf.drain(2);
  expect(rest).toEqual(new Uint8Array([4, 5]));
  expect(buf.length).toBe(0);
});

test("AccumulatorBuffer peek does not consume", () => {
  const buf = new AccumulatorBuffer();
  buf.append(new Uint8Array([10, 20, 30]));
  const peeked = buf.peek(2);
  expect(peeked).toEqual(new Uint8Array([10, 20]));
  expect(buf.length).toBe(3);
});

test("buildOutgoingPacket creates correct header without encryption", () => {
  const body = new Uint8Array([0xaa, 0xbb]);
  const pkt = buildOutgoingPacket(0x01ed, body);
  expect(pkt.byteLength).toBe(OUTGOING_HEADER_SIZE + 2);
  const view = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
  expect(view.getUint16(0, false)).toBe(6);
  expect(view.getUint32(2, true)).toBe(0x01ed);
  expect(pkt[6]).toBe(0xaa);
  expect(pkt[7]).toBe(0xbb);
});

test("buildOutgoingPacket encrypts header with arc4", () => {
  const sessionKey = new Uint8Array(40);
  for (let i = 0; i < 40; i++) sessionKey[i] = i;
  const arc4 = new Arc4(sessionKey);
  const body = new Uint8Array([0xcc]);
  const pkt = buildOutgoingPacket(0x01ed, body, arc4);
  expect(pkt.byteLength).toBe(OUTGOING_HEADER_SIZE + 1);
  expect(pkt[6]).toBe(0xcc);
});

test("decryptIncomingHeader parses without encryption", () => {
  const header = new Uint8Array(4);
  const view = new DataView(header.buffer);
  view.setUint16(0, 10, false);
  view.setUint16(2, 0x01ee, true);
  const result = decryptIncomingHeader(header);
  expect(result.size).toBe(10);
  expect(result.opcode).toBe(0x01ee);
});

test("INCOMING_HEADER_SIZE is 4", () => {
  expect(INCOMING_HEADER_SIZE).toBe(4);
});

test("OUTGOING_HEADER_SIZE is 6", () => {
  expect(OUTGOING_HEADER_SIZE).toBe(6);
});

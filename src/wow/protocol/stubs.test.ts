import { test, expect, describe } from "bun:test";
import { PacketReader } from "wow/protocol/packet";
import { OpcodeDispatch } from "wow/protocol/world";
import { GameOpcode } from "wow/protocol/opcodes";
import { STUBS, registerStubs } from "wow/protocol/stubs";

describe("registerStubs", () => {
  test("registers SMSG opcodes that aren't already handled", () => {
    const d = new OpcodeDispatch();
    d.on(GameOpcode.SMSG_MESSAGE_CHAT, () => {});
    registerStubs(d, () => true);

    expect(d.has(GameOpcode.SMSG_CONTACT_LIST)).toBe(true);
    expect(d.has(GameOpcode.SMSG_GUILD_EVENT)).toBe(true);
  });

  test("skips opcodes already registered", () => {
    const d = new OpcodeDispatch();
    let realCalled = false;
    d.on(GameOpcode.SMSG_MESSAGE_CHAT, () => {
      realCalled = true;
    });
    registerStubs(d, () => true);

    d.handle(GameOpcode.SMSG_MESSAGE_CHAT, new PacketReader(new Uint8Array(0)));
    expect(realCalled).toBe(true);
  });

  test("notifies on first receipt only", () => {
    const d = new OpcodeDispatch();
    const messages: string[] = [];
    registerStubs(d, (msg) => {
      messages.push(msg);
      return true;
    });

    d.handle(GameOpcode.SMSG_CONTACT_LIST, new PacketReader(new Uint8Array(0)));
    d.handle(GameOpcode.SMSG_CONTACT_LIST, new PacketReader(new Uint8Array(0)));

    const matching = messages.filter((m) => m.includes("Friends"));
    expect(matching).toHaveLength(1);
  });

  test("retries notification when notify returns false", () => {
    const d = new OpcodeDispatch();
    const messages: string[] = [];
    let ready = false;
    registerStubs(d, (msg) => {
      if (!ready) return false;
      messages.push(msg);
      return true;
    });

    d.handle(GameOpcode.SMSG_CONTACT_LIST, new PacketReader(new Uint8Array(0)));
    expect(messages).toHaveLength(0);

    ready = true;
    d.handle(GameOpcode.SMSG_CONTACT_LIST, new PacketReader(new Uint8Array(0)));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Friends");

    d.handle(GameOpcode.SMSG_CONTACT_LIST, new PacketReader(new Uint8Array(0)));
    expect(messages).toHaveLength(1);
  });

  test("STUBS array contains metadata for all entries", () => {
    for (const stub of STUBS) {
      expect(stub.opcode).toBeGreaterThan(0);
      expect(stub.area).toBeTruthy();
      expect(stub.label).toBeTruthy();
      expect(["high", "medium", "low"]).toContain(stub.priority);
    }
  });

  test("does not register CMSG opcodes on dispatch", () => {
    const d = new OpcodeDispatch();
    registerStubs(d, () => true);
    expect(d.has(GameOpcode.CMSG_ADD_FRIEND)).toBe(false);
    expect(d.has(GameOpcode.CMSG_CAST_SPELL)).toBe(false);
  });
});

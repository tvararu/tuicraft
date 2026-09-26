import { describe, expect, test } from "bun:test";
import { GameOpcode } from "#wow/protocol/opcodes";
import { PacketReader } from "#wow/protocol/packet";
import { registerStubs, STUBS } from "#wow/protocol/stubs";
import { OpcodeDispatch } from "#wow/protocol/world";

describe("registerStubs", () => {
  test("registers SMSG opcodes that aren't already handled", () => {
    const d = new OpcodeDispatch();
    d.on(GameOpcode.SMSG_MESSAGE_CHAT, () => {});
    registerStubs(d, () => true);

    expect(d.has(GameOpcode.SMSG_WEATHER)).toBe(true);
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

    d.handle(GameOpcode.SMSG_WEATHER, new PacketReader(new Uint8Array(0)));
    d.handle(GameOpcode.SMSG_WEATHER, new PacketReader(new Uint8Array(0)));

    const matching = messages.filter((m) => m.includes("Weather"));
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

    d.handle(GameOpcode.SMSG_WEATHER, new PacketReader(new Uint8Array(0)));
    expect(messages).toHaveLength(0);

    ready = true;
    d.handle(GameOpcode.SMSG_WEATHER, new PacketReader(new Uint8Array(0)));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Weather");

    d.handle(GameOpcode.SMSG_WEATHER, new PacketReader(new Uint8Array(0)));
    expect(messages).toHaveLength(1);
  });

  test("lists only server opcodes", () => {
    const names = new Map<number, string>(
      Object.entries(GameOpcode).map(([name, value]) => [value, name]),
    );
    for (const [opcode] of STUBS)
      expect(names.get(opcode)).toMatch(/^(SMSG|MSG)_/);
  });
});

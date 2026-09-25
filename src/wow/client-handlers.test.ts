import { describe, expect, test } from "bun:test";
import type { WorldConn } from "wow/client";
import { registerGameHandlers } from "wow/client-handlers";
import { GameOpcode } from "wow/protocol/opcodes";
import { STUBS } from "wow/protocol/stubs";
import { OpcodeDispatch } from "wow/protocol/world";

describe("registerGameHandlers", () => {
  test("leaves every stubbed opcode without a real handler", () => {
    const dispatch = new OpcodeDispatch();
    registerGameHandlers({ dispatch } as unknown as WorldConn);
    const names = new Map<number, string>(
      Object.entries(GameOpcode).map(([name, value]) => [value, name]),
    );
    const shadowed = STUBS.filter(([opcode]) => dispatch.has(opcode)).map(
      ([opcode]) => names.get(opcode),
    );
    expect(shadowed).toEqual([]);
  });
});

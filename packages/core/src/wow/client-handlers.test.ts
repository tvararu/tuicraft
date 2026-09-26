import { describe, expect, jest, test } from "bun:test";
import { MARNIEL, MARNIEL_LIST_INVENTORY } from "#test-support/vendor-fixtures";
import {
  registerGameHandlers,
  registerWorldHandlers,
} from "#wow/client-handlers";
import { GameOpcode } from "#wow/protocol/opcodes";
import { PacketReader } from "#wow/protocol/packet";
import { STUBS } from "#wow/protocol/stubs";
import { OpcodeDispatch } from "#wow/protocol/world";
import type { WorldConn } from "#wow/world-conn";

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

describe("registerWorldHandlers", () => {
  test("registers each opcode exactly once across every module", () => {
    const counts = new Map<number, number>();
    const dispatch = {
      has: (opcode: number) => counts.has(opcode),
      on: (opcode: number) => counts.set(opcode, (counts.get(opcode) ?? 0) + 1),
    };
    const events = { message: { size: 0, emit: () => {} } };
    registerWorldHandlers({ dispatch, events } as unknown as WorldConn);
    const names = new Map<number, string>(
      Object.entries(GameOpcode).map(([name, value]) => [value, name]),
    );
    const duplicates = [...counts]
      .filter(([, count]) => count > 1)
      .map(([opcode]) => names.get(opcode) ?? `0x${opcode.toString(16)}`);
    expect(duplicates).toEqual([]);
  });

  test("routes a vendor list to both the quest request and the vendor window", () => {
    const dispatch = new OpcodeDispatch();
    const receiveInventory = jest.fn();
    const receiveWindow = jest.fn();
    const events = { message: { size: 0, emit: () => {} } };
    registerWorldHandlers({
      dispatch,
      events,
      quests: { receiveWindow },
      vendor: { receiveInventory },
    } as unknown as WorldConn);
    dispatch.handle(
      GameOpcode.SMSG_LIST_INVENTORY,
      new PacketReader(MARNIEL_LIST_INVENTORY),
    );
    expect(receiveWindow.mock.calls).toEqual([[MARNIEL, "vendor"]]);
    expect(receiveInventory).toHaveBeenCalledTimes(1);
    expect(receiveInventory.mock.calls[0]?.[0]).toMatchObject({
      guid: MARNIEL,
      emptyReason: undefined,
    });
  });
});

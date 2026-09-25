import { describe, expect, test } from "bun:test";
import type { WorldConn } from "wow/client";
import { CombatRuntime } from "wow/combat";
import { registerCombatHandlers } from "wow/gameplay-handlers";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketReader } from "wow/protocol/packet";
import { OpcodeDispatch } from "wow/protocol/world";

describe("registerCombatHandlers", () => {
  test("attack swing errors are named, not opcode numbers", () => {
    const combat = new CombatRuntime({
      send() {},
      now: () => 1,
      selfGuid: () => 1n,
      selectedGuid: () => 2n,
      getEntity: () => undefined,
      selfPose: () => undefined,
    });
    const conn = {
      dispatch: new OpcodeDispatch(),
      combat,
    } as unknown as WorldConn;
    registerCombatHandlers(conn);
    combat.attack(2n);
    conn.dispatch.handle(
      GameOpcode.SMSG_ATTACKSWING_NOTINRANGE,
      new PacketReader(new Uint8Array()),
    );
    const outcome = combat.snapshot().lastOutcome;
    expect(outcome).toMatchObject({
      kind: "attack",
      status: "failed",
      error: "not_in_range",
    });
    expect(outcome?.result).toBeUndefined();
  });
});

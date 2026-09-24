import { describe, expect, test } from "bun:test";
import { registerMovementHandlers } from "wow/movement-handlers";
import { ControlRuntime } from "wow/control";
import { EntityStore } from "wow/entity-store";
import type { WorldConn } from "wow/client";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { GameOpcode } from "wow/protocol/opcodes";
import { ObjectType } from "wow/protocol/entity-fields";
import { OpcodeDispatch } from "wow/protocol/world";
import { writeMovementInfo } from "wow/protocol/movement";

describe("handleNearTeleport", () => {
  function nearTeleportBody(guidLow: number): Uint8Array {
    const w = new PacketWriter();
    w.packedGuid(guidLow, 0);
    writeMovementInfo(w, {
      flags: 0,
      extraFlags: 0,
      time: 1,
      x: 100,
      y: 200,
      z: 50,
      orientation: 1,
      fallTime: 0,
    });
    return w.finish();
  }

  function fakeConn(control: unknown, store: EntityStore): WorldConn {
    return {
      dispatch: new OpcodeDispatch(),
      selfGuidLow: 0x0764,
      selfGuidHigh: 0,
      control,
      entityStore: store,
    } as unknown as WorldConn;
  }

  test("0x0C5 routes self teleport to control with exact pose", () => {
    const store = new EntityStore();
    const sent: { opcode: number; body: Uint8Array }[] = [];
    const runtime = new ControlRuntime({
      send: (opcode, body) => {
        sent.push({ opcode, body: body ?? new Uint8Array() });
      },
      ticks: () => 0,
      now: () => 10_000,
      selfGuid: () => 0x0764n,
      findHeight: (_mapId, _x, _y, from) => from?.z ?? 70.34,
      isPathClear: () => false,
    });
    runtime.loginVerified({
      mapId: 530,
      x: 8709.46,
      y: -6671.76,
      z: 70.34,
      orientation: 0.5,
    });
    sent.length = 0;
    const conn = fakeConn(runtime, store);
    registerMovementHandlers(conn);
    expect(conn.dispatch.has(GameOpcode.MSG_MOVE_TELEPORT)).toBe(true);
    conn.dispatch.handle(
      GameOpcode.MSG_MOVE_TELEPORT,
      new PacketReader(nearTeleportBody(0x0764)),
    );
    expect(runtime.snapshot().moving).toBe(false);
    expect(runtime.snapshot().pose?.source).toBe("server");
    expect(runtime.snapshot().serverPose).toMatchObject({
      x: 100,
      y: 200,
      z: 50,
      orientation: 1,
    });
    expect(sent.length).toBe(0);
  });

  test("0x0C5 from another unit updates the entity store", () => {
    const store = new EntityStore();
    store.create(0x99n, ObjectType.UNIT, {
      position: { mapId: 530, x: 1, y: 2, z: 3, orientation: 0 },
    });
    let handled = 0;
    const conn = fakeConn(
      {
        currentMapId: () => 530,
        nearTeleport: () => {
          handled++;
        },
      },
      store,
    );
    registerMovementHandlers(conn);
    conn.dispatch.handle(
      GameOpcode.MSG_MOVE_TELEPORT,
      new PacketReader(nearTeleportBody(0x99)),
    );
    expect(handled).toBe(0);
    expect(store.get(0x99n)?.position).toEqual({
      mapId: 530,
      x: 100,
      y: 200,
      z: 50,
      orientation: 1,
    });
  });
});

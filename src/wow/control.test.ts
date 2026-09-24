import { GroundRoute } from "wow/navigation";
import type { NativeMap } from "wow/navigation-native";
import { test, expect, describe, jest } from "bun:test";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { GameOpcode } from "wow/protocol/opcodes";
import { MovementFlag } from "wow/protocol/entity-fields";
import { parseMovementInfo, writeMovementInfo } from "wow/protocol/movement";

import {
  ControlRuntime,
  classifyNavigationRefusal,
  type ControlEvent,
  type ControlDeps,
} from "wow/control";

type Sent = { opcode: number; body: Uint8Array };

function loginReader(): PacketReader {
  const w = new PacketWriter();
  w.uint32LE(530);
  w.floatLE(8709.46);
  w.floatLE(-6671.76);
  w.floatLE(70.34);
  w.floatLE(0.5);
  return new PacketReader(w.finish());
}

function setup(over: Partial<ControlDeps> = {}): {
  runtime: ControlRuntime;
  sent: Sent[];
  events: ControlEvent[];
  advance: (ms: number) => void;
} {
  const sent: Sent[] = [];
  const events: ControlEvent[] = [];
  let now = 10_000;
  const deps: ControlDeps = {
    send: (opcode, body) =>
      sent.push({ opcode, body: body ?? new Uint8Array() }),
    ticks: () => now - 10_000,
    now: () => now,
    selfGuid: () => 0x0764n,
    findHeight: (_mapId, _x, _y, from) => from?.z ?? 70.34,
    ...over,
  };
  const runtime = new ControlRuntime(deps);
  runtime.onEvent((event) => events.push(event));
  runtime.applyLoginVerify(loginReader());
  runtime.observeSelf({
    position: {
      mapId: 530,
      x: 8709.46,
      y: -6671.76,
      z: 70.34,
      orientation: 0.5,
    },
    runSpeed: 7,
    runBackSpeed: 4.5,
  });
  return {
    runtime,
    sent,
    events,
    advance: (ms) => {
      now += ms;
      jest.advanceTimersByTime(ms);
    },
  };
}

function lastMove(sent: Sent[]): {
  opcode: number;
  flags: number;
  x: number;
  y: number;
} {
  const packet = sent[sent.length - 1]!;
  const r = new PacketReader(packet.body);
  r.packedGuid();
  const info = parseMovementInfo(r);
  return { opcode: packet.opcode, flags: info.flags, x: info.x, y: info.y };
}

describe("ControlRuntime", () => {
  test("login verify is server pose and claims active mover", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent } = setup();
      const state = runtime.snapshot();
      expect(state.pose?.source).toBe("server");
      expect(state.pose?.mapId).toBe(530);
      expect(state.serverPose?.x).toBeCloseTo(8709.46, 2);
      expect(state.moving).toBe(false);
      expect(sent[0]!.opcode).toBe(GameOpcode.CMSG_SET_ACTIVE_MOVER);
    } finally {
      jest.useRealTimers();
    }
  });

  test("move then halt predicts displacement and keeps server pose", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, events, advance } = setup();
      sent.length = 0;
      runtime.move("forward", 1000);
      expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_START_FORWARD);
      expect(runtime.snapshot().pose?.source).toBe("predicted");
      expect(runtime.snapshot().owner).toBe("manual");
      advance(1000);
      expect(runtime.snapshot().moving).toBe(false);
      const pose = runtime.snapshot().pose!;
      expect(pose.source).toBe("predicted");
      expect(pose.x).toBeCloseTo(8709.46 + Math.cos(0.5) * 7, 5);
      expect(pose.y).toBeCloseTo(-6671.76 + Math.sin(0.5) * 7, 5);
      expect(pose.z).toBeCloseTo(70.34, 5);
      expect(runtime.snapshot().serverPose?.x).toBeCloseTo(8709.46, 2);
      expect(events.some((e) => e.type === "movement_started")).toBe(true);
      expect(events.some((e) => e.type === "movement_stopped")).toBe(true);
      expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_STOP);
    } finally {
      jest.useRealTimers();
    }
  });

  test("repeating the same direction renews the lease without a second start", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup();
      sent.length = 0;
      runtime.move("forward", 400);
      const starts = sent.filter(
        (p) => p.opcode === GameOpcode.MSG_MOVE_START_FORWARD,
      );
      expect(starts).toHaveLength(1);
      runtime.move("forward", 800);
      expect(
        sent.filter((p) => p.opcode === GameOpcode.MSG_MOVE_START_FORWARD),
      ).toHaveLength(1);
      advance(400);
      expect(runtime.snapshot().moving).toBe(true);
      advance(400);
      expect(runtime.snapshot().moving).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
  test("directed walk stops at the requested distance without overshooting", async () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup({ isPathClear: () => true });
      const start = runtime.snapshot().pose!;
      const walk = runtime.walkToward(
        { x: start.x + 10, y: start.y, z: start.z },
        3,
      );
      advance(500);
      const result = await walk;
      expect(result).toMatchObject({
        status: "completed",
        traveled: 3,
        pose: { source: "predicted" },
      });
      expect(result.pose.x).toBeCloseTo(start.x + 3, 4);
      expect(result.pose.y).toBeCloseTo(start.y, 4);
      expect(runtime.snapshot().moving).toBe(false);
      expect(sent.at(-1)?.opcode).toBe(GameOpcode.MSG_MOVE_STOP);
    } finally {
      jest.useRealTimers();
    }
  });
  test("directed walk stops at a nearer sampled target", async () => {
    jest.useFakeTimers();
    try {
      const { runtime, advance } = setup({ isPathClear: () => true });
      const start = runtime.snapshot().pose!;
      const walk = runtime.walkToward(
        { x: start.x + 1, y: start.y, z: start.z },
        5,
      );
      advance(200);
      const outcome = await walk;
      expect(outcome).toMatchObject({ status: "completed", traveled: 1 });
      expect(outcome.pose.x).toBeCloseTo(start.x + 1, 4);
      expect(runtime.snapshot().moving).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test("directed walk halts on abort and cannot cancel a later manual owner", async () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup({ isPathClear: () => true });
      const start = runtime.snapshot().pose!;
      const abort = new AbortController();
      const walk = runtime.walkToward(
        { x: start.x + 12, y: start.y, z: start.z },
        10,
        abort.signal,
      );
      advance(200);
      abort.abort();
      expect(await walk).toMatchObject({ status: "stopped", reason: "abort" });
      expect(runtime.snapshot().moving).toBe(false);
      expect(sent.at(-1)?.opcode).toBe(GameOpcode.MSG_MOVE_STOP);
      runtime.move("forward", 500);
      abort.abort();
      expect(runtime.snapshot().moving).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("directed walk checks intervening ground after a delayed timer", async () => {
    jest.useFakeTimers();
    try {
      let now = 10_000;
      const startX = 8709.46;
      const { runtime, advance } = setup({
        now: () => now,
        ticks: () => now - 10_000,
        findHeight: (_map, x, _y, from) => {
          if (x > startX + 0.5 && x < startX + 1.5)
            throw new Error("UNKNOWN_HEIGHT");
          return from?.z ?? 70.34;
        },
      });
      const start = runtime.snapshot().pose!;
      const walk = runtime.walkToward(
        { x: start.x + 4, y: start.y, z: start.z },
        4,
      );
      now += 600;
      advance(100);
      const result = await walk;
      expect(result).toMatchObject({
        status: "stopped",
        reason: "obstructed",
      });
      expect(result.traveled).toBeLessThanOrEqual(0.5);
      expect(result.pose.x).toBeLessThanOrEqual(startX + 0.5);
    } finally {
      jest.useRealTimers();
    }
  });
  test("directed walk refuses a wall despite valid ground heights", async () => {
    jest.useFakeTimers();
    try {
      const { runtime, advance } = setup({
        findHeight: () => 70.34,
        isPathClear: () => false,
      });
      const start = runtime.snapshot().pose!;
      const walk = runtime.walkToward(
        { x: start.x + 4, y: start.y, z: start.z },
        4,
      );
      advance(1000);
      const result = await walk;
      expect(result).toMatchObject({
        status: "stopped",
        reason: "obstructed",
        traveled: 0,
      });
      expect(result.pose.x).toBeCloseTo(start.x, 4);
    } finally {
      jest.useRealTimers();
    }
  });

  test("directed walk refuses ground that cannot connect back to the origin", async () => {
    jest.useFakeTimers();
    try {
      const originX = 8709.46;
      const { runtime, advance } = setup({
        findHeight: (_map, x, _y, from) =>
          from && from.x > originX && x === originX ? 71.34 : 70.34,
        isPathClear: () => true,
      });
      const start = runtime.snapshot().pose!;
      const walk = runtime.walkToward(
        { x: start.x + 4, y: start.y, z: start.z },
        4,
      );
      advance(1000);
      const result = await walk;
      expect(result).toMatchObject({
        status: "stopped",
        traveled: 0,
      });
      expect(result.pose.x).toBeCloseTo(start.x, 4);
    } finally {
      jest.useRealTimers();
    }
  });

  test("slow but progressing directed walk outlives the safety lease", async () => {
    jest.useFakeTimers();
    try {
      const { runtime, advance } = setup({ isPathClear: () => true });
      runtime.observeSelf({ runSpeed: 1 });
      const start = runtime.snapshot().pose!;
      const walk = runtime.walkToward(
        { x: start.x + 15, y: start.y, z: start.z },
        15,
      );
      advance(10_000);
      expect(runtime.snapshot().moving).toBe(true);
      advance(5_000);
      expect(await walk).toMatchObject({ status: "completed", traveled: 15 });
    } finally {
      jest.useRealTimers();
    }
  });

  test("a failed movement send does not retain an active directed walk", () => {
    jest.useFakeTimers();
    try {
      const { runtime } = setup({
        send: (opcode) => {
          if (opcode === GameOpcode.MSG_MOVE_START_FORWARD)
            throw new Error("connection_failed");
        },
      });
      const start = runtime.snapshot().pose!;
      expect(() =>
        runtime.walkToward({ x: start.x + 4, y: start.y, z: start.z }, 4),
      ).toThrow("connection_failed");
      expect(runtime.walkActive()).toBe(false);
      expect(runtime.snapshot().moving).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
  test("directed walk refuses zero speed instead of hanging under a lease", () => {
    jest.useFakeTimers();
    const { runtime, sent } = setup();
    try {
      runtime.observeSelf({ runSpeed: 0 });
      const pose = runtime.snapshot().pose!;
      sent.length = 0;
      let failure: unknown;
      try {
        const pending = runtime.walkToward(
          { x: pose.x + 4, y: pose.y, z: pose.z },
          4,
        );
        runtime.halt();
        void pending;
      } catch (error) {
        failure = error;
      }
      expect(failure).toEqual(new Error("missing_speed"));
      expect(runtime.walkActive()).toBe(false);
      expect(sent).toHaveLength(0);
    } finally {
      runtime.halt();
      jest.useRealTimers();
    }
  });

  test("changing direction stops then starts without resetting pose", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup();
      sent.length = 0;
      runtime.move("forward", 2000);
      advance(500);
      const mid = runtime.snapshot().pose!;
      expect(mid.x).toBeCloseTo(8709.46 + Math.cos(0.5) * 7 * 0.5, 5);
      sent.length = 0;
      runtime.move("left", 2000);
      expect(sent.map((p) => p.opcode)).toEqual([
        GameOpcode.MSG_MOVE_STOP,
        GameOpcode.MSG_MOVE_START_STRAFE_LEFT,
      ]);
      expect(runtime.snapshot().moving).toBe(true);
      expect(runtime.snapshot().direction).toBe("left");
      const switched = runtime.snapshot().pose!;
      expect(switched.x).toBeCloseTo(mid.x, 5);
      expect(switched.y).toBeCloseTo(mid.y, 5);
      advance(500);
      const leftHeading = 0.5 + Math.PI / 2;
      const after = runtime.snapshot().pose!;
      expect(after.x).toBeCloseTo(mid.x + Math.cos(leftHeading) * 7 * 0.5, 5);
      expect(after.y).toBeCloseTo(mid.y + Math.sin(leftHeading) * 7 * 0.5, 5);
    } finally {
      jest.useRealTimers();
    }
  });

  test("immediate halt cancels timers and sends stop", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup();
      sent.length = 0;
      runtime.move("forward", 5000);
      runtime.halt();
      expect(runtime.snapshot().moving).toBe(false);
      expect(runtime.snapshot().owner).toBe("none");
      expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_STOP);
      const after = sent.length;
      advance(5000);
      expect(sent.length).toBe(after);
    } finally {
      jest.useRealTimers();
    }
  });

  test("rejects missing speed, invalid duration, and rooted movement", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent } = setup();
      const noSpeed = new ControlRuntime({
        send: (opcode, body) =>
          sent.push({ opcode, body: body ?? new Uint8Array() }),
        ticks: () => 0,
        now: () => 0,
        selfGuid: () => 1n,
      });
      noSpeed.applyLoginVerify(loginReader());
      expect(() => noSpeed.move("forward", 1000)).toThrow("missing_speed");
      expect(() => runtime.move("forward", 0)).toThrow("invalid_duration");
      expect(() => runtime.move("forward", 10001)).toThrow("invalid_duration");
      runtime.forceRoot(3);
      expect(runtime.snapshot().movementAllowed).toBe(false);
      expect(runtime.snapshot().blockedReason).toBe("rooted");
      expect(() => runtime.move("forward", 1000)).toThrow("rooted");
    } finally {
      jest.useRealTimers();
    }
  });

  test("face updates predicted orientation without claiming server confirmation", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent } = setup();
      sent.length = 0;
      runtime.face(1.25);
      expect(runtime.snapshot().pose?.orientation).toBeCloseTo(1.25, 4);
      expect(runtime.snapshot().pose?.source).toBe("predicted");
      expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_SET_FACING);
    } finally {
      jest.useRealTimers();
    }
  });

  test("selectTarget is requested until observeTarget", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, events } = setup();
      sent.length = 0;
      runtime.selectTarget(0xabcn);
      expect(runtime.snapshot().requestedTarget).toBe(0xabcn);
      expect(runtime.snapshot().target).toBeUndefined();
      expect(sent[0]!.opcode).toBe(GameOpcode.CMSG_SET_SELECTION);
      const guid = new PacketReader(sent[0]!.body).uint64LE();
      expect(guid).toBe(0xabcn);
      runtime.observeTarget(0xabcn);
      expect(runtime.snapshot().target).toBe(0xabcn);
      expect(events.some((e) => e.type === "target_requested")).toBe(true);
      expect(events.some((e) => e.type === "target_observed")).toBe(true);
      runtime.selectTarget(0n);
      expect(runtime.snapshot().requestedTarget).toBe(0n);
    } finally {
      jest.useRealTimers();
    }
  });

  test("teleport ack snaps to server pose and stops movement", () => {
    jest.useFakeTimers();
    try {
      const { runtime, events } = setup();
      runtime.move("forward", 2000);
      const w = new PacketWriter();
      w.packedGuid(0x0764, 0);
      w.uint32LE(4);
      writeMovementInfo(w, {
        flags: 0,
        extraFlags: 0,
        time: 1,
        x: 100,
        y: 200,
        z: 50,
        orientation: 0,
        fallTime: 0,
      });
      runtime.handleTeleportAck(new PacketReader(w.finish()));
      expect(runtime.snapshot().moving).toBe(false);
      expect(runtime.snapshot().pose?.source).toBe("server");
      expect(runtime.snapshot().pose?.x).toBe(100);
      expect(
        events.some(
          (e) => e.type === "server_correction" && e.reason === "teleport",
        ),
      ).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("near teleport snaps server pose without ack", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, events } = setup();
      runtime.move("forward", 2000);
      sent.length = 0;
      runtime.handleNearTeleport({
        flags: 0,
        extraFlags: 0,
        time: 1,
        x: 100,
        y: 200,
        z: 50,
        orientation: 1,
        fallTime: 0,
      });
      expect(runtime.snapshot().moving).toBe(false);
      expect(runtime.snapshot().pose?.source).toBe("server");
      expect(runtime.snapshot().pose?.x).toBe(100);
      expect(runtime.snapshot().serverPose?.x).toBe(100);
      expect(sent.length).toBe(0);
      expect(
        events.some(
          (e) => e.type === "server_correction" && e.reason === "near_teleport",
        ),
      ).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("client control loss blocks movement", () => {
    jest.useFakeTimers();
    try {
      const { runtime } = setup();
      const w = new PacketWriter();
      w.packedGuid(0x0764, 0);
      w.uint8(0);
      runtime.handleClientControl(new PacketReader(w.finish()));
      expect(runtime.snapshot().movementAllowed).toBe(false);
      expect(() => runtime.move("left", 500)).toThrow("no_control");
    } finally {
      jest.useRealTimers();
    }
  });

  test("unsupported transport flags are reported instead of faked", () => {
    jest.useFakeTimers();
    try {
      const { runtime } = setup();
      runtime.observeSelf({
        position: { mapId: 530, x: 1, y: 2, z: 3, orientation: 0 },
        movementFlags: MovementFlag.ON_TRANSPORT,
        runSpeed: 7,
      });
      expect(runtime.snapshot().blockedReason).toBe("transport");
      expect(() => runtime.move("forward", 500)).toThrow("transport");
    } finally {
      jest.useRealTimers();
    }
  });

  test("dispose clears timers so a later tick does not keep walking", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup();
      sent.length = 0;
      runtime.move("forward", 5000);
      runtime.dispose();
      const after = sent.length;
      advance(5000);
      expect(sent.length).toBe(after);
    } finally {
      jest.useRealTimers();
    }
  });

  test("heartbeat uses the time-sync clock while moving", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup();
      sent.length = 0;
      runtime.move("forward", 2000);
      advance(500);
      expect(sent.some((p) => p.opcode === GameOpcode.MSG_MOVE_HEARTBEAT)).toBe(
        true,
      );
      runtime.halt();
    } finally {
      jest.useRealTimers();
    }
  });

  test("force run speed ack skips the extra byte and stores speed", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent } = setup();
      const w = new PacketWriter();
      w.packedGuid(0x0764, 0);
      w.uint32LE(8);
      w.uint8(0);
      w.floatLE(8.5);
      sent.length = 0;
      runtime.handleForceSpeed(
        new PacketReader(w.finish()),
        GameOpcode.SMSG_FORCE_RUN_SPEED_CHANGE,
      );
      expect(sent[0]!.opcode).toBe(GameOpcode.CMSG_FORCE_RUN_SPEED_CHANGE_ACK);
      expect(runtime.snapshot().speed).toBeCloseTo(8.5, 4);
    } finally {
      jest.useRealTimers();
    }
  });

  test("knockback ack keeps FALLING trajectory in server order", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup();
      runtime.move("forward", 2000);
      sent.length = 0;
      const w = new PacketWriter();
      w.packedGuid(0x0764, 0);
      w.uint32LE(11);
      w.floatLE(0.5);
      w.floatLE(0.866);
      w.floatLE(12);
      w.floatLE(-20);
      runtime.handleKnockBack(new PacketReader(w.finish()));
      expect(sent[0]!.opcode).toBe(GameOpcode.CMSG_MOVE_KNOCK_BACK_ACK);
      const ack = new PacketReader(sent[0]!.body);
      ack.packedGuid();
      expect(ack.uint32LE()).toBe(11);
      const info = parseMovementInfo(ack);
      expect(info.flags & MovementFlag.FALLING).toBe(MovementFlag.FALLING);
      expect(info.fall?.zSpeed).toBeCloseTo(-20, 4);
      expect(info.fall?.sinAngle).toBeCloseTo(0.866, 4);
      expect(info.fall?.cosAngle).toBeCloseTo(0.5, 4);
      expect(info.fall?.xySpeed).toBe(12);
      expect(runtime.snapshot().blockedReason).toBe("falling");
      expect(() => runtime.move("forward", 500)).toThrow("falling");
      const after = sent.length;
      advance(500);
      expect(sent.length).toBe(after);
    } finally {
      jest.useRealTimers();
    }
  });

  test("observed transport root and pose cancel timers and block renewal", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup();
      runtime.move("forward", 5000);
      runtime.observeSelf({
        movementFlags: MovementFlag.ON_TRANSPORT,
        runSpeed: 7,
      });
      expect(runtime.snapshot().moving).toBe(false);
      expect(() => runtime.move("forward", 500)).toThrow("transport");
      sent.length = 0;
      advance(500);
      expect(sent.some((p) => p.opcode === GameOpcode.MSG_MOVE_HEARTBEAT)).toBe(
        false,
      );

      const rooted = setup();
      rooted.runtime.move("forward", 5000);
      rooted.runtime.observeSelf({
        movementFlags: MovementFlag.ROOT,
        runSpeed: 7,
      });
      expect(rooted.runtime.snapshot().moving).toBe(false);
      expect(() => rooted.runtime.move("forward", 500)).toThrow("rooted");
      rooted.runtime.observeSelf({ movementFlags: 0, runSpeed: 7 });
      rooted.runtime.move("forward", 500);
      expect(rooted.runtime.snapshot().moving).toBe(true);

      const corrected = setup();
      corrected.runtime.move("forward", 5000);
      corrected.advance(200);
      corrected.runtime.observeSelf({
        position: {
          mapId: 530,
          x: 100,
          y: 200,
          z: 50,
          orientation: 0.5,
        },
        runSpeed: 7,
      });
      expect(corrected.runtime.snapshot().moving).toBe(false);
      expect(corrected.runtime.snapshot().pose?.source).toBe("server");
      expect(corrected.runtime.snapshot().pose?.x).toBe(100);
      corrected.sent.length = 0;
      corrected.advance(500);
      expect(
        corrected.sent.some((p) => p.opcode === GameOpcode.MSG_MOVE_HEARTBEAT),
      ).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test("FACE and MOVE refuse unsupported teleport and control loss", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent } = setup();
      const deny = new PacketWriter();
      deny.packedGuid(0x0764, 0);
      deny.uint8(0);
      runtime.handleClientControl(new PacketReader(deny.finish()));
      sent.length = 0;
      expect(() => runtime.face(1)).toThrow("no_control");
      expect(
        sent.some((p) => p.opcode === GameOpcode.MSG_MOVE_SET_FACING),
      ).toBe(false);

      const tele = setup();
      const dest = new PacketWriter();
      dest.packedGuid(0x0764, 0);
      dest.uint32LE(2);
      dest.uint32LE(MovementFlag.ON_TRANSPORT);
      dest.uint16LE(0);
      dest.uint32LE(1);
      dest.floatLE(10);
      dest.floatLE(20);
      dest.floatLE(30);
      dest.floatLE(0);
      dest.packedGuid(0x99, 0);
      dest.floatLE(0);
      dest.floatLE(0);
      dest.floatLE(0);
      dest.floatLE(0);
      dest.uint32LE(0);
      dest.uint8(0);
      dest.uint32LE(0);
      tele.runtime.handleTeleportAck(new PacketReader(dest.finish()));
      tele.sent.length = 0;
      expect(() => tele.runtime.move("forward", 500)).toThrow("transport");
      expect(() => tele.runtime.face(0.2)).toThrow("transport");
      expect(
        tele.sent.some((p) => p.opcode === GameOpcode.MSG_MOVE_START_FORWARD),
      ).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test("SET_CAN_FLY acks and blocks until unset", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent } = setup();
      runtime.move("forward", 2000);
      sent.length = 0;
      const fly = new PacketWriter();
      fly.packedGuid(0x0764, 0);
      fly.uint32LE(4);
      runtime.handleCanFly(new PacketReader(fly.finish()), true);
      expect(sent[0]!.opcode).toBe(GameOpcode.CMSG_MOVE_SET_CAN_FLY_ACK);
      const ack = new PacketReader(sent[0]!.body);
      ack.packedGuid();
      expect(ack.uint32LE()).toBe(4);
      const flyInfo = parseMovementInfo(ack);
      expect(flyInfo.flags & MovementFlag.CAN_FLY).toBe(MovementFlag.CAN_FLY);
      expect(ack.uint32LE()).toBe(1);
      expect(runtime.snapshot().moving).toBe(false);
      expect(() => runtime.move("forward", 500)).toThrow("flying");
      const land = new PacketWriter();
      land.packedGuid(0x0764, 0);
      land.uint32LE(5);
      sent.length = 0;
      runtime.handleCanFly(new PacketReader(land.finish()), false);
      const landAck = new PacketReader(sent[0]!.body);
      landAck.packedGuid();
      landAck.uint32LE();
      const landInfo = parseMovementInfo(landAck);
      expect(landInfo.flags & MovementFlag.CAN_FLY).toBe(0);
      expect(landAck.uint32LE()).toBe(0);
      runtime.move("forward", 500);
      expect(runtime.snapshot().moving).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("speed change integrates elapsed movement at the old speed", () => {
    jest.useFakeTimers();
    try {
      const { runtime, advance } = setup();
      runtime.move("forward", 2000);
      advance(250);
      const speed = new PacketWriter();
      speed.packedGuid(0x0764, 0);
      speed.uint32LE(1);
      speed.uint8(0);
      speed.floatLE(3.5);
      runtime.handleForceSpeed(
        new PacketReader(speed.finish()),
        GameOpcode.SMSG_FORCE_RUN_SPEED_CHANGE,
      );
      advance(250);
      const pose = runtime.snapshot().pose!;
      const expected = 8709.46 + Math.cos(0.5) * (7 * 0.25 + 3.5 * 0.25);
      expect(pose.x).toBeCloseTo(expected, 5);
    } finally {
      jest.useRealTimers();
    }
  });

  test("transport teleport ACKs include the transport block", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent } = setup();
      const dest = new PacketWriter();
      dest.packedGuid(0x0764, 0);
      dest.uint32LE(2);
      dest.uint32LE(MovementFlag.ON_TRANSPORT);
      dest.uint16LE(0);
      dest.uint32LE(1);
      dest.floatLE(10);
      dest.floatLE(20);
      dest.floatLE(30);
      dest.floatLE(0);
      dest.packedGuid(0x99, 0);
      dest.floatLE(1);
      dest.floatLE(2);
      dest.floatLE(3);
      dest.floatLE(0.25);
      dest.uint32LE(44);
      dest.uint8(1);
      dest.uint32LE(0);
      runtime.handleTeleportAck(new PacketReader(dest.finish()));
      sent.length = 0;
      runtime.forceRoot(9);
      const rootAck = new PacketReader(sent[0]!.body);
      rootAck.packedGuid();
      expect(rootAck.uint32LE()).toBe(9);
      const rooted = parseMovementInfo(rootAck);
      expect(rooted.flags & MovementFlag.ON_TRANSPORT).toBe(
        MovementFlag.ON_TRANSPORT,
      );
      expect(rooted.transport?.guid).toBe(0x99n);
      expect(rooted.transport?.seat).toBe(1);
      expect(rootAck.remaining).toBe(0);
      sent.length = 0;
      const speed = new PacketWriter();
      speed.packedGuid(0x0764, 0);
      speed.uint32LE(3);
      speed.uint8(0);
      speed.floatLE(7);
      runtime.handleForceSpeed(
        new PacketReader(speed.finish()),
        GameOpcode.SMSG_FORCE_RUN_SPEED_CHANGE,
      );
      const speedAck = new PacketReader(sent[0]!.body);
      speedAck.packedGuid();
      expect(speedAck.uint32LE()).toBe(3);
      const moving = parseMovementInfo(speedAck);
      expect(moving.transport?.guid).toBe(0x99n);
      expect(speedAck.floatLE()).toBe(7);
      expect(speedAck.remaining).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

test("ground-route movement samples mesh height and HALT prevents lease renewal", () => {
  jest.useFakeTimers();
  try {
    const { runtime, advance, sent } = setup();
    const start = runtime.snapshot().pose!;
    const destination = { x: start.x + 21, y: start.y, z: start.z + 3 };
    const height = (x: number): number =>
      start.z +
      Math.min(2, ((x - start.x) * 2) / 7) +
      Math.max(0, x - start.x - 7) / 14;
    const ground: NativeMap = {
      loadAdtAt() {},
      findHeights: (x) => [height(x)],
      findHeight: (_from, x) => height(x),
      lineOfSight: () => true,
      findPath: () => [],
      close() {},
    };
    const route = new GroundRoute(
      [
        { x: start.x, y: start.y, z: start.z },
        { x: start.x + 7, y: start.y, z: start.z + 2 },
        destination,
      ],
      ground,
    );
    runtime.navigate(route, destination);
    advance(1000);
    expect(runtime.snapshot().pose?.z).toBeCloseTo(start.z + 2);
    expect(runtime.snapshot().serverPose?.z).toBe(start.z);
    runtime.halt();
    const stopped = runtime.snapshot().pose;
    const count = sent.length;
    advance(10000);
    expect(runtime.snapshot().pose).toEqual(stopped);
    expect(runtime.navigationState().active).toBe(false);
    expect(sent.length).toBe(count);
  } finally {
    jest.useRealTimers();
  }
});

test("tactical authority survives stationary waits but root stops navigation", () => {
  jest.useFakeTimers();
  try {
    const { runtime } = setup();
    runtime.setMode("jev");
    expect(runtime.snapshot().owner).toBe("jev");
    const start = runtime.snapshot().pose!;
    const destination = { x: start.x + 20, y: start.y, z: start.z };
    const ground: NativeMap = {
      loadAdtAt() {},
      findHeights: () => [start.z],
      findHeight: () => start.z,
      lineOfSight: () => true,
      findPath: () => [],
      close() {},
    };
    runtime.navigate(
      new GroundRoute([start, destination], ground),
      destination,
    );
    runtime.forceRoot(1);
    expect(runtime.navigationState().active).toBe(false);
    expect(runtime.navigationState().blockedReason).toBe("root");
    runtime.setMode("none");
    expect(runtime.snapshot().owner).toBe("none");
  } finally {
    jest.useRealTimers();
  }
});

test("an old-origin route cannot reset a moving predicted pose", () => {
  jest.useFakeTimers();
  try {
    const { runtime, advance } = setup();
    const start = runtime.snapshot().pose!;
    const destination = { x: start.x + 20, y: start.y, z: start.z };
    const ground: NativeMap = {
      loadAdtAt() {},
      findHeights: () => [start.z],
      findHeight: () => start.z,
      lineOfSight: () => true,
      findPath: () => [],
      close() {},
    };
    const route = new GroundRoute([start, destination], ground);
    runtime.navigate(route, destination);
    advance(300);
    const moving = runtime.snapshot().pose!;
    expect(() => runtime.navigate(route, destination)).toThrow(/origin/);
    expect(runtime.snapshot().pose!.x).toBeCloseTo(moving.x);
    expect(runtime.snapshot().moving).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test("free movement integrates real ground height from findHeight query", () => {
  jest.useFakeTimers();
  try {
    const { runtime, advance } = setup({
      findHeight: (_mapId, _x, _y, from) => (from ? from.z - 2 : 68.34),
    });
    runtime.move("forward", 1000);
    advance(500);
    expect(runtime.snapshot().pose?.z).toBeCloseTo(68.34);
    advance(500);
    expect(runtime.snapshot().pose?.z).toBeCloseTo(66.34);
  } finally {
    jest.useRealTimers();
  }
});

test("free movement aborts and stops when ground height is unavailable", () => {
  jest.useFakeTimers();
  try {
    const { runtime, sent, events, advance } = setup({
      findHeight: () => undefined,
    });
    sent.length = 0;
    runtime.move("forward", 1000);
    expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_START_FORWARD);
    advance(500);
    expect(runtime.snapshot().moving).toBe(false);
    expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_STOP);
    expect(
      events.some(
        (e) =>
          e.type === "control_error" &&
          e.reason === "ground_height_unavailable",
      ),
    ).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test("free movement stops with obstructed when an obstacle blocks forward path but ground is valid", () => {
  jest.useFakeTimers();
  try {
    const { runtime, sent, events, advance } = setup({
      findHeight: (_mapId, x, _y, from) => {
        if (Math.abs(x - 8709.46) < 0.1) return from?.z ?? 70.34;
        return undefined;
      },
    });
    sent.length = 0;
    runtime.move("forward", 1000);
    expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_START_FORWARD);
    advance(500);
    expect(runtime.snapshot().moving).toBe(false);
    expect(runtime.snapshot().movementAllowed).toBe(true);
    expect(runtime.snapshot().blockedReason).toBe("obstructed");
    expect(runtime.snapshot().pose?.x).toBeCloseTo(8709.46);
    expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_STOP);
    expect(
      events.some(
        (e) => e.type === "movement_stopped" && e.reason === "obstructed",
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === "control_error")).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test("free movement stops with height_unresolved when the path ahead is clear but ambiguous", () => {
  jest.useFakeTimers();
  try {
    const { runtime, sent, events, advance } = setup({
      findHeight: (_mapId, x, _y, from) => {
        if (Math.abs(x - 8709.46) < 0.1) return from?.z ?? 70.34;
        return undefined;
      },
      isPathClear: () => true,
    });
    sent.length = 0;
    runtime.move("forward", 1000);
    advance(500);
    expect(runtime.snapshot().moving).toBe(false);
    expect(runtime.snapshot().blockedReason).toBe("height_unresolved");
    expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_STOP);
    expect(
      events.some(
        (e) =>
          e.type === "movement_stopped" && e.reason === "height_unresolved",
      ),
    ).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test("free movement stops with obstructed when the path ahead is not clear", () => {
  jest.useFakeTimers();
  try {
    const { runtime, sent, events, advance } = setup({
      findHeight: (_mapId, x, _y, from) => {
        if (Math.abs(x - 8709.46) < 0.1) return from?.z ?? 70.34;
        return undefined;
      },
      isPathClear: () => false,
    });
    sent.length = 0;
    runtime.move("forward", 1000);
    advance(500);
    expect(runtime.snapshot().moving).toBe(false);
    expect(runtime.snapshot().blockedReason).toBe("obstructed");
    expect(
      events.some(
        (e) => e.type === "movement_stopped" && e.reason === "obstructed",
      ),
    ).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test("movement away from an obstruction clears blockedReason and succeeds", () => {
  jest.useFakeTimers();
  try {
    const { runtime, sent, events, advance } = setup({
      findHeight: (_mapId, x, _y, from) => {
        if (x <= 8709.46) return from?.z ?? 70.34;
        return undefined;
      },
    });
    runtime.move("forward", 1000);
    advance(500);
    expect(runtime.snapshot().blockedReason).toBe("obstructed");
    expect(runtime.snapshot().pose?.x).toBeCloseTo(8709.46);

    sent.length = 0;
    events.length = 0;
    runtime.move("backward", 1000);
    expect(runtime.snapshot().blockedReason).toBeUndefined();
    expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_START_BACKWARD);
    advance(500);
    expect(runtime.snapshot().pose?.x).toBeLessThan(8709.46);
    advance(500);
    expect(runtime.snapshot().moving).toBe(false);
    expect(runtime.snapshot().blockedReason).toBeUndefined();
    expect(events.some((e) => e.type === "control_error")).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test("consecutive moves into an obstruction remain non-fatal and leave pose unchanged", () => {
  jest.useFakeTimers();
  try {
    const { runtime, events, advance } = setup({
      findHeight: (_mapId, x, _y, from) => {
        if (Math.abs(x - 8709.46) < 0.1) return from?.z ?? 70.34;
        return undefined;
      },
    });
    for (let i = 0; i < 20; i++) {
      runtime.move("forward", 1000);
      advance(500);
      expect(runtime.snapshot().moving).toBe(false);
      expect(runtime.snapshot().blockedReason).toBe("obstructed");
      expect(runtime.snapshot().pose?.x).toBeCloseTo(8709.46);
    }
    expect(events.some((e) => e.type === "control_error")).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test("explicit halt clears stale obstruction while obstruction halt preserves it", () => {
  jest.useFakeTimers();
  try {
    const { runtime, advance } = setup({
      findHeight: (_mapId, x, _y, from) => {
        if (Math.abs(x - 8709.46) < 0.1) return from?.z ?? 70.34;
        return undefined;
      },
    });
    runtime.move("forward", 1000);
    advance(500);
    expect(runtime.snapshot().moving).toBe(false);
    expect(runtime.snapshot().blockedReason).toBe("obstructed");
    runtime.halt();
    expect(runtime.snapshot().moving).toBe(false);
    expect(runtime.snapshot().blockedReason).toBeUndefined();
    runtime.move("forward", 1000);
    advance(500);
    expect(runtime.snapshot().moving).toBe(false);
    expect(runtime.snapshot().blockedReason).toBe("obstructed");
  } finally {
    jest.useRealTimers();
  }
});

test("classifyNavigationRefusal distinguishes wait, pick_destination, and stop", () => {
  expect(
    classifyNavigationRefusal("position disagrees with ground height"),
  ).toBe("wait");
  expect(classifyNavigationRefusal("ambiguous ground column")).toBe(
    "pick_destination",
  );
  expect(
    classifyNavigationRefusal("pathfind_find_height failed (UNKNOWN_HEIGHT)"),
  ).toBe("stop");
  expect(classifyNavigationRefusal("ground height unavailable")).toBe("stop");
  expect(classifyNavigationRefusal("ground corridor collision")).toBe("stop");
});

test("navigationError stores refusal and navigate clears refusal", () => {
  const { runtime } = setup();
  const dest = { x: 8730, y: -6600, z: 70 };
  runtime.navigationError(dest, "position disagrees with ground height");
  expect(runtime.navigationState()).toEqual({
    active: false,
    destination: dest,
    remaining: undefined,
    owner: "none",
    blockedReason: "position disagrees with ground height",
    refusal: "wait",
  });

  runtime.navigationError(dest, "ambiguous ground column");
  expect(runtime.navigationState().refusal).toBe("pick_destination");

  runtime.navigationError(dest, "pathfind_find_height failed (UNKNOWN_HEIGHT)");
  expect(runtime.navigationState().refusal).toBe("stop");

  const start = runtime.snapshot().pose!;
  const destMatching = { ...dest, z: start.z };
  const ground: NativeMap = {
    loadAdtAt() {},
    findHeights: () => [start.z],
    findHeight: () => start.z,
    lineOfSight: () => true,
    findPath: () => [],
    close() {},
  };
  runtime.navigate(
    new GroundRoute([start, destMatching], ground),
    destMatching,
  );
  expect(runtime.navigationState().refusal).toBeUndefined();
  expect(runtime.navigationState().blockedReason).toBeUndefined();
});

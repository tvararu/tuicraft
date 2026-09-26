import { describe, expect, jest, test } from "bun:test";
import { info, LOGIN, lastMove, setup } from "#test-support/control-fixtures";
import { must } from "#test-support/must";
import { ControlRuntime } from "#wow/control";
import { MovementFlag } from "#wow/protocol/entity-fields";
import { GameOpcode } from "#wow/protocol/opcodes";
import { PacketReader } from "#wow/protocol/packet";

describe("ControlRuntime", () => {
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
        findHeight: () => undefined,
        isPathClear: () => false,
      });
      noSpeed.loginVerified(LOGIN);
      expect(() => noSpeed.move("forward", 1000)).toThrow("missing_speed");
      expect(() => runtime.move("forward", 0)).toThrow("invalid_duration");
      expect(() => runtime.move("forward", 10_001)).toThrow("invalid_duration");
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
      expect(must(sent[0]).opcode).toBe(GameOpcode.CMSG_SET_SELECTION);
      const guid = new PacketReader(must(sent[0]).body).uint64LE();
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
      runtime.teleportAck({
        guid: 0x0764n,
        counter: 4,
        info: info({ x: 100, y: 200, z: 50 }),
      });
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
      runtime.nearTeleport({
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
      runtime.clientControl({ guid: 0x0764n, allow: false });
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
});

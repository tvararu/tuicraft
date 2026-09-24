import { describe, expect, jest, test } from "bun:test";
import type { CombatUnit } from "wow/combat";
import { ControlRuntime, type ControlEvent } from "wow/control";
import { FollowRuntime, type FollowEvent } from "wow/follow";
import { createNavigation, type NavPoint } from "wow/navigation";
import type { NativeMap } from "wow/navigation-native";
import { GameOpcode } from "wow/protocol/opcodes";

function setup(over: Partial<NativeMap> = {}) {
  let now = 10_000;
  const packets: number[] = [];
  const starts: NavPoint[] = [];
  const controls: ControlEvent[] = [];
  const events: FollowEvent[] = [];
  const control = new ControlRuntime({
    send: (opcode) => {
      packets.push(opcode);
    },
    ticks: () => now,
    now: () => now,
    selfGuid: () => 1n,
    findHeight: () => 0,
  });
  control.observeSelf({
    position: { mapId: 530, x: 0, y: 0, z: 0, orientation: 0 },
    runSpeed: 7,
    runBackSpeed: 4.5,
  });
  let target: CombatUnit | undefined = {
    guid: 2n,
    name: "target",
    health: 10,
    maxHealth: 10,
    power: undefined,
    maxPower: undefined,
    powerType: undefined,
    baseMana: undefined,
    level: 1,
    pose: {
      mapId: 530,
      x: 20,
      y: 0,
      z: 0,
      orientation: 0,
      source: "server",
      updatedAt: now,
    },
    serverPose: undefined,
    motion: { kind: "stationary", observedAt: now },
  };
  const map: NativeMap = {
    loadAdtAt() {},
    findHeights: () => [0],
    findHeight: () => 0,
    lineOfSight: () => true,
    findPath: (from, to) => {
      starts.push({ ...from });
      return [from, to];
    },
    close() {},
    ...over,
  };
  const navigation = createNavigation(
    { dataPath: "fixture", libraryPath: "fixture" },
    () => map,
  );
  const follow = new FollowRuntime({
    control,
    navigation: () => navigation,
    target: () => target,
    now: () => now,
  });
  control.onEvent((event) => {
    controls.push(event);
    follow.observeControl(event);
  });
  follow.onEvent((event) => {
    events.push(event);
  });
  return {
    control,
    follow,
    packets,
    starts,
    controls,
    events,
    lose: () => {
      target = undefined;
    },
    target: () => target!,
    advance: (ms: number) => {
      for (let step = 0; step < ms; step += 100) {
        now += 100;
        jest.advanceTimersByTime(100);
      }
    },
    dispose: () => {
      follow.dispose();
      control.dispose();
      navigation.close();
    },
  };
}

describe("bounded grounded follow", () => {
  test("loss stops motion and cannot retry when time advances", () => {
    jest.useFakeTimers();
    const f = setup();
    try {
      f.follow.start(2n);
      f.lose();
      f.advance(100);
      expect(f.follow.snapshot()).toMatchObject({
        active: false,
        reason: "target_lost",
      });
      expect(f.control.snapshot().moving).toBe(false);
      const count = f.packets.length;
      f.advance(10_000);
      expect(f.packets.length).toBe(count);
    } finally {
      f.dispose();
      jest.useRealTimers();
    }
  });

  test("matching target invalidation stops before recovered observations can resume it", () => {
    jest.useFakeTimers();
    const f = setup();
    try {
      f.follow.start(2n);
      f.follow.invalidateTarget(3n, "target_replaced");
      expect(f.follow.snapshot()).toMatchObject({ active: true, guid: 2n });
      f.target().motion!.unsupportedReason = "transport";
      f.follow.invalidateTarget(2n, "transport");
      delete f.target().motion!.unsupportedReason;
      expect(f.follow.snapshot()).toMatchObject({
        active: false,
        reason: "transport",
      });
      expect(f.control.snapshot().moving).toBe(false);
      const sent = f.packets.length;
      f.advance(1_000);
      expect(f.packets.length).toBe(sent);
      f.target().guid = 3n;
      f.follow.start(3n);
      f.follow.invalidateTarget(2n, "target_lost");
      expect(f.follow.snapshot()).toMatchObject({ active: true, guid: 3n });
      expect(f.control.snapshot()).toMatchObject({
        moving: true,
        owner: "follow",
      });
    } finally {
      f.dispose();
      jest.useRealTimers();
    }
  });

  test("unsupported motion terminates even with a recent predicted position", () => {
    jest.useFakeTimers();
    const f = setup();
    try {
      f.follow.start(2n);
      f.target().motion!.unsupportedReason = "transport";
      f.advance(100);
      expect(f.follow.snapshot()).toMatchObject({
        active: false,
        reason: "transport",
      });
      expect(f.control.snapshot().owner).toBe("none");
    } finally {
      f.dispose();
      jest.useRealTimers();
    }
  });

  test("missing observation and stale receive time do not become fresh when sampled", () => {
    jest.useFakeTimers();
    const f = setup();
    try {
      f.target().motion = undefined;
      expect(() => f.follow.start(2n)).toThrow(/motion/);
      f.target().motion = { kind: "spline", observedAt: 10_000 };
      f.follow.start(2n);
      f.advance(5_100);
      expect(f.follow.snapshot()).toMatchObject({
        active: false,
        reason: "target_stale",
      });
    } finally {
      f.dispose();
      jest.useRealTimers();
    }
  });

  test("server correction invalidates follow rather than resuming the old route", () => {
    jest.useFakeTimers();
    const f = setup();
    try {
      f.follow.start(2n);
      f.advance(300);
      f.control.observeSelf({
        position: { mapId: 530, x: 1, y: 0, z: 0, orientation: 0 },
      });
      expect(f.follow.snapshot().active).toBe(false);
      const count = f.packets.length;
      f.advance(2_000);
      expect(f.packets.length).toBe(count);
      expect(f.control.snapshot().pose?.source).toBe("server");
    } finally {
      f.dispose();
      jest.useRealTimers();
    }
  });

  test("manual movement takes ownership and stale follow disposal cannot halt it", () => {
    jest.useFakeTimers();
    const f = setup();
    try {
      f.follow.start(2n);
      f.control.move("backward", 1000);
      expect(f.follow.snapshot().active).toBe(false);
      expect(f.control.snapshot()).toMatchObject({
        owner: "manual",
        moving: true,
        direction: "backward",
      });
      f.follow.dispose();
      expect(f.control.snapshot().moving).toBe(true);
    } finally {
      f.dispose();
      jest.useRealTimers();
    }
  });

  test("ambiguous target ground is terminal before movement starts", () => {
    jest.useFakeTimers();
    const f = setup({ findHeights: (x) => (x === 20 ? [0, 8] : [0]) });
    try {
      expect(() => f.follow.start(2n)).toThrow(/ambiguous/);
      expect(f.follow.snapshot().active).toBe(false);
      expect(f.packets).not.toContain(GameOpcode.MSG_MOVE_START_FORWARD);
    } finally {
      f.dispose();
      jest.useRealTimers();
    }
  });

  test("nearby XY on another floor is not an in-range success", () => {
    jest.useFakeTimers();
    const f = setup();
    try {
      f.target().pose!.x = 1;
      f.target().pose!.z = 10;
      expect(() => f.follow.start(2n)).toThrow(/ground/);
      expect(f.follow.snapshot().status).not.toBe("holding");
    } finally {
      f.dispose();
      jest.useRealTimers();
    }
  });

  test("moving replan stops and integrates before capturing the new origin", () => {
    jest.useFakeTimers();
    const f = setup();
    try {
      f.follow.start(2n);
      f.advance(500);
      f.target().pose!.x = 25;
      f.advance(100);
      expect(f.follow.snapshot().plans).toBe(2);
      expect(f.starts[2]!.x).toBeCloseTo(4.2);
      expect(f.control.snapshot().pose!.x).toBeCloseTo(4.2);
      expect(f.control.snapshot().owner).toBe("follow");
      expect(f.control.navigationState().owner).toBe("follow");
      const count = f.starts.length;
      f.target().pose!.x += 0.1;
      f.advance(500);
      expect(f.starts.length).toBe(count);
    } finally {
      f.dispose();
      jest.useRealTimers();
    }
  });

  test("a failed moving replan sends no new start and does not retry", () => {
    jest.useFakeTimers();
    let blocked = false;
    const f = setup({
      findPath: (from, to) => {
        if (blocked) throw new Error("UNKNOWN_PATH");
        return [from, to];
      },
    });
    try {
      f.follow.start(2n);
      f.advance(500);
      blocked = true;
      f.target().pose!.x = 25;
      f.advance(100);
      expect(f.follow.snapshot()).toMatchObject({
        active: false,
        reason: "UNKNOWN_PATH",
      });
      expect(f.control.snapshot().moving).toBe(false);
      const count = f.packets.length;
      blocked = false;
      f.advance(2_000);
      expect(f.packets.length).toBe(count);
    } finally {
      f.dispose();
      jest.useRealTimers();
    }
  });
});

test("holding keeps follow ownership and resumes only after meaningful movement", () => {
  jest.useFakeTimers();
  const f = setup();
  try {
    f.target().pose!.x = 2;
    f.follow.start(2n);
    expect(f.follow.snapshot().status).toBe("holding");
    expect(f.control.snapshot()).toMatchObject({
      owner: "follow",
      moving: false,
    });
    f.advance(500);
    f.target().pose!.x = 10;
    f.advance(100);
    expect(f.follow.snapshot().status).toBe("following");
    expect(f.control.snapshot()).toMatchObject({
      owner: "follow",
      moving: true,
    });
    f.control.face(Math.PI);
    expect(f.follow.snapshot().active).toBe(false);
    expect(f.control.snapshot().moving).toBe(false);
  } finally {
    f.dispose();
    jest.useRealTimers();
  }
});

test("root while holding is terminal and unroot cannot resume follow", () => {
  jest.useFakeTimers();
  const f = setup();
  try {
    f.target().pose!.x = 2;
    f.follow.start(2n);
    f.control.forceRoot(1);
    expect(f.follow.snapshot().active).toBe(false);
    f.control.forceUnroot(2);
    f.target().pose!.x = 20;
    f.advance(1000);
    expect(f.control.snapshot().moving).toBe(false);
  } finally {
    f.dispose();
    jest.useRealTimers();
  }
});

test("new Jev owner survives old follow stop and disposal", () => {
  jest.useFakeTimers();
  const f = setup();
  try {
    f.follow.start(2n);
    f.advance(100);
    f.control.setMode("jev");
    expect(f.follow.snapshot().active).toBe(false);
    expect(f.control.snapshot().owner).toBe("jev");
    f.follow.stop("late");
    f.follow.dispose();
    expect(f.control.snapshot().owner).toBe("jev");
  } finally {
    f.dispose();
    jest.useRealTimers();
  }
});

test("follow can take over manual motion without treating its own stop as interruption", () => {
  jest.useFakeTimers();
  const f = setup();
  try {
    f.control.move("forward", 1000);
    f.advance(200);
    f.follow.start(2n);
    expect(f.follow.snapshot().active).toBe(true);
    expect(f.starts[0]!.x).toBeCloseTo(1.4);
    expect(f.control.snapshot().owner).toBe("follow");
  } finally {
    f.dispose();
    jest.useRealTimers();
  }
});

test("fresh observations cannot extend the absolute follow deadline", () => {
  jest.useFakeTimers();
  const f = setup();
  try {
    f.target().pose!.x = 2;
    f.follow.start(2n);
    for (let step = 1; step <= 30; step++) {
      f.target().motion!.observedAt = 10_000 + (step - 1) * 1000;
      f.advance(1000);
    }
    expect(f.follow.snapshot()).toMatchObject({
      active: false,
      reason: "follow_deadline",
    });
    expect(f.control.snapshot().owner).toBe("none");
  } finally {
    f.dispose();
    jest.useRealTimers();
  }
});

test("both destination queries consume the bounded replan budget", () => {
  jest.useFakeTimers();
  const f = setup();
  try {
    f.follow.start(2n);
    for (let step = 1; step <= 16; step++) {
      f.target().pose!.x = step % 2 === 0 ? 20 : 30;
      f.target().pose!.y = step % 2 === 0 ? 30 : -30;
      f.target().motion!.observedAt = 10_000 + (step - 1) * 500;
      f.advance(500);
    }
    expect(f.follow.snapshot()).toMatchObject({
      active: false,
      attempts: 32,
      reason: "follow_plan_budget",
    });
    expect(f.control.snapshot().moving).toBe(false);
  } finally {
    f.dispose();
    jest.useRealTimers();
  }
});

test("control correction during an internally generated plan event is not suppressed", () => {
  jest.useFakeTimers();
  const f = setup();
  try {
    f.follow.onEvent((event) => {
      if (event.type !== "planned") return;
      f.control.observeSelf({
        position: { mapId: 530, x: 1, y: 0, z: 0, orientation: 0 },
      });
    });
    f.follow.start(2n);
    expect(f.follow.snapshot().active).toBe(false);
    expect(f.control.snapshot().moving).toBe(false);
    const count = f.packets.length;
    f.advance(1000);
    expect(f.packets.length).toBe(count);
  } finally {
    f.dispose();
    jest.useRealTimers();
  }
});

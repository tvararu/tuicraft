import { describe, expect, jest, test } from "bun:test";
import { dispatchCommand, type EventEntry } from "daemon/commands";
import { onDomainEvent } from "daemon/events";
import { parseIpcCommand } from "daemon/parse";
import { RingBuffer } from "lib/ring-buffer";
import type { SessionLog } from "lib/session-log";
import { attachControl, createMockSocket } from "test/commands-fixtures";
import { createMockHandle } from "test/mock-handle";
import { must } from "test/must";
import type { CycleState } from "wow";

describe("recovery IPC boundary", () => {
  test("requires exact recovery action syntax", () => {
    expect(parseIpcCommand("RECOVERY_JSON")).toEqual({ type: "recovery_json" });
    expect(parseIpcCommand("QUERY_CORPSE")).toEqual({ type: "query_corpse" });
    expect(parseIpcCommand("SPIRIT_HEALER 0xa")).toEqual({
      guid: 10n,
      type: "spirit_healer",
    });
    expect(parseIpcCommand("RESURRECT accept")).toEqual({
      accept: true,
      type: "resurrect",
    });
    expect(parseIpcCommand("RESURRECT decline")).toEqual({
      accept: false,
      type: "resurrect",
    });
    for (const line of [
      "QUERY_CORPSE 1",
      "RELEASE_SPIRIT now",
      "RECLAIM_CORPSE 0",
      "SPIRIT_HEALER",
      "SPIRIT_HEALER 0",
      "SPIRIT_HEALER 0xa extra",
      "RESURRECT",
      "RESURRECT yes",
      "RESURRECT accept extra",
    ])
      expect(parseIpcCommand(line)?.type).toBe("invalid");
  });

  test("a recovery request acknowledgement does not claim a life transition", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      releaseSpirit: () => ({
        life: "dead",
        request: { action: "release", status: "unanswered" },
      }),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "release_spirit" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    expect(socket.written()).toBe("OK\n\n");
  });

  test("reclaim refusal is ERR without success", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      reclaimCorpse: () => {
        throw new Error("Cannot request reclaim: wrong_map");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "reclaim_corpse" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    expect(socket.written()).toBe("ERR Cannot request reclaim: wrong_map\n\n");
  });

  test("spirit-healer guard refusal is ERR without success", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      activateSpiritHealer: () => {
        throw new Error("Observed creature is not a spirit healer");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { guid: 10n, type: "spirit_healer" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    expect(socket.written()).toBe(
      "ERR Observed creature is not a spirit healer\n\n",
    );
  });

  test("recovery JSON preserves unknown timing, pose provenance and distinct corpse maps", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      getRecoveryState: () => ({
        corpse: {
          corpseMapId: 540,
          mapId: 530,
          observedAt: 1000,
          position: { x: 1, y: 2, z: 3 },
          status: "found",
        },
        health: 1,
        life: "ghost",
        reclaim: {
          canRequest: false,
          pose: { source: "predicted", updatedAt: 1200 },
          readiness: "blocked",
          remainingMs: undefined,
        },
        request: { action: "reclaim", status: "unanswered", timing: "unknown" },
        selfGuid: 0xffff_ffff_ffff_ffffn,
      }),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "recovery_json" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    const state = JSON.parse(socket.written());
    expect(state.selfGuid).toBe("0xffffffffffffffff");
    expect(state.life).toBe("ghost");
    expect(state.corpse.mapId).toBe(530);
    expect(state.corpse.corpseMapId).toBe(540);
    expect(state.reclaim.pose.source).toBe("predicted");
    expect(state.reclaim).not.toHaveProperty("remainingMs");
    expect(state.request.timing).toBe("unknown");
    expect(state.request.status).toBe("unanswered");
  });

  test("recovery inspection failures are not empty healthy state", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      getRecoveryState: () => {
        throw new Error("session_closed");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "recovery" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    expect(socket.written()).toBe("ERR session_closed\n\n");
  });
});

describe("cycle IPC boundary", () => {
  test("cycle dispatch starts the queue with parsed guids, instruction and max starts", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      startCycle: jest.fn(async () => {}),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      {
        guids: [1n, 2n],
        instruction: "kill fast",
        maxStarts: 3,
        type: "cycle",
      },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    expect(handle.startCycle).toHaveBeenCalledWith([1n, 2n], "kill fast", 3);
    expect(socket.written()).toBe("OK\n\n");
  });

  test("cycle start rejection is ERR without an OK", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      startCycle: jest.fn(async () => {
        throw new Error("self_not_alive");
      }),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { guids: [1n], instruction: "fight", maxStarts: 10, type: "cycle" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    expect(socket.written()).toBe("ERR self_not_alive\n\n");
  });

  test("cycling reports the same snapshot the runtime exposes", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      getCycleState: (): CycleState => ({
        active: true,
        currentIndex: 0,
        instruction: "fight",
        lastLoot: undefined,
        lastRecovery: undefined,
        maxStarts: 10,
        objective: undefined,
        phase: "fighting",
        queue: [{ guid: 1n, status: "queued" }],
        resumes: 0,
        startedAt: 1000,
        startsUsed: 1,
        stopCause: undefined,
        stopDetail: undefined,
      }),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "cycling_json" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    const state = JSON.parse(socket.written());
    expect(state.phase).toBe("fighting");
    expect(state.queue[0].guid).toBe("0x1");
    expect(state.startsUsed).toBe(1);
  });

  test("cycling inspection failure is ERR, not an empty phase", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      getCycleState: () => {
        throw new Error("session_closed");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "cycling" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    expect(socket.written()).toBe("ERR session_closed\n\n");
  });

  test("cycle events reach the ring buffer and session log", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    const state = createMockHandle().getCycleState();
    onDomainEvent(
      "cycle",
      { at: 1000, state, type: "started" },
      {
        events,
        log,
      },
    );
    const drained = events.drain();
    expect(must(drained[0]).text).toBe("[cycle] started");
    expect(JSON.parse(must(drained[0]).json).type).toBe("CYCLE");
  });
});

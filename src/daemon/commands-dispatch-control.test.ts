import { describe, expect, jest, test } from "bun:test";
import { dispatchCommand, type EventEntry } from "daemon/commands";
import { writeLines } from "daemon/event-wait";
import { RingBuffer } from "lib/ring-buffer";
import {
  attachControl,
  createMockSocket,
  sampleState,
} from "test/commands-fixtures";
import { createMockHandle } from "test/mock-handle";

describe("dispatchCommand", () => {
  test("move calls handle and writes OK", async () => {
    const handle = attachControl(createMockHandle());
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();
    const result = await dispatchCommand(
      { direction: "forward", durationMs: 1000, type: "move" },
      { cleanup, events, handle, socket },
    );
    expect(result).toBe(false);
    expect(handle.move).toHaveBeenCalledWith("forward", 1000);
    expect(socket.written()).toBe("OK\n\n");
    expect(cleanup).not.toHaveBeenCalled();
  });

  test("fight replies with the run outcome once it ends", async () => {
    const handle = createMockHandle();
    handle.getTacticsState = jest.fn(() => ({
      instruction: "hold",
      lastDecision: undefined,
      lastDiscardReason: undefined,
      lastOutcome: {
        observation: {
          lastXp: { kind: "kill", total: 60, victim: "0xa" },
        },
        reason: "server_kill_credit",
        status: "completed" as const,
      },
      lastRequest: undefined,
      lastResult: undefined,
      lastStopReason: "completed",
      runId: "run",
      status: "idle" as const,
      targetGuid: 0xan,
      timeouts: { consecutive: 0, limit: 3, total: 0 },
    }));
    const socket = createMockSocket();
    await dispatchCommand(
      { guid: 0xan, instruction: "hold", type: "fight" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    expect(handle.startTactics).toHaveBeenCalled();
    expect(socket.written()).toBe(
      "OK completed: server_kill_credit, XP 60\n\n",
    );
  });

  test("malformed move does not call handle", async () => {
    const handle = attachControl(createMockHandle());
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    await dispatchCommand(
      { reason: "invalid direction", type: "invalid" },
      { cleanup: jest.fn(), events, handle, socket },
    );
    expect(handle.move).not.toHaveBeenCalled();
    expect(handle.face).not.toHaveBeenCalled();
    expect(handle.selectTarget).not.toHaveBeenCalled();
    expect(handle.halt).not.toHaveBeenCalled();
    expect(socket.written().startsWith("ERR ")).toBe(true);
  });

  test("move runtime errors surface as ERR without success", async () => {
    const handle = attachControl(createMockHandle());
    handle.move.mockImplementation(() => {
      throw new Error("rooted");
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { direction: "forward", durationMs: 500, type: "move" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    expect(handle.move).toHaveBeenCalled();
    expect(socket.written()).toBe("ERR rooted\n\n");
  });

  test("control json uses hex guids and pose source", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(sampleState());
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "control_json" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    const parsed = JSON.parse(socket.written().trim());
    expect(parsed.selfGuid).toBe("0xabcde");
    expect(parsed.target).toBe("0xa");
    expect(parsed.requestedTarget).toBe("0xa");
    expect(parsed.pose.source).toBe("predicted");
    expect(parsed.serverPose.source).toBe("server");
    expect(parsed.moving).toBe(true);
    expect(parsed.direction).toBe("forward");
    expect(parsed.owner).toBe("manual");
  });

  test("control json reports obstructed blockedReason", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(
      sampleState({
        blockedReason: "obstructed",
        direction: undefined,
        moving: false,
      }),
    );
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "control_json" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    const parsed = JSON.parse(socket.written().trim());
    expect(parsed.moving).toBe(false);
    expect(parsed.blockedReason).toBe("obstructed");
    expect(parsed.nextStep).toContain("different route");
  });

  test("control recommends a new heading after unresolved height", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(
      sampleState({ blockedReason: "height_unresolved", moving: false }),
    );
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "control_json" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    expect(JSON.parse(socket.written().trim()).nextStep).toContain(
      "different short heading",
    );
  });

  test("navigation lists the floors of an ambiguous destination without guessing Z", async () => {
    const handle = attachControl(createMockHandle());
    handle.getNavigationState.mockReturnValue({
      active: false,
      blockedReason:
        "ambiguous ground column at destination (floors 50.68, 25.27)",
      destination: { x: 10_300.3, y: -6353.6 },
      floors: [50.68, 25.27],
      owner: "none",
      refusal: "pick_destination",
      remaining: undefined,
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "navigation_json" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    const state = JSON.parse(socket.written().trim());
    expect(state.floors).toEqual([50.68, 25.27]);
    expect(state.destination).toEqual({ x: 10_300.3, y: -6353.6 });
    expect(state.refusal).toBe("pick_destination");
    expect(state.nextStep).toContain("one of floors as Z");
    expect(state.nextStep).toContain("Do not guess Z");
  });

  test("navigation tells the caller to wait while a replan is pending", async () => {
    const handle = attachControl(createMockHandle());
    const blockedReason = "pathfind_find_height failed (UNKNOWN_HEIGHT)";
    handle.getNavigationState.mockReturnValue({
      active: false,
      blockedReason,
      destination: { x: 1, y: 2, z: 3 },
      owner: "none",
      refusal: "stop",
      remaining: 10,
      replan: { pending: true, plans: 1 },
    });
    const context = {
      cleanup: jest.fn(),
      events: new RingBuffer<EventEntry>(10),
      handle,
    };
    const pending = createMockSocket();
    await dispatchCommand(
      { type: "navigation_json" },
      { ...context, socket: pending },
    );
    expect(JSON.parse(pending.written().trim()).nextStep).toContain("Wait");
    handle.getNavigationState.mockReturnValue({
      active: false,
      blockedReason: "replan_no_progress",
      owner: "none",
      replan: { pending: false, plans: 2 },
    });
    const stopped = createMockSocket();
    await dispatchCommand(
      { type: "navigation_json" },
      { ...context, socket: stopped },
    );
    expect(JSON.parse(stopped.written().trim()).nextStep).toContain(
      "Choose another destination",
    );
  });

  test("control text distinguishes predicted from server pose", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(sampleState());
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "control" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    const output = socket.written();
    expect(output).toContain("current pose predicted");
    expect(output).toContain("last server pose server");
    expect(output).toContain("updatedAt=1000");
    expect(output).toContain("updatedAt=900");
    expect(output).toContain("0xabcde");
    expect(output).not.toContain("authoritative");
  });

  test("halt does not teardown while stop does", async () => {
    const handle = attachControl(createMockHandle());
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();
    const halted = await dispatchCommand(
      { type: "halt" },
      { cleanup, events, handle, socket },
    );
    expect(halted).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();
    const stopped = await dispatchCommand(
      { type: "stop" },
      { cleanup, events, handle, socket },
    );
    expect(stopped).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe("writeLines", () => {
  test("writes each line with newline then blank terminator", () => {
    const socket = createMockSocket();
    writeLines(socket, ["line1", "line2"]);
    expect(socket.written()).toBe("line1\nline2\n\n");
  });

  test("empty array writes just terminator", () => {
    const socket = createMockSocket();
    writeLines(socket, []);
    expect(socket.written()).toBe("\n");
  });
});

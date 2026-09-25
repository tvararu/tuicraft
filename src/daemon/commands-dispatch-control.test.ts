import { describe, expect, jest, test } from "bun:test";
import { dispatchCommand, type EventEntry, writeLines } from "daemon/commands";
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

  test("navigation refuses an ambiguous column without guessing Z", async () => {
    const handle = attachControl(createMockHandle());
    handle.getNavigationState.mockReturnValue({
      active: false,
      blockedReason: "ambiguous ground column",
      destination: { x: 8713.8, y: -6625.3, z: 70 },
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
    expect(state.blockedReason).toBe("ambiguous ground column");
    expect(state.refusal).toBe("pick_destination");
    expect(state.nextStep).toContain("one ground height");
    expect(state.nextStep).toContain("Do not guess Z");
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

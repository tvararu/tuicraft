import { describe, expect, jest, test } from "bun:test";
import type { ControlState } from "@tuicraft/core";
import { must } from "@tuicraft/core/test-support/must";
import type { EventEntry } from "#daemon/commands";
import { onControlEvent } from "#daemon/events";
import { RingBuffer } from "#lib/ring-buffer";
import type { SessionLog } from "#lib/session-log";

function sampleState(overrides: Partial<ControlState> = {}): ControlState {
  return {
    blockedReason: undefined,
    direction: "forward",
    movementAllowed: true,
    moving: true,
    owner: "manual",
    pose: {
      mapId: 530,
      orientation: 1.5,
      source: "predicted",
      updatedAt: 1000,
      x: 8709.46,
      y: -6671.76,
      z: 70.34,
    },
    requestedTarget: 0xan,
    selfGuid: 0xabcden,
    serverPose: {
      mapId: 530,
      orientation: 1.57,
      source: "server",
      updatedAt: 900,
      x: 8709.46,
      y: -6671.76,
      z: 70.34,
    },
    speed: 7,
    target: 0xan,
    ...overrides,
  };
}

describe("onControlEvent", () => {
  test("pushes event to ring and session log with hex ids", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.resolve());
    const log = { append } as unknown as SessionLog;
    onControlEvent(
      { reason: "select", state: sampleState(), type: "target_requested" },
      events,
      log,
    );
    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(must(drained[0]).text).toContain("[control]");
    expect(must(drained[0]).text).toContain("predicted");
    const json = JSON.parse(must(drained[0]).json);
    expect(json.type).toBe("CONTROL");
    expect(json.event).toBe("target_requested");
    expect(json.selfGuid).toBe("0xabcde");
    expect(json.target).toBe("0xa");
    expect(json.pose.source).toBe("predicted");
    expect(json.serverPose.source).toBe("server");
    expect(append).toHaveBeenCalledTimes(1);
  });

  test("server correction keeps server pose labelled server", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    const state = sampleState({
      pose: {
        mapId: 530,
        orientation: 0,
        source: "server",
        updatedAt: 5,
        x: 1,
        y: 2,
        z: 3,
      },
    });
    onControlEvent({ state, type: "server_correction" }, events, log);
    const entry = must(events.drain()[0]);
    expect(JSON.parse(entry.json).pose.source).toBe("server");
    expect(entry.text).toContain("server");
  });
});

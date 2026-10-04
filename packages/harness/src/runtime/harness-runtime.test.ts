import { describe, expect, test } from "bun:test";
import type { RunEnd } from "#harness/contract/runs";
import type { HandleObserver } from "#harness/contract/services";
import { Refusal } from "#harness/ops/refusal";
import { createTestRuntime } from "#test-support/runtime-fixture";

function observer(name: string, seen: string[]): HandleObserver {
  return {
    attach: () => {
      seen.push(name);
      return () => {};
    },
  };
}

function blockingRun(signal: AbortSignal): Promise<RunEnd<undefined>> {
  const { promise, resolve } = Promise.withResolvers<RunEnd<undefined>>();
  signal.addEventListener("abort", () =>
    resolve({
      reason: String((signal.reason as Error).message),
      status: "cancelled",
      summary: "stopped",
      value: undefined,
    }),
  );
  return promise;
}

describe("createHarnessRuntime", () => {
  test("starts with idle session flags and wake from the flags", async () => {
    const { rt } = await createTestRuntime({ flags: { wake: false } });
    expect(rt.session).toEqual({
      agent: "idle",
      agentGrant: undefined,
      deliveredTexts: [],
      humanTexts: [],
      humanWaiting: false,
      lastNow: undefined,
      lastToolCallAt: undefined,
      tool: undefined,
      turnStartSeq: 0,
      turnToolCalls: 0,
      unreadWhispers: 0,
      wake: false,
    });
  });

  test("connect attaches ready, router, sightings, attacks, progress, snapshots in that order", async () => {
    const seen: string[] = [];
    const names = [
      "ready",
      "router",
      "sightings",
      "attacks",
      "progress",
      "snapshots",
    ] as const;
    const { rt } = await createTestRuntime({ connect: false });
    const parts = Object.fromEntries(
      names.map((name) => [name, { ...rt[name], ...observer(name, seen) }]),
    );
    const { rt: wired } = await createTestRuntime({ parts });
    expect(wired.connection()).toBe("online");
    expect(seen).toEqual([...names]);
  });

  test("requireHandle refuses offline before connect", async () => {
    const { rt } = await createTestRuntime({ connect: false });
    expect(() => rt.requireHandle()).toThrow(Refusal);
    expect(rt.handle()).toBeUndefined();
  });

  test("stopAll cancels runs, halts the character and returns the cancelled records", async () => {
    const { rt, handle } = await createTestRuntime();
    const run = rt.runs.start({
      args: {},
      kind: "engage",
      launch: ({ signal }) => blockingRun(signal),
      toolCallId: "t1",
    });
    const stopped = rt.stopAll("human");
    expect(
      stopped.map((record) => [record.id, record.status, record.reason]),
    ).toEqual([["r1", "cancelled", "human_stop"]]);
    expect(handle.halt).toHaveBeenCalled();
    expect(handle.stopCycle).toHaveBeenCalled();
    expect(handle.stopAttack).toHaveBeenCalled();
    expect((await run.done).reason).toBe("human_stop");
  });

  test("a lost connection interrupts the active run", async () => {
    const { rt, handle } = await createTestRuntime();
    rt.runs.start({
      args: {},
      kind: "travel",
      launch: ({ signal }) => blockingRun(signal),
      toolCallId: "t1",
    });
    handle.resolveClosed();
    await Bun.sleep(0);
    expect(rt.runs.get("r1")).toMatchObject({
      reason: "connection_lost",
      status: "interrupted",
    });
    expect(rt.connection()).toBe("backoff");
    await rt.disconnect();
  });

  test("shutdown stops runs, logs out and goes offline", async () => {
    const { rt, handle } = await createTestRuntime();
    await rt.shutdown();
    expect(handle.halt).toHaveBeenCalled();
    expect(handle.logout).toHaveBeenCalled();
    expect(rt.connection()).toBe("offline");
  });

  test("a second run refuses busy with the stop call", async () => {
    const { rt } = await createTestRuntime();
    rt.runs.start({
      args: {},
      kind: "engage",
      launch: ({ signal }) => blockingRun(signal),
      toolCallId: "t1",
    });
    expect(() =>
      rt.runs.start({
        args: {},
        kind: "travel",
        launch: ({ signal }) => blockingRun(signal),
        toolCallId: "t2",
      }),
    ).toThrow("busy: r1 (engage) is still running.");
  });
});

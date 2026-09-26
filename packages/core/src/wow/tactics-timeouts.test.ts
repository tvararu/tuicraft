import { expect, test } from "bun:test";
import {
  context,
  fixture,
  frame,
  judgment,
} from "#test-support/tactics-fixtures";
import type { JevActionResult } from "#wow/jev";
import type { TacticsFrame } from "#wow/tactics";

const kill: TacticsFrame = {
  ...frame,
  outcome: { status: "completed", reason: "server_kill_credit" },
};

function scripted(replies: readonly ("timeout" | "ok")[], killAfter: number) {
  let replied = 0;
  const f = fixture({
    minIntervalMs: 0,
    requestTimeoutMs: 20,
    observe: () => (f.actions.length >= killAfter ? kill : frame),
    select: () => {
      const reply = replies[replied];
      replied += 1;
      if (reply === "ok") return Promise.resolve(judgment());
      return Promise.withResolvers<JevActionResult>().promise;
    },
  });
  return f;
}

test("one timeout is discarded and the next request fights on to the kill", async () => {
  const f = scripted(["timeout", "ok"], 1);
  await f.tactics.start(context);
  await f.stopped;
  expect(f.actions).toEqual(["smite"]);
  expect(f.events.filter((event) => event.type === "request")).toHaveLength(2);
  expect(f.events.filter((event) => event.type === "transport")).toMatchObject([
    { error: "jev_timeout" },
  ]);
  expect(f.tactics.snapshot()).toMatchObject({
    status: "idle",
    lastStopReason: "completed",
    lastOutcome: { status: "completed", reason: "server_kill_credit" },
    timeouts: { consecutive: 0, total: 1, limit: 3 },
  });
  expect(f.halts).toBe(1);
  expect(f.defenses).toBe(0);
});

test("three timeouts in a row stop with jev_timeout and defend", async () => {
  const f = scripted(["timeout", "timeout", "timeout", "ok"], 1);
  await f.tactics.start(context);
  await f.stopped;
  expect(f.actions).toEqual([]);
  expect(f.events.filter((event) => event.type === "request")).toHaveLength(3);
  expect(f.events.filter((event) => event.type === "transport")).toHaveLength(
    3,
  );
  expect(f.tactics.snapshot()).toMatchObject({
    status: "idle",
    lastStopReason: "failed",
    lastOutcome: { status: "failed", reason: "jev_timeout" },
    lastDiscardReason: "jev_timeout",
    timeouts: { consecutive: 3, total: 3, limit: 3 },
    defense: "auto_attack",
  });
  expect(f.defenses).toBe(1);
  expect(f.halts).toBe(0);
});

test("an answered request resets the consecutive timeout count", async () => {
  const f = scripted(
    ["timeout", "timeout", "ok", "timeout", "timeout", "ok"],
    2,
  );
  await f.tactics.start(context);
  await f.stopped;
  expect(f.actions).toEqual(["smite", "smite"]);
  expect(f.tactics.snapshot()).toMatchObject({
    lastOutcome: { status: "completed", reason: "server_kill_credit" },
    timeouts: { consecutive: 0, total: 4, limit: 3 },
  });
});

test("a reply that arrives after its timeout is discarded, not executed mid-fight", async () => {
  const late = Promise.withResolvers<JevActionResult>();
  const answered = Promise.withResolvers<JevActionResult>();
  const second = Promise.withResolvers<void>();
  let calls = 0;
  const f = fixture({
    minIntervalMs: 0,
    requestTimeoutMs: 20,
    observe: () => (f.actions.length > 0 ? kill : frame),
    select: () => {
      calls += 1;
      if (calls === 1) return late.promise;
      second.resolve();
      return answered.promise;
    },
  });
  const running = f.tactics.start(context);
  await second.promise;
  late.resolve(judgment("smite"));
  await Bun.sleep(0);
  expect(f.actions).toEqual([]);
  answered.resolve(judgment("wait"));
  await running;
  await f.stopped;
  expect(f.actions).toEqual(["wait"]);
  expect(f.events).toContainEqual(
    expect.objectContaining({
      type: "discarded",
      reason: "aborted",
      actionId: "smite",
    }),
  );
  expect(f.tactics.snapshot().lastOutcome?.reason).toBe("server_kill_credit");
});

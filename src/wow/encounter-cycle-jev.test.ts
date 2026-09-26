import { expect, test } from "bun:test";
import { fakeRecovery } from "test/cycle-recovery-fixtures";
import {
  fakeControl,
  fakeLoot,
  makeCycle,
} from "test/encounter-cycle-fixtures";
import type { CycleDeps } from "wow/encounter-cycle";
import { type JevSelect, selectJevAction } from "wow/jev";
import { createFaultSelect, parseJevFault } from "wow/jev-fault";
import { TacticsLoop } from "wow/tactics";

const smite = { id: "spell:585:target", description: "Smite" };

function jevTactics(select: JevSelect, apiKey = "key") {
  let hit = false;
  return new TacticsLoop({
    apiKey,
    minIntervalMs: 0,
    select,
    prepare: async () => {},
    activate: () => {
      hit = false;
    },
    observe: () => ({
      observation: {},
      candidates: [smite],
      outcome: hit
        ? { status: "completed", reason: "server_kill_credit" }
        : undefined,
    }),
    execute: () => {
      hit = true;
    },
    halt: () => {},
    defend: () => "none",
  });
}

function cycleWith(tactics: CycleDeps["tactics"]) {
  return makeCycle({
    tactics,
    loot: fakeLoot({ items: [], money: 0 }),
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
}

test("an injected HTTP 402 stops the cycle and keeps the queue resumable", async () => {
  const fault = parseJevFault("http:402");
  if (!fault) throw new Error("fault not parsed");
  let jevBack = false;
  const faulted = createFaultSelect(fault, selectJevAction);
  const select: JevSelect = (request, options) =>
    jevBack
      ? Promise.resolve({
          choice: smite.id,
          probabilities: { [smite.id]: 1 },
          confidence: 1,
          model: "jev-test",
          inputTokens: 1,
          elapsedMs: 1,
        })
      : faulted(request, options);
  const runtime = cycleWith(jevTactics(select));

  await expect(
    runtime.start({ guids: [1n, 2n, 3n], instruction: "fight" }),
  ).rejects.toThrow("jev_unavailable: HTTP 402 payment_required");
  expect(runtime.snapshot()).toMatchObject({
    active: false,
    currentIndex: 0,
    stopCause: "jev_unavailable",
    stopDetail: { reason: "HTTP 402 payment_required" },
  });
  expect(runtime.snapshot().queue.map((r) => r.status)).toEqual([
    "queued",
    "queued",
    "queued",
  ]);

  jevBack = true;
  await runtime.resume({});
  expect(runtime.snapshot().stopCause).toBe("queue_exhausted");
  expect(runtime.snapshot().queue.map((r) => r.status)).toEqual([
    "done",
    "done",
    "done",
  ]);
});

test("a missing Jev key stops the cycle instead of skipping every target", async () => {
  const runtime = cycleWith(jevTactics(selectJevAction, ""));
  await expect(
    runtime.start({ guids: [1n, 2n], instruction: "fight" }),
  ).rejects.toThrow("jev_unavailable: missing_jev_key");
  expect(runtime.snapshot().stopCause).toBe("jev_unavailable");
  expect(runtime.snapshot().queue.map((r) => r.status)).toEqual([
    "queued",
    "queued",
  ]);
});

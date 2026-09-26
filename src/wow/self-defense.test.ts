import { expect, test } from "bun:test";
import { type DefenseEvent, SelfDefense } from "wow/self-defense";
import type { TacticsContext, TacticsOutcome } from "wow/tactics";

function world(options: { jev?: boolean } = {}) {
  const attackers: bigint[] = [];
  const started: TacticsContext[] = [];
  const stops: string[] = [];
  const melee: string[] = [];
  const tactics = {
    lastOutcome: undefined as TacticsOutcome | undefined,
    lastStopReason: undefined as string | undefined,
    finish: () => {},
  };
  const status = {
    alive: true,
    owner: undefined as string | undefined,
  };
  const events: DefenseEvent[] = [];
  const defense = new SelfDefense({
    alive: () => status.alive,
    attack: (guid) => melee.push(`attack ${guid}`),
    attackers: () => [...attackers],
    face: (guid) => melee.push(`face ${guid}`),
    jev: () => options.jev ?? true,
    now: () => 5,
    owner: () => status.owner,
    tactics: {
      snapshot: () => tactics,
      start(context) {
        started.push(context);
        const run = Promise.withResolvers<void>();
        tactics.finish = run.resolve;
        return run.promise;
      },
      stop: (reason) => {
        stops.push(reason);
        tactics.lastStopReason = reason;
        tactics.finish();
      },
    },
  });
  defense.onEvent((event) => events.push(event));
  const kinds = () =>
    events.map((event) => [event.type, event.reason].filter(Boolean).join(":"));
  const stopped = () =>
    new Promise<DefenseEvent>((resolve) => {
      const off = defense.onEvent((event) => {
        if (event.type !== "stopped") return;
        off();
        resolve(event);
      });
    });
  return {
    attackers,
    defense,
    events,
    kinds,
    melee,
    started,
    status,
    stopped,
    stops,
    tactics,
  };
}

test("an armed idle character fights back with Jev and reports the kill", async () => {
  const w = world();
  w.defense.arm("defend");
  w.attackers.push(7n);
  w.defense.tick();
  expect(w.started).toEqual([{ instruction: "defend", targetGuid: 7n }]);
  expect(w.defense.snapshot().active).toMatchObject({
    attacker: 7n,
    mode: "jev",
  });
  const stopped = w.stopped();
  w.tactics.lastOutcome = { reason: "server_kill_credit", status: "completed" };
  w.tactics.finish();
  await stopped;
  expect(w.kinds()).toEqual(["armed", "started", "stopped:server_kill_credit"]);
  expect(w.stops).toEqual([]);
  expect(w.defense.snapshot()).toMatchObject({
    active: undefined,
    engagements: 1,
  });
  w.defense.disarm("command");
});

test("it never engages while disarmed, dead, or another owner holds control", () => {
  const w = world();
  w.attackers.push(7n);
  w.defense.tick();
  w.status.alive = false;
  w.defense.arm("defend");
  w.status.alive = true;
  w.status.owner = "cycle";
  w.defense.tick();
  expect(w.started).toEqual([]);
  w.status.owner = undefined;
  w.defense.tick();
  expect(w.started.map((context) => context.targetGuid)).toEqual([7n]);
  w.defense.disarm("command");
});

test("HALT ends the engagement, stops the run and disarms", () => {
  const w = world();
  w.defense.arm("defend");
  w.attackers.push(7n);
  w.defense.tick();
  w.defense.disarm("halt");
  expect(w.stops).toEqual(["halt"]);
  expect(w.kinds()).toEqual([
    "armed",
    "started",
    "stopped:halt",
    "disarmed:halt",
  ]);
  w.defense.tick();
  expect(w.started).toHaveLength(1);
  expect(w.defense.snapshot()).toMatchObject({
    armed: false,
    disarmReason: "halt",
    lastStop: { attacker: 7n, reason: "halt" },
  });
});

test("a manual takeover yields that attacker until it stops attacking", () => {
  const w = world();
  w.defense.arm("defend");
  w.attackers.push(7n);
  w.defense.tick();
  w.defense.yieldTo("manual_override");
  w.defense.tick();
  expect(w.started).toHaveLength(1);
  expect(w.defense.snapshot().yielded).toEqual([7n]);
  w.attackers.push(8n);
  w.defense.tick();
  expect(w.started.map((context) => context.targetGuid)).toEqual([7n, 8n]);
  w.defense.yieldTo("manual_override");
  w.attackers.length = 0;
  w.defense.tick();
  expect(w.defense.snapshot().yielded).toEqual([]);
  w.defense.disarm("command");
});

test("a fight started by the user replaces the run without being stopped", async () => {
  const w = world();
  w.defense.arm("defend");
  w.attackers.push(7n);
  w.defense.tick();
  const stopped = w.stopped();
  w.tactics.lastStopReason = "replaced";
  w.tactics.finish();
  await stopped;
  expect(w.stops).toEqual([]);
  expect(w.kinds().at(-1)).toBe("stopped:replaced");
  expect(w.defense.snapshot().yielded).toEqual([7n]);
  w.defense.disarm("command");
});

test("without Jev it faces and auto-attacks, and stops when the attacker is gone", () => {
  const w = world({ jev: false });
  w.defense.arm("defend");
  w.attackers.push(7n);
  w.defense.tick();
  expect(w.melee).toEqual(["face 7", "attack 7"]);
  expect(w.defense.snapshot().active?.mode).toBe("auto_attack");
  w.attackers.length = 0;
  w.defense.tick();
  expect(w.kinds()).toEqual(["armed", "started", "stopped:attacker_gone"]);
  w.defense.disarm("command");
});

test("without Jev a new owner replaces the melee engagement and that attacker is left alone", () => {
  const w = world({ jev: false });
  w.defense.arm("defend");
  w.attackers.push(7n);
  w.defense.tick();
  w.status.owner = "tactics";
  w.defense.tick();
  expect(w.kinds()).toEqual(["armed", "started", "stopped:replaced"]);
  expect(w.defense.snapshot()).toMatchObject({
    active: undefined,
    yielded: [7n],
  });
  w.status.owner = undefined;
  w.defense.tick();
  expect(w.defense.snapshot().active).toBeUndefined();
  w.defense.disarm("command");
});

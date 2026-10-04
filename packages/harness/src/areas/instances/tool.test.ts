import { describe, expect, jest, test } from "bun:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { AreaState } from "@peon/core";
import { dungeonSpec, dungeonTool } from "#harness/areas/instances/tool";
import {
  type DungeonArgs,
  dungeonParams,
} from "#harness/areas/instances/tool-params";
import { Refusal } from "#harness/ops/refusal";
import { toolCtx } from "#test-support/ops-fixtures";
import {
  createTestRuntime,
  type TestRuntime,
} from "#test-support/runtime-fixture";
import { expectSendKind } from "#test-support/tool-harness";

const NOW = 1_000_000_000;
const MIN = 60_000;
const DAY_S = 86_400;

type InstancesState = AreaState<"instances">;
type LfgState = AreaState<"lfg">;
type Lock = NonNullable<InstancesState["locks"]>[number];

function instances(over: Partial<InstancesState> = {}): InstancesState {
  return {
    dungeonDifficulty: 0,
    encounterUnits: [],
    hasPermanentBinds: undefined,
    homebindTimer: undefined,
    lastInstanceMaps: [],
    lastWarning: undefined,
    locks: [],
    locksAt: NOW,
    mapDifficulty: undefined,
    pendingBind: undefined,
    pendingDifficulty: undefined,
    raidDifficulty: 0,
    ...over,
  };
}

function lfg(over: Partial<LfgState> = {}): LfgState {
  return {
    available: [],
    boot: undefined,
    comment: "",
    joinResult: undefined,
    locks: [],
    locksAt: undefined,
    offerContinue: undefined,
    partyLocks: [],
    partyLocksAt: undefined,
    proposal: undefined,
    queue: undefined,
    raidLists: {},
    reward: undefined,
    roleCheck: undefined,
    searching: false,
    selected: [],
    status: "none",
    teleportDenied: undefined,
    ...over,
  };
}

function lock(over: Partial<Lock> = {}): Lock {
  return {
    difficulty: 0,
    extended: false,
    instanceGuid: 7n,
    locked: true,
    mapId: 36,
    secondsToReset: 2 * DAY_S,
    ...over,
  };
}

async function world(
  over: { instances?: Partial<InstancesState>; lfg?: Partial<LfgState> } = {},
) {
  const t = await createTestRuntime({});
  t.clock.set(NOW);
  jest
    .spyOn(t.handle.instances, "state")
    .mockImplementation(() => instances(over.instances));
  jest.spyOn(t.handle.lfg, "state").mockImplementation(() => lfg(over.lfg));
  return { ...t, tool: dungeonTool.definition(t.rt) };
}

function queued() {
  return {
    avgWait: 0,
    dps: 0,
    dungeon: 0x06_00_00_0c,
    healers: 0,
    queuedTime: 240,
    tanks: 0,
    wait: 0,
    waitDps: 0,
    waitHealer: 0,
    waitTank: 0,
  };
}
type Settled = { reason: string; status?: string; detail: string };

async function attempt(t: TestRuntime, args: DungeonArgs) {
  const outcome = await dungeonSpec.run(args, toolCtx(t)).then(
    (result) => ({ result, thrown: undefined as unknown }),
    (thrown: unknown) => ({ result: undefined as unknown, thrown }),
  );
  if (outcome.thrown !== undefined && outcome.thrown instanceof Refusal)
    return {
      settled: {
        detail: outcome.thrown.detail,
        reason: outcome.thrown.reason,
        status: outcome.thrown.status,
      },
      text: [outcome.thrown.detail, ...outcome.thrown.body].join("\n"),
    };
  const done = outcome.result as unknown as Settled & { body: string[] };
  return { settled: done, text: [done.detail, ...done.body].join("\n") };
}
function statusWorld() {
  return world({
    instances: {
      dungeonDifficulty: 1,
      locks: [
        lock({ extended: true, mapId: 533, secondsToReset: 5 * 3600 }),
        lock(),
      ],
      locksAt: NOW - MIN,
      mapDifficulty: {
        difficulty: 1,
        dynamicHeroic: false,
        mapId: 574,
        name: "heroic",
      },
      raidDifficulty: 3,
    },
    lfg: {
      queue: queued(),
      selected: [0x06_00_00_0c],
      status: "queued",
    },
  });
}

describe("dungeon tool", () => {
  test("minimalArgs passes the parameters schema", () => {
    expect(
      validateToolArguments(
        { description: "probe", name: "probe", parameters: dungeonParams },
        {
          arguments: dungeonSpec.minimalArgs,
          id: "c1",
          name: "probe",
          type: "toolCall",
        },
      ),
    ).toEqual(dungeonSpec.minimalArgs);
  });

  test("is an action tool and so runs sequentially", async () => {
    expect(dungeonTool.kind).toBe("action");
    await expectSendKind(dungeonTool, { accept: false, do: "bind" });
  });
});

describe("dungeon tool verbs", () => {
  test("status with a fresh list asks nothing and shows difficulty, saves and the queue", async () => {
    const t = await statusWorld();
    const requestLockouts = jest.spyOn(
      t.handle.instances.act,
      "requestLockouts",
    );
    const sent = t.handle.sent.length;
    const { text } = await attempt(t, { do: "status" });
    expect(requestLockouts).not.toHaveBeenCalled();
    expect(t.handle.sent.length).toBe(sent);
    expect(text).toContain("heroic");
    expect(text).toContain("25-heroic");
    expect(text).toContain("574");
    expect(text).toMatch(/533[^\n]*5 h[^\n]*extended/);
    expect(text).toMatch(/36[^\n]*2 d/);
    expect(text).toMatch(/random dungeon/);
    expect(text).toMatch(/solo/i);
  });

  test("status subtracts the time since the list arrived", async () => {
    const t = await world({
      instances: {
        locks: [lock({ secondsToReset: 1830 })],
        locksAt: NOW - 30_000,
      },
    });
    const { text } = await attempt(t, { do: "status" });
    expect(text).toContain("30 min");
  });

  test("status hides a save whose time ran out and says none are left", async () => {
    const t = await world({
      instances: {
        locks: [lock({ secondsToReset: 60 })],
        locksAt: NOW - 61_000,
      },
    });
    const { text } = await attempt(t, { do: "status" });
    expect(text).not.toMatch(/map 36/);
    expect(text.toLowerCase()).toContain("no saved");
  });

  test("status with an old list asks once, then renders the new list", async () => {
    const t = await world({
      instances: { locks: [lock()], locksAt: NOW - 6 * MIN },
    });
    const requestLockouts = jest
      .spyOn(t.handle.instances.act, "requestLockouts")
      .mockResolvedValue({ locks: [], status: "ok" });
    await attempt(t, { do: "status" });
    expect(requestLockouts).toHaveBeenCalledTimes(1);
  });

  test("status asks when no list ever arrived and reports a silent server", async () => {
    const t = await world({
      instances: { locks: undefined, locksAt: undefined },
    });
    const requestLockouts = jest
      .spyOn(t.handle.instances.act, "requestLockouts")
      .mockResolvedValue({ status: "no_answer" });
    const { settled, text } = await attempt(t, { do: "status" });
    expect(requestLockouts).toHaveBeenCalledTimes(1);
    expect(text).toContain("did not refresh");
    expect(settled.status).toBe("DONE");
  });

  test.each([
    ["dungeon", "normal", 0, "MSG_SET_DUNGEON_DIFFICULTY"],
    ["dungeon", "heroic", 1, "MSG_SET_DUNGEON_DIFFICULTY"],
    ["raid", "10", 0, "MSG_SET_RAID_DIFFICULTY"],
    ["raid", "25", 1, "MSG_SET_RAID_DIFFICULTY"],
    ["raid", "10-heroic", 2, "MSG_SET_RAID_DIFFICULTY"],
    ["raid", "25-heroic", 3, "MSG_SET_RAID_DIFFICULTY"],
    ["raid", "10-normal", 0, "MSG_SET_RAID_DIFFICULTY"],
    ["raid", "25-normal", 1, "MSG_SET_RAID_DIFFICULTY"],
  ] as const)(
    "difficulty %s %s sends wire number %d once",
    async (kind, value, wire) => {
      const t = await world();
      const setDifficulty = jest
        .spyOn(t.handle.instances.act, "setDifficulty")
        .mockResolvedValue({ result: "changed", status: "ok" });
      const { settled } = await attempt(t, {
        do: "difficulty",
        for: kind,
        value,
      });
      expect(setDifficulty).toHaveBeenCalledTimes(1);
      expect(setDifficulty).toHaveBeenCalledWith({ kind, value: wire });
      expect(settled.status).toBe("DONE");
    },
  );

  test("a changed difficulty names the new setting", async () => {
    const t = await world();
    jest
      .spyOn(t.handle.instances.act, "setDifficulty")
      .mockResolvedValue({ result: "changed", status: "ok" });
    const { text } = await attempt(t, {
      do: "difficulty",
      for: "dungeon",
      value: "heroic",
    });
    expect(text).toContain("heroic");
  });

  test("a solo change is UNCONFIRMED and says it shows on the next entry", async () => {
    const t = await world();
    jest
      .spyOn(t.handle.instances.act, "setDifficulty")
      .mockResolvedValue({ status: "unconfirmed_solo" });
    const { settled, text } = await attempt(t, {
      do: "difficulty",
      for: "dungeon",
      value: "heroic",
    });
    expect(settled).toMatchObject({
      reason: "unconfirmed_solo",
      status: "UNCONFIRMED",
    });
    expect(text).toContain("heroic");
    expect(text).toContain("next dungeon entry");
  });

  test.each([
    "unchanged",
    "not_leader",
    "server_refused",
    "busy",
    "out_of_range",
  ] as const)("a %s refusal keeps its reason", async (reason) => {
    const t = await world();
    jest
      .spyOn(t.handle.instances.act, "setDifficulty")
      .mockResolvedValue({ reason, status: "refused" });
    const { settled } = await attempt(t, {
      do: "difficulty",
      for: "raid",
      value: "25",
    });
    expect(settled).toMatchObject({ reason, status: "REFUSED" });
  });

  test("a silent server is UNCONFIRMED no_answer", async () => {
    const t = await world();
    jest
      .spyOn(t.handle.instances.act, "setDifficulty")
      .mockResolvedValue({ status: "no_answer" });
    const { settled } = await attempt(t, {
      do: "difficulty",
      for: "dungeon",
      value: "normal",
    });
    expect(settled).toMatchObject({
      reason: "no_answer",
      status: "UNCONFIRMED",
    });
  });

  test.each([
    [{ for: "raid", value: "heroic" }, "bad_value"],
    [{ for: "raid", value: "normal" }, "bad_value"],
    [{ for: "dungeon", value: "25" }, "bad_value"],
    [{ for: "dungeon", value: "epic" }, "bad_value"],
    [{ for: "dungeon" }, "missing_args"],
    [{ value: "heroic" }, "missing_args"],
  ] as const)(
    "difficulty %j is refused before any send",
    async (args, reason) => {
      const t = await world();
      const setDifficulty = jest.spyOn(t.handle.instances.act, "setDifficulty");
      const { settled } = await attempt(t, { do: "difficulty", ...args });
      expect(setDifficulty).not.toHaveBeenCalled();
      expect(settled).toMatchObject({ reason, status: "REFUSED" });
    },
  );

  test("an unknown verb is refused and sends nothing", async () => {
    const t = await world();
    const extend = jest.spyOn(t.handle.instances.act, "setLockoutExtended");
    const { settled } = await attempt(t, {
      do: "frobnicate" as unknown as DungeonArgs["do"],
      extended: true,
      map: 533,
    });
    expect(settled.status).toBe("REFUSED");
    expect(settled.reason).toBe("unknown_verb");
    for (const verb of [
      "status",
      "difficulty",
      "reset",
      "bind",
      "extend",
      "queue",
      "leave_queue",
      "answer",
      "roles",
      "teleport",
      "kick_vote",
    ])
      expect(settled.detail).toContain(verb);
    expect(extend).not.toHaveBeenCalled();
  });
  test("reset renders one line per map", async () => {
    const t = await world();
    const resetInstances = jest
      .spyOn(t.handle.instances.act, "resetInstances")
      .mockResolvedValue({ failed: [], reset: [36, 43], status: "ok" });
    const { settled, text } = await attempt(t, { do: "reset" });
    expect(resetInstances).toHaveBeenCalledTimes(1);
    expect(settled.status).toBe("DONE");
    expect(text).toMatch(/map 36/);
    expect(text).toMatch(/map 43/);
  });

  test("reset with a map that stays inside is PARTLY and names both", async () => {
    const t = await world();
    jest
      .spyOn(t.handle.instances.act, "resetInstances")
      .mockResolvedValue({ failed: [43], reset: [36], status: "ok" });
    const { settled, text } = await attempt(t, { do: "reset" });
    expect(settled.status).toBe("PARTLY");
    expect(text).toMatch(/map 36/);
    expect(text).toMatch(/map 43/);
  });

  test("reset where every map failed is REFUSED", async () => {
    const t = await world();
    jest
      .spyOn(t.handle.instances.act, "resetInstances")
      .mockResolvedValue({ failed: [43], reset: [], status: "ok" });
    const { settled } = await attempt(t, { do: "reset" });
    expect(settled).toMatchObject({
      reason: "reset_failed",
      status: "REFUSED",
    });
  });

  test("nothing to reset is a DONE result with its own reason", async () => {
    const t = await world();
    jest
      .spyOn(t.handle.instances.act, "resetInstances")
      .mockResolvedValue({ status: "nothing_to_reset" });
    const { settled } = await attempt(t, { do: "reset" });
    expect(settled).toMatchObject({
      reason: "nothing_to_reset",
      status: "DONE",
    });
  });

  test("a heroic reset and a non-leader reset are refused with their reasons", async () => {
    const t = await world();
    const act = jest.spyOn(t.handle.instances.act, "resetInstances");
    act.mockResolvedValueOnce({ reason: "heroic_no_reset", status: "refused" });
    const heroic = await attempt(t, { do: "reset" });
    expect(heroic.settled).toMatchObject({
      reason: "heroic_no_reset",
      status: "REFUSED",
    });
    act.mockResolvedValueOnce({ reason: "not_leader", status: "refused" });
    const member = await attempt(t, { do: "reset" });
    expect(member.settled).toMatchObject({
      reason: "not_leader",
      status: "REFUSED",
    });
  });

  test("bind accepts by default and declines when asked", async () => {
    const t = await world();
    const answerBind = jest
      .spyOn(t.handle.instances.act, "answerBind")
      .mockResolvedValue({ status: "ok" });
    const accepted = await attempt(t, { do: "bind" });
    expect(answerBind).toHaveBeenLastCalledWith(true);
    expect(accepted.settled.status).toBe("DONE");
    await attempt(t, { accept: false, do: "bind" });
    expect(answerBind).toHaveBeenLastCalledWith(false);
    expect(answerBind).toHaveBeenCalledTimes(2);
  });

  test("bind without an open prompt is REFUSED no_bind_offer", async () => {
    const t = await world();
    jest
      .spyOn(t.handle.instances.act, "answerBind")
      .mockResolvedValue({ reason: "no_bind_offer", status: "refused" });
    const { settled } = await attempt(t, { do: "bind" });
    expect(settled).toMatchObject({
      reason: "no_bind_offer",
      status: "REFUSED",
    });
  });

  test("extend sends the held lock's difficulty and the flag", async () => {
    const t = await world({
      instances: { locks: [lock({ difficulty: 3, mapId: 533 })] },
    });
    const setLockoutExtended = jest
      .spyOn(t.handle.instances.act, "setLockoutExtended")
      .mockResolvedValue({ status: "ok" });
    const { settled } = await attempt(t, { do: "extend", map: 533 });
    expect(setLockoutExtended).toHaveBeenCalledWith({
      difficulty: 3,
      extended: true,
      mapId: 533,
    });
    expect(settled.status).toBe("DONE");
    await attempt(t, { do: "extend", extended: false, map: 533 });
    expect(setLockoutExtended).toHaveBeenLastCalledWith({
      difficulty: 3,
      extended: false,
      mapId: 533,
    });
  });

  test("extend with two saves of one map needs a difficulty and with none is refused", async () => {
    const t = await world({
      instances: {
        locks: [
          lock({ difficulty: 0, mapId: 533 }),
          lock({ difficulty: 1, mapId: 533 }),
        ],
      },
    });
    const setLockoutExtended = jest.spyOn(
      t.handle.instances.act,
      "setLockoutExtended",
    );
    const both = await attempt(t, { do: "extend", map: 533 });
    expect(both.settled).toMatchObject({
      reason: "ambiguous",
      status: "REFUSED",
    });
    const none = await attempt(t, { do: "extend", map: 999 });
    expect(none.settled).toMatchObject({
      reason: "no_matching_lock",
      status: "REFUSED",
    });
    expect(setLockoutExtended).not.toHaveBeenCalled();
    setLockoutExtended.mockResolvedValue({ status: "ok" });
    await attempt(t, {
      do: "extend",
      map: 533,
      value: "25-normal",
    });
    expect(setLockoutExtended).toHaveBeenCalledWith({
      difficulty: 1,
      extended: true,
      mapId: 533,
    });
  });

  test("extend without a map is refused", async () => {
    const t = await world();
    const { settled } = await attempt(t, { do: "extend" });
    expect(settled).toMatchObject({
      reason: "missing_args",
      status: "REFUSED",
    });
  });
});

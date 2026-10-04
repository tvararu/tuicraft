import { describe, expect, jest, test } from "bun:test";
import type { AreaState } from "@peon/core";
import {
  partyMember,
  partyState,
} from "@peon/core/test-support/party-fixtures";
import { lookTool } from "#harness/tools/look";
import { savesLine } from "#harness/tools/look-saves";
import { createTestRuntime } from "#test-support/runtime-fixture";
import { runTool } from "#test-support/tool-harness";
import { selfPose, selfRow, setWorld } from "#test-support/world-fixtures";

const NOW = 1_000_000_000;

type InstancesState = AreaState<"instances">;
type LfgState = AreaState<"lfg">;
type Lock = NonNullable<InstancesState["locks"]>[number];

function instancesState(over: Partial<InstancesState> = {}): InstancesState {
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

function lfgState(over: Partial<LfgState> = {}): LfgState {
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
    secondsToReset: 2 * 86_400,
    ...over,
  };
}

describe("look saves line", () => {
  test("a save and a queue share one line with the time left", () => {
    const line = savesLine(
      instancesState({
        locks: [lock({ secondsToReset: 2 * 86_400 })],
        locksAt: NOW - 60_000,
      }),
      lfgState({ selected: [0x06_00_00_0c], status: "queued" }),
      NOW,
    );
    expect(line).toHaveLength(2);
    expect(line[0]).toMatch(/Saved: map 36[^\n]*2 d left/);
    expect(line[1]).toMatch(/In queue: a random dungeon/);
    expect(line[1]).toMatch(/solo/i);
    expect(line[1]).toContain("1");
  });

  test("a type-6 entry reads as a random dungeon", () => {
    const line = savesLine(
      instancesState(),
      lfgState({ selected: [0x06_00_00_02], status: "queued" }),
      NOW,
    );
    expect(line).toEqual([
      "No saved instances.",
      "In queue: a random dungeon, waiting 0 s (solo, not in a group (party of 1)).",
    ]);
  });

  test("a type-1 entry reads as a specific dungeon", () => {
    const line = savesLine(
      instancesState(),
      lfgState({ selected: [0x01_00_00_02], status: "queued" }),
      NOW,
    );
    expect(line).toEqual([
      "No saved instances.",
      "In queue: dungeon 2, waiting 0 s (solo, not in a group (party of 1)).",
    ]);
  });

  test("no save and no queue add no line", () => {
    expect(savesLine(instancesState(), lfgState(), NOW)).toEqual([]);
  });

  test("an expired save reads as no saves", () => {
    const line = savesLine(
      instancesState({
        locks: [lock({ secondsToReset: 60 })],
        locksAt: NOW - 61_000,
      }),
      lfgState(),
      NOW,
    );
    expect(line).toEqual([]);
  });

  test("a queued party line names the party size", () => {
    const line = savesLine(
      instancesState(),
      lfgState({ selected: [0x06_00_00_02], status: "queued" }),
      NOW,
      partyState({
        inGroup: true,
        leader: null,
        members: [partyMember({ name: "Ann" }), partyMember({ name: "Tom" })],
      }),
    );
    expect(line).toHaveLength(2);
    expect(line[1]).toMatch(/party/i);
    expect(line[1]).toContain("3");
  });

  test("a proposal shows the queue line", () => {
    const line = savesLine(
      instancesState(),
      lfgState({ selected: [0x02_00_00_12], status: "proposal" }),
      NOW,
    );
    expect(line).toEqual([
      "No saved instances.",
      "In queue: dungeon 18, waiting 0 s (solo, not in a group (party of 1)).",
    ]);
  });

  test("look output gains the line when a save is held", async () => {
    const { clock, handle, rt } = await createTestRuntime({});
    clock.set(NOW);
    jest
      .spyOn(handle.instances, "state")
      .mockReturnValue(
        instancesState({ locks: [lock()], locksAt: NOW - 60_000 }),
      );
    jest.spyOn(handle.lfg, "state").mockReturnValue(lfgState());
    setWorld(handle, { pose: selfPose(NOW), rows: [selfRow()] });
    const { text } = await runTool(lookTool.definition(rt), {});
    expect(text.split("\n")).toContain(
      "Saved: map 36 (difficulty 0), 2 d left.",
    );
  });

  test("look output gains nothing without a save or a queue", async () => {
    const { clock, handle, rt } = await createTestRuntime({});
    clock.set(NOW);
    jest.spyOn(handle.instances, "state").mockReturnValue(instancesState());
    jest.spyOn(handle.lfg, "state").mockReturnValue(lfgState());
    setWorld(handle, { pose: selfPose(NOW), rows: [selfRow()] });
    const { text } = await runTool(lookTool.definition(rt), {});
    expect(text).not.toContain("Saved:");
    expect(text).not.toContain("In queue:");
  });
});

import { jest, type Mock } from "bun:test";
import { type AreaState, emptyParty, type PartyState } from "@peon/core";
import { dungeonSpec } from "#harness/areas/instances/tool";
import type { DungeonArgs } from "#harness/areas/instances/tool-params";
import { Refusal } from "#harness/ops/refusal";
import { toolCtx } from "#test-support/ops-fixtures";
import {
  createTestRuntime,
  type TestRuntime,
} from "#test-support/runtime-fixture";

export const NOW = 1_000_000_000;

export type InstancesState = AreaState<"instances">;
export type LfgState = AreaState<"lfg">;

export function instances(over: Partial<InstancesState> = {}): InstancesState {
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

export function lfg(over: Partial<LfgState> = {}): LfgState {
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

export type PartySetup = {
  inGroup?: boolean;
  leader?: string | null;
  names?: readonly string[];
};

export function partyGroup(over: PartySetup = {}): PartyState {
  return {
    ...emptyParty(),
    inGroup: over.inGroup ?? false,
    leader: over.leader ?? null,
    members: (over.names ?? []).map((name, index) => ({
      auras: [],
      flags: 0,
      guid: BigInt(index + 1),
      health: null,
      level: null,
      maxHealth: null,
      maxPower: null,
      name,
      online: true,
      pet: null,
      position: null,
      power: null,
      powerType: null,
      roles: 0,
      source: null,
      statsAt: null,
      status: 1,
      subgroup: 0,
      vehicleSeat: null,
      zone: null,
    })),
  };
}

export async function world(
  over: {
    instances?: Partial<InstancesState>;
    lfg?: Partial<LfgState>;
    party?: PartySetup;
  } = {},
) {
  const t = await createTestRuntime({});
  t.clock.set(NOW);
  jest
    .spyOn(t.handle.instances, "state")
    .mockImplementation(() => instances(over.instances));
  jest.spyOn(t.handle.lfg, "state").mockImplementation(() => lfg(over.lfg));
  if (over.party !== undefined) {
    const party = partyGroup(over.party);
    (t.handle.getPartyState as Mock<() => PartyState>).mockReturnValue(party);
  }
  return t;
}

type Settled = {
  status: string;
  detail: string;
  reason?: string;
  body: string[];
};

export async function attempt(
  t: TestRuntime,
  args: DungeonArgs,
): Promise<{ settled: Settled; text: string }> {
  const outcome = await dungeonSpec.run(args, toolCtx(t)).then(
    (result) => ({ result, thrown: undefined as unknown }),
    (thrown: unknown) => ({ result: undefined as unknown, thrown }),
  );
  if (outcome.thrown !== undefined && outcome.thrown instanceof Refusal)
    return {
      settled: {
        body: [...outcome.thrown.body],
        detail: outcome.thrown.detail,
        reason: outcome.thrown.reason,
        status: outcome.thrown.status,
      },
      text: [outcome.thrown.detail, ...outcome.thrown.body].join("\n"),
    };
  const done = outcome.result as unknown as Settled & { body: string[] };
  return { settled: done, text: [done.detail, ...done.body].join("\n") };
}

export function queueAvailable() {
  return lfg({
    available: [{ entry: 0x06_00_00_0c, id: 12 }],
    locks: [
      { entry: 0x06_00_00_0c, id: 12, reason: "none", status: 0, type: 6 },
    ],
    locksAt: NOW,
  });
}

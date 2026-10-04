import type { Mock } from "bun:test";
import { describe, expect, jest, test } from "bun:test";
import type { AreaEventOf, AreaState, PartyMember } from "@peon/core";
import { elapse, withFakeTimers } from "@peon/core/test-support/fake-time";
import {
  partyMember,
  partyState,
} from "@peon/core/test-support/party-fixtures";
import { groupSpec, groupTool } from "#harness/areas/raid/tool";
import { READY_CHECK_TIMEOUT_MS } from "#harness/areas/raid/tool-ready";
import type { GroupAfter } from "#harness/areas/raid/tool-shared";
import { toolCtx } from "#test-support/ops-fixtures";
import { createTestRuntime } from "#test-support/runtime-fixture";
import { runTool } from "#test-support/tool-harness";

type RaidState = AreaState<"raid">;
type RaidGroup = NonNullable<RaidState["group"]>;
type ReadyCheck = NonNullable<RaidState["readyCheck"]>;
type RaidEvent = AreaEventOf<"raid">;

const SELF = 0x0764n;
const TOM = 0x100n;
const ANN = 0x200n;
const ASSISTANT = 1;

function tom(): PartyMember {
  return partyMember({ guid: TOM, name: "Tom" });
}

function ann(): PartyMember {
  return partyMember({ guid: ANN, name: "Ann", subgroup: 1 });
}

function raidGroup(over: Partial<RaidGroup> = {}): RaidGroup {
  return {
    battleground: false,
    counter: 1,
    difficulty: undefined,
    dungeonFinder: undefined,
    groupGuid: 1n,
    kind: "party",
    leader: SELF,
    loot: undefined,
    members: [],
    self: { flags: 0, roles: 0, subgroup: 0 },
    ...over,
  };
}

function openCheck(over: Partial<ReadyCheck> = {}): ReadyCheck {
  return {
    answers: new Map(),
    finishedAt: undefined,
    id: 1,
    initiator: TOM,
    names: new Map([
      [TOM, "Tom"],
      [ANN, "Ann"],
    ]),
    ownAnswer: undefined,
    silent: undefined,
    startedAt: 1,
    ...over,
  };
}

type Setup = {
  group?: Partial<RaidGroup>;
  inGroup?: boolean;
  readyCheck?: ReadyCheck;
};

async function world(setup: Setup = {}) {
  const t = await createTestRuntime();
  const members = [tom(), ann()];
  const inGroup = setup.inGroup ?? true;
  const control = t.handle.getControlState();
  (t.handle.getControlState as Mock<() => typeof control>).mockReturnValue({
    ...control,
    selfGuid: SELF,
  });
  const party = inGroup
    ? partyState({ inGroup: true, leader: "Tom", members })
    : partyState();
  (t.handle.getPartyState as Mock<() => typeof party>).mockReturnValue(party);
  let groupState: RaidState = {
    group: inGroup
      ? raidGroup({
          members: members.map((member) => ({
            flags: member.flags,
            guid: member.guid,
            name: member.name,
            roles: member.roles,
            status: member.status,
            subgroup: member.subgroup,
          })),
          ...setup.group,
        })
      : undefined,
    marks: Array.from({ length: 8 }, () => 0n),
    readyCheck: setup.readyCheck,
    stats: new Map(),
  };
  jest.spyOn(t.handle.raid, "state").mockImplementation(() => groupState);
  const start = jest
    .spyOn(t.handle.raid.act, "startReadyCheck")
    .mockImplementation(() => undefined);
  const answer = jest
    .spyOn(t.handle.raid.act, "answerReadyCheck")
    .mockImplementation(() => undefined);
  const emit = (event: RaidEvent) => t.handle.triggerAreaEvent("raid", event);
  const finish = (
    check: ReadyCheck,
    done: Extract<RaidEvent, { type: "ready_check_finished" }>,
  ) => {
    groupState = { ...groupState, readyCheck: check };
    t.handle.triggerAreaEvent("raid", done);
  };
  const begin = (check: ReadyCheck) => {
    groupState = { ...groupState, readyCheck: check };
    emit({ initiator: check.initiator, name: "", type: "ready_check_started" });
  };
  return {
    ...t,
    answer,
    begin,
    emit,
    finish,
    start,
    tool: groupTool.definition(t.rt),
  };
}

const AS_ASSISTANT = {
  group: { leader: TOM, self: { flags: ASSISTANT, roles: 0, subgroup: 0 } },
};

describe("group tool ready_check", () => {
  test("refuses to a plain member and out of a group", async () => {
    const member = await world({ group: { leader: TOM } });
    const refused = await runTool(member.tool, { do: "ready_check" });
    expect(refused.text).toContain("REFUSED not_leader");
    const alone = await world({ inGroup: false });
    const none = await runTool(alone.tool, { do: "ready_check" });
    expect(none.text).toContain("REFUSED not_in_group");
    expect(member.start).not.toHaveBeenCalled();
    expect(alone.start).not.toHaveBeenCalled();
  });

  test("is done when the server relays the start from Peon", async () => {
    const t = await world();
    t.start.mockImplementation(() => t.begin(openCheck({ initiator: SELF })));
    const promise = runTool(t.tool, { do: "ready_check" });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    t.finish(
      openCheck({
        answers: new Map([[TOM, "ready"]]),
        finishedAt: 2,
        initiator: SELF,
      }),
      {
        notReady: [],
        offline: 0,
        pending: 0,
        ready: 1,
        type: "ready_check_finished",
      },
    );
    const out = await promise;
    expect(t.start).toHaveBeenCalledTimes(1);
    expect(out.text).toContain("DONE");
    expect(out.details.result.after).toMatchObject({ do: "ready_check" });
  });

  test("returns who was ready and who stayed silent", async () => {
    const t = await world();
    t.start.mockImplementation(() => t.begin(openCheck({ initiator: SELF })));
    const promise = runTool(t.tool, { do: "ready_check" });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    t.finish(
      openCheck({
        answers: new Map([[TOM, "ready"]]),
        finishedAt: 2,
        initiator: SELF,
      }),
      {
        notReady: [],
        offline: 0,
        pending: 0,
        ready: 1,
        type: "ready_check_finished",
      },
    );
    const out = await promise;
    expect(out.text).toContain("DONE");
    expect(out.text).toContain("ready: Tom");
    expect(out.text).toContain("no answer: Ann");
  });

  test("names a member who answered not ready and one offline", async () => {
    const t = await world();
    t.start.mockImplementation(() => t.begin(openCheck({ initiator: SELF })));
    const promise = runTool(t.tool, { do: "ready_check" });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    t.finish(
      openCheck({
        answers: new Map([
          [TOM, "not_ready"],
          [ANN, "offline"],
        ]),
        finishedAt: 2,
        initiator: SELF,
      }),
      {
        notReady: ["Tom"],
        offline: 1,
        pending: 0,
        ready: 0,
        type: "ready_check_finished",
      },
    );
    const out = await promise;
    expect(out.text).toContain("not ready: Tom");
    expect(out.text).toContain("offline: Ann");
  });

  test("returns at once when the check finished during the start", async () => {
    const t = await world();
    t.start.mockImplementation(() => {
      t.begin(openCheck({ initiator: SELF }));
      t.finish(
        openCheck({
          answers: new Map([[TOM, "ready"]]),
          finishedAt: 2,
          initiator: SELF,
        }),
        {
          notReady: [],
          offline: 0,
          pending: 0,
          ready: 1,
          type: "ready_check_finished",
        },
      );
    });
    const out = await runTool(t.tool, { do: "ready_check" });
    expect(out.text).toContain("DONE");
    expect(out.text).toContain("ready: Tom");
  });

  test("reports the silent members when the check never finishes", async () => {
    const t = await world();
    t.start.mockImplementation(() => t.begin(openCheck({ initiator: SELF })));
    const out = await withFakeTimers(async () => {
      const promise = runTool(t.tool, { do: "ready_check" });
      await elapse(READY_CHECK_TIMEOUT_MS + 10_000);
      return promise;
    });
    expect(out.text).toContain("UNCONFIRMED");
    expect(out.text).toContain("no answer: Tom, Ann");
  });

  test("an abort during the outcome wait rejects", async () => {
    const t = await world();
    t.start.mockImplementation(() => t.begin(openCheck({ initiator: SELF })));
    const abort = new AbortController();
    const promise = groupSpec.run(
      { do: "ready_check" },
      toolCtx<GroupAfter>(t, abort.signal),
    );
    const outcome = promise.catch((error: unknown) => error);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    abort.abort(new Error("cancelled"));
    await expect(outcome).resolves.toMatchObject({ message: "cancelled" });
  });

  test("a replacement check finishing is not this call's outcome", async () => {
    const t = await world();
    t.start.mockImplementation(() => t.begin(openCheck({ initiator: SELF })));
    const promise = runTool(t.tool, { do: "ready_check" });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    t.begin(openCheck({ id: 2, initiator: TOM }));
    t.finish(
      openCheck({
        answers: new Map([[ANN, "ready"]]),
        finishedAt: 3,
        id: 2,
        initiator: TOM,
      }),
      {
        notReady: [],
        offline: 0,
        pending: 0,
        ready: 1,
        type: "ready_check_finished",
      },
    );
    const out = await promise;
    expect(out.text).toContain("UNCONFIRMED");
    expect(out.text).not.toContain("ready: Ann");
  });

  test("a replacement during the start window is not this call's outcome", async () => {
    const t = await world();
    t.start.mockImplementation(() => {
      t.begin(openCheck({ initiator: SELF }));
      t.finish(
        openCheck({
          answers: new Map([[ANN, "ready"]]),
          finishedAt: 3,
          id: 2,
          initiator: TOM,
        }),
        {
          notReady: [],
          offline: 0,
          pending: 0,
          ready: 1,
          type: "ready_check_finished",
        },
      );
    });
    const out = await runTool(t.tool, { do: "ready_check" });
    expect(out.text).toContain("UNCONFIRMED");
    expect(out.text).not.toContain("ready: Ann");
  });

  test("an assistant may start a check", async () => {
    const t = await world(AS_ASSISTANT);
    t.start.mockImplementation(() => t.begin(openCheck({ initiator: SELF })));
    const promise = runTool(t.tool, { do: "ready_check" });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    t.finish(openCheck({ finishedAt: 2, initiator: SELF }), {
      notReady: [],
      offline: 0,
      pending: 0,
      ready: 0,
      type: "ready_check_finished",
    });
    const out = await promise;
    expect(t.start).toHaveBeenCalledTimes(1);
    expect(out.text).toContain("DONE");
  });

  test("a start by someone else does not confirm", async () => {
    const t = await world();
    t.start.mockImplementation(() => {
      t.emit({ initiator: TOM, name: "Tom", type: "ready_check_started" });
      return elapse(3000);
    });
    const out = await withFakeTimers(() =>
      runTool(t.tool, { do: "ready_check" }),
    );
    expect(out.text).toContain("UNCONFIRMED");
  });

  test("stays unconfirmed when the server stays silent", async () => {
    const t = await world();
    t.start.mockImplementation(() => elapse(3000));
    const out = await withFakeTimers(() =>
      runTool(t.tool, { do: "ready_check" }),
    );
    expect(out.text).toContain("UNCONFIRMED");
  });

  test("fails when the send throws", async () => {
    const t = await world();
    t.start.mockImplementation(() => {
      throw new Error("socket closed");
    });
    const out = await runTool(t.tool, { do: "ready_check" });
    expect(out.text).toContain("FAILED");
  });

  test("an aborted run ends the wait before sending", async () => {
    const t = await world();
    const abort = new AbortController();
    abort.abort(new Error("cancelled"));
    await expect(
      groupSpec.run(
        { do: "ready_check" },
        toolCtx<GroupAfter>(t, abort.signal),
      ),
    ).rejects.toThrow("cancelled");
    expect(t.start).not.toHaveBeenCalled();
  });
});

describe("group tool ready", () => {
  test("refuses when no check is open", async () => {
    const none = await world();
    const out = await runTool(none.tool, { do: "ready", what: "yes" });
    expect(out.text).toContain("REFUSED no_check");
    const over = await world({ readyCheck: openCheck({ finishedAt: 5 }) });
    const done = await runTool(over.tool, { do: "ready", what: "yes" });
    expect(done.text).toContain("REFUSED no_check");
    expect(none.answer).not.toHaveBeenCalled();
    expect(over.answer).not.toHaveBeenCalled();
  });

  test("refuses out of a group", async () => {
    const t = await world({ inGroup: false });
    const out = await runTool(t.tool, { do: "ready", what: "yes" });
    expect(out.text).toContain("REFUSED not_in_group");
  });

  test("answers yes and no on an open check", async () => {
    const t = await world({
      group: { leader: TOM },
      readyCheck: openCheck(),
    });
    const yes = await runTool(t.tool, { do: "ready", what: "yes" });
    expect(t.answer).toHaveBeenLastCalledWith(true);
    expect(yes.text).toContain("DONE");
    const no = await runTool(t.tool, { do: "ready", what: " No " });
    expect(t.answer).toHaveBeenLastCalledWith(false);
    expect(no.text).toContain("DONE");
  });

  test("refuses an unclear answer before sending", async () => {
    const t = await world({ readyCheck: openCheck() });
    const missing = await runTool(t.tool, { do: "ready" });
    expect(missing.text).toContain("REFUSED bad_answer");
    const odd = await runTool(t.tool, { do: "ready", what: "maybe" });
    expect(odd.text).toContain("REFUSED bad_answer");
    expect(t.answer).not.toHaveBeenCalled();
  });

  test("fails when the send throws", async () => {
    const t = await world({ readyCheck: openCheck() });
    t.answer.mockImplementation(() => {
      throw new Error("socket closed");
    });
    const out = await runTool(t.tool, { do: "ready", what: "yes" });
    expect(out.text).toContain("FAILED");
  });
});

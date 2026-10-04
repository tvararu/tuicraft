import type { Mock } from "bun:test";
import { describe, expect, jest, test } from "bun:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { AreaState, PartyMember } from "@peon/core";
import { elapse, withFakeTimers } from "@peon/core/test-support/fake-time";
import {
  partyMember,
  partyState,
} from "@peon/core/test-support/party-fixtures";
import { groupSpec, groupTool } from "#harness/areas/raid/tool";
import type { GroupAfter } from "#harness/areas/raid/tool-shared";
import { groupParams } from "#harness/areas/raid/tool-shared";
import { toolCtx } from "#test-support/ops-fixtures";
import { createTestRuntime } from "#test-support/runtime-fixture";
import { expectSendKind, runTool } from "#test-support/tool-harness";

type RaidState = AreaState<"raid">;
type RaidGroup = NonNullable<RaidState["group"]>;
type Member = PartyMember;

const SELF = 0x0764n;
const TOM = 0x100n;
const ANN = 0x200n;
const NOW = 1_000_000;

function tom(over: Partial<Member> = {}): Member {
  return partyMember({ guid: TOM, name: "Tom", ...over });
}
function ann(over: Partial<Member> = {}): Member {
  return partyMember({ guid: ANN, name: "Ann", subgroup: 1, ...over });
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

type Setup = {
  members?: Member[];
  group?: Partial<RaidGroup>;
  party?: Parameters<typeof partyState>[0];
  stats?: RaidState["stats"];
  readyCheck?: RaidState["readyCheck"];
  inGroup?: boolean;
};

async function world(setup: Setup = {}) {
  const t = await createTestRuntime();
  const members = setup.members ?? [tom()];
  const inGroup = setup.inGroup ?? true;
  t.clock.set(NOW);
  const control = t.handle.getControlState();
  (t.handle.getControlState as Mock<() => typeof control>).mockReturnValue({
    ...control,
    selfGuid: SELF,
  });
  const party = inGroup
    ? partyState({
        inGroup: true,
        leader: "Tom",
        members,
        ...setup.party,
      })
    : partyState();
  (t.handle.getPartyState as Mock<() => typeof party>).mockReturnValue(party);
  const groupState: RaidState = {
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
    stats: setup.stats ?? new Map(),
  };
  jest.spyOn(t.handle.raid, "state").mockReturnValue(groupState);
  const uninvite = jest.fn();
  jest.spyOn(t.handle.raid.act, "uninviteGuid").mockImplementation(uninvite);
  return { ...t, tool: groupTool.definition(t.rt), uninvite };
}

describe("group tool", () => {
  test("minimalArgs passes the parameters schema", () => {
    expect(
      validateToolArguments(
        { description: "probe", name: "probe", parameters: groupParams },
        {
          arguments: groupSpec.minimalArgs,
          id: "c1",
          name: "probe",
          type: "toolCall",
        },
      ),
    ).toEqual(groupSpec.minimalArgs);
  });

  test("status and refusals send nothing", async () => {
    await expectSendKind(groupTool, {});
    await expectSendKind(groupTool, { do: "kick", to: "Nobody" });
    await expectSendKind(groupTool, { do: "lead", to: "Nobody" });
    await expectSendKind(groupTool, { do: "give", what: "Linen" });
    await expectSendKind(groupTool, { do: "pass_loot", what: "on" });
    await expectSendKind(groupTool, { do: "roll", what: "need" });
    await expectSendKind(groupTool, { do: "share_quest", quest: "Nothing" });
  });

  describe("kick", () => {
    test("refuses out of a group", async () => {
      const t = await world({ inGroup: false });
      const out = await runTool(t.tool, { do: "kick", to: "Tom" });
      expect(out.text).toContain("REFUSED not_in_group");
      expect(t.uninvite).not.toHaveBeenCalled();
    });

    test("needs a name", async () => {
      const t = await world();
      const out = await runTool(t.tool, { do: "kick" });
      expect(out.text).toContain("REFUSED");
      expect(out.text).toMatch(/name/);
      expect(t.uninvite).not.toHaveBeenCalled();
    });

    test("refuses a name outside the roster and lists the members", async () => {
      const t = await world({ members: [tom(), ann()] });
      const out = await runTool(t.tool, { do: "kick", to: "Zed" });
      expect(out.text).toContain("REFUSED not_a_member");
      expect(out.text).toContain("Tom");
      expect(out.text).toContain("Ann");
      expect(t.uninvite).not.toHaveBeenCalled();
    });

    test("refuses when Peon neither leads nor assists", async () => {
      const t = await world({
        group: { leader: TOM },
        members: [tom(), ann()],
      });
      const out = await runTool(t.tool, { do: "kick", to: "Ann" });
      expect(out.text).toContain("REFUSED not_leader");
      expect(t.uninvite).not.toHaveBeenCalled();
    });

    test("refuses to kick the leader", async () => {
      const t = await world({
        group: { leader: TOM, self: { flags: 1, roles: 0, subgroup: 0 } },
        members: [tom(), ann()],
      });
      const out = await runTool(t.tool, { do: "kick", to: "Tom" });
      expect(out.text).toContain("REFUSED target_is_leader");
      expect(t.uninvite).not.toHaveBeenCalled();
    });

    test("refuses in a dungeon-finder group", async () => {
      const t = await world({
        group: { dungeonFinder: { dungeonId: 1, status: 1 } },
        members: [tom(), ann()],
      });
      const out = await runTool(t.tool, { do: "kick", to: "Ann" });
      expect(out.text).toContain("REFUSED lfg_vote_kick");
      expect(t.uninvite).not.toHaveBeenCalled();
    });

    test("an assistant may kick a member", async () => {
      const t = await world({
        group: { leader: TOM, self: { flags: 1, roles: 0, subgroup: 0 } },
        members: [tom(), ann()],
      });
      t.uninvite.mockImplementation(() => elapse(3000));
      const out = await withFakeTimers(() =>
        runTool(t.tool, { do: "kick", to: "Ann" }),
      );
      expect(t.uninvite).toHaveBeenCalledWith("Ann", "");
      expect(out.text).toContain("UNCONFIRMED");
    });

    test("sends the reason and is done when the member leaves the roster", async () => {
      const t = await world({ members: [tom(), ann()] });
      t.uninvite.mockImplementation(() =>
        t.handle.triggerAreaEvent("raid", {
          changes: [{ kind: "left", name: "Ann" }],
          group: raidGroup(),
          type: "group_list",
        }),
      );
      const out = await runTool(t.tool, {
        do: "kick",
        text: "test",
        to: "ann",
      });
      expect(t.uninvite).toHaveBeenCalledWith("Ann", "test");
      expect(out.text).toContain("DONE");
      expect(out.text).toContain("Ann");
      expect(out.details.result.after).toMatchObject({
        confirmed: true,
        do: "kick",
        to: "Ann",
      });
    });

    test("a left change for someone else does not confirm", async () => {
      const t = await world({ members: [tom(), ann()] });
      t.uninvite.mockImplementation(() => {
        t.handle.triggerAreaEvent("raid", {
          changes: [{ kind: "left", name: "Tom" }],
          group: raidGroup(),
          type: "group_list",
        });
        return elapse(3000);
      });
      const out = await withFakeTimers(() =>
        runTool(t.tool, { do: "kick", to: "Ann" }),
      );
      expect(out.text).toContain("UNCONFIRMED");
    });

    test("kicking the only rostered member is refused when it is not Peon", async () => {
      const t = await world({
        group: { leader: TOM },
        members: [tom(), ann({ flags: 0 })],
      });
      const out = await runTool(t.tool, { do: "kick", to: "Ann" });
      expect(t.uninvite).not.toHaveBeenCalled();
      expect(out.text).toContain("REFUSED not_leader");
    });

    test("a party of two with Peon leading disbands on a kick", async () => {
      const t = await world({ members: [ann()] });
      t.uninvite.mockImplementation(() =>
        t.handle.triggerAreaEvent("raid", { type: "disbanded" }),
      );
      const out = await runTool(t.tool, { do: "kick", to: "Ann" });
      expect(out.text).toContain("DONE");
      expect(out.text).toMatch(/disband/i);
    });

    test("fails when the server refuses", async () => {
      const t = await world({ members: [tom(), ann()] });
      t.uninvite.mockImplementation(() =>
        t.handle.triggerAreaEvent("raid", {
          member: "Ann",
          operation: "uninvite",
          result: "not_leader",
          type: "command_result",
        }),
      );
      const out = await runTool(t.tool, { do: "kick", to: "Ann" });
      expect(out.text).toContain("FAILED not_leader");
    });

    test("an ok command result is not a refusal", async () => {
      const t = await world({ members: [tom(), ann()] });
      t.uninvite.mockImplementation(() => {
        t.handle.triggerAreaEvent("raid", {
          member: "Ann",
          operation: "uninvite",
          result: "ok",
          type: "command_result",
        });
        t.handle.triggerAreaEvent("raid", {
          changes: [{ kind: "left", name: "Ann" }],
          group: raidGroup(),
          type: "group_list",
        });
      });
      const out = await runTool(t.tool, { do: "kick", to: "Ann" });
      expect(out.text).toContain("DONE");
    });

    test("stays unconfirmed after 3 s", async () => {
      const t = await world({ members: [tom(), ann()] });
      t.uninvite.mockImplementation(() => elapse(3000));
      const out = await withFakeTimers(() =>
        runTool(t.tool, { do: "kick", to: "Ann" }),
      );
      expect(out.text).toContain("UNCONFIRMED");
      expect(out.text).toContain("Ann");
    });

    test("a send that throws rejects the call", async () => {
      const t = await world({ members: [tom(), ann()] });
      t.uninvite.mockImplementation(() => {
        throw new Error("not in your party: Ann");
      });
      const out = await runTool(t.tool, { do: "kick", to: "Ann" });
      expect(out.text).toContain("FAILED");
    });

    test("an aborted signal ends the wait", async () => {
      const t = await world({ members: [tom(), ann()] });
      const abort = new AbortController();
      abort.abort(new Error("cancelled"));
      await expect(
        groupSpec.run(
          { do: "kick", to: "Ann" },
          toolCtx<GroupAfter>(t, abort.signal),
        ),
      ).rejects.toThrow("cancelled");
      expect(t.uninvite).not.toHaveBeenCalled();
    });
  });
});

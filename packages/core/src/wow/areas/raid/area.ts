import { defineArea } from "#wow/areas/contract";
import { RAID_OPCODES } from "#wow/areas/raid/opcodes";
import { readRaidGroup } from "#wow/areas/raid/protocol";
import {
  parseMinimapPing,
  parseRaidTargetUpdate,
} from "#wow/areas/raid/protocol-marks";
import {
  parseReadyCheckConfirm,
  parseReadyCheckStart,
} from "#wow/areas/raid/protocol-ready";
import { parseSummonRequest } from "#wow/areas/raid/protocol-summon";
import { raidRuntime } from "#wow/areas/raid/runtime";
import { RaidAreaStore } from "#wow/areas/raid/store";
import { parsePartyCommandResult } from "#wow/protocol/group";
import {
  type GroupInviteReceived,
  type GroupList,
  parseGroupInvite,
  parseGroupList,
} from "#wow/protocol/group-list";
import { parsePartyMemberStats } from "#wow/protocol/group-stats";
import { GameOpcode } from "#wow/protocol/opcodes";
import type { PacketReader } from "#wow/protocol/packet";

function receiveList(store: RaidAreaStore, parsed: GroupList): void {
  store.receiveList(readRaidGroup(parsed), parsed.counter);
}

function receiveInvite(
  store: RaidAreaStore,
  parsed: GroupInviteReceived,
): void {
  if (parsed.status === 0) store.receiveInviteBlocked(parsed.name);
}

function receiveCommandResult(store: RaidAreaStore, r: PacketReader): void {
  store.receiveCommandResult(parsePartyCommandResult(r));
}

export const raidArea = defineArea({
  name: "raid",
  opcodes: RAID_OPCODES,
  eventTypes: [
    "group_list",
    "invite_blocked",
    "member_stats",
    "command_result",
    "ready_check_started",
    "ready_check_answer",
    "ready_check_finished",
    "raid_mark",
    "raid_marks",
    "minimap_ping",
    "summon_requested",
    "summon_expired",
  ],
  store: (deps) => new RaidAreaStore(deps.now, deps.selfGuid),
  register: (wire, store) => {
    wire.peek(GameOpcode.SMSG_GROUP_LIST, (r) =>
      receiveList(store, parseGroupList(r)),
    );
    wire.peek(GameOpcode.SMSG_GROUP_INVITE, (r) =>
      receiveInvite(store, parseGroupInvite(r)),
    );
    wire.peek(GameOpcode.SMSG_PARTY_COMMAND_RESULT, (r) =>
      receiveCommandResult(store, r),
    );
    wire.peek(GameOpcode.SMSG_PARTY_MEMBER_STATS, (r) =>
      store.receiveStats(parsePartyMemberStats(r)),
    );
    wire.peek(GameOpcode.SMSG_PARTY_MEMBER_STATS_FULL, (r) =>
      store.receiveStats(parsePartyMemberStats(r, true)),
    );
    wire.on(GameOpcode.MSG_RAID_READY_CHECK, (r) =>
      store.receiveReadyStart(parseReadyCheckStart(r).initiator),
    );
    wire.on(GameOpcode.MSG_RAID_READY_CHECK_CONFIRM, (r) => {
      const confirm = parseReadyCheckConfirm(r);
      store.receiveReadyConfirm(confirm.guid, confirm.ready);
    });
    wire.on(GameOpcode.MSG_RAID_READY_CHECK_FINISHED, () =>
      store.receiveReadyFinished(),
    );
    wire.on(GameOpcode.MSG_RAID_TARGET_UPDATE, (r) =>
      store.receiveTarget(parseRaidTargetUpdate(r)),
    );
    wire.on(GameOpcode.SMSG_SUMMON_REQUEST, (r) =>
      store.receiveSummon(parseSummonRequest(r)),
    );
    wire.on(GameOpcode.MSG_MINIMAP_PING, (r) => {
      const ping = parseMinimapPing(r);
      store.receivePing(ping.guid, ping.x, ping.y);
    });
  },
  runtime: raidRuntime,
});

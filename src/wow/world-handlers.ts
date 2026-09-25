import type { WorldConn } from "wow/client";
import {
  parseDuelComplete,
  parseDuelCountdown,
  parseDuelRequested,
  parseDuelWinner,
} from "wow/protocol/duel";
import {
  parseGroupDecline,
  parseGroupInvite,
  parseGroupList,
  parseGroupSetLeader,
  parsePartyCommandResult,
  parsePartyMemberStats,
} from "wow/protocol/group";
import { GameOpcode } from "wow/protocol/opcodes";
import { joinGuid, type PacketReader, PacketWriter } from "wow/protocol/packet";
import { buildOutgoingPacket } from "wow/protocol/world";

export function sendPacket(
  conn: WorldConn,
  opcode: number,
  body: Uint8Array = new Uint8Array(0),
): void {
  if (!conn.socket) throw new Error("World socket is not connected");
  conn.socket.write(buildOutgoingPacket(opcode, body, conn.arc4));
}

export function selfGuid(conn: WorldConn): bigint {
  return joinGuid(conn.selfGuidLow, conn.selfGuidHigh);
}

export function handleTimeSync(conn: WorldConn, r: PacketReader): void {
  const counter = r.uint32LE();
  const elapsed = Date.now() - conn.startTime;
  const w = new PacketWriter();
  w.uint32LE(counter);
  w.uint32LE(elapsed);
  sendPacket(conn, GameOpcode.CMSG_TIME_SYNC_RESP, w.finish());
}
export function handleDuelRequested(conn: WorldConn, r: PacketReader): void {
  const duel = parseDuelRequested(r);
  conn.duelArbiter = duel.arbiter;
  conn.pendingRequest = "duel";
  const guidLow = Number(duel.initiator & 0xffffffffn);
  const name = conn.nameCache.get(guidLow) ?? "Unknown";
  conn.onDuelEvent?.({ type: "duel_requested", challenger: name });
}

export function handleDuelCountdown(conn: WorldConn, r: PacketReader): void {
  const { timeMs } = parseDuelCountdown(r);
  conn.onDuelEvent?.({ type: "duel_countdown", timeMs });
}

export function handleDuelComplete(conn: WorldConn, r: PacketReader): void {
  const { completed } = parseDuelComplete(r);
  conn.onDuelEvent?.({ type: "duel_complete", completed });
}

export function handleDuelWinner(conn: WorldConn, r: PacketReader): void {
  const { reason, winner, loser } = parseDuelWinner(r);
  conn.duelArbiter = 0n;
  conn.onDuelEvent?.({ type: "duel_winner", reason, winner, loser });
}

export function handleDuelOutOfBounds(conn: WorldConn): void {
  conn.onDuelEvent?.({ type: "duel_out_of_bounds" });
}

export function handleDuelInBounds(conn: WorldConn): void {
  conn.onDuelEvent?.({ type: "duel_in_bounds" });
}

export function handlePartyCommandResult(
  conn: WorldConn,
  r: PacketReader,
): void {
  const result = parsePartyCommandResult(r);
  conn.onGroupEvent?.({
    type: "command_result",
    operation: result.operation,
    target: result.member,
    result: result.result,
  });
}

export function handleGroupInviteReceived(
  conn: WorldConn,
  r: PacketReader,
): void {
  const invite = parseGroupInvite(r);
  conn.pendingRequest = "group";
  conn.onGroupEvent?.({ type: "invite_received", from: invite.name });
}

export function handleGroupSetLeaderMsg(
  conn: WorldConn,
  r: PacketReader,
): void {
  const { name } = parseGroupSetLeader(r);
  conn.onGroupEvent?.({ type: "leader_changed", name });
}

export function handleGroupListMsg(conn: WorldConn, r: PacketReader): void {
  const list = parseGroupList(r);
  conn.partyMembers.clear();
  let leaderName = "";
  if (
    conn.selfGuidLow === list.leaderGuidLow &&
    conn.selfGuidHigh === list.leaderGuidHigh
  ) {
    leaderName = conn.selfName;
  }
  for (const m of list.members) {
    conn.partyMembers.set(m.name, {
      guidLow: m.guidLow,
      guidHigh: m.guidHigh,
    });
    if (
      m.guidLow === list.leaderGuidLow &&
      m.guidHigh === list.leaderGuidHigh
    ) {
      leaderName = m.name;
    }
  }
  conn.onGroupEvent?.({
    type: "group_list",
    members: list.members,
    leader: leaderName,
  });
}

export function handleGroupDestroyed(conn: WorldConn): void {
  conn.partyMembers.clear();
  conn.onGroupEvent?.({ type: "group_destroyed" });
}

export function handleGroupUninvite(conn: WorldConn): void {
  conn.partyMembers.clear();
  conn.onGroupEvent?.({ type: "kicked" });
}

export function handleGroupDeclineMsg(conn: WorldConn, r: PacketReader): void {
  const { name } = parseGroupDecline(r);
  conn.onGroupEvent?.({ type: "invite_declined", name });
}
export function handlePartyMemberStatsMsg(
  conn: WorldConn,
  r: PacketReader,
  isFull = false,
): void {
  const stats = parsePartyMemberStats(r, isFull);
  conn.onGroupEvent?.({
    type: "member_stats",
    guidLow: stats.guidLow,
    online: stats.online,
    hp: stats.hp,
    maxHp: stats.maxHp,
    level: stats.level,
  });
}

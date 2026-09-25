import type { WorldConn } from "wow/client";
import type { GuildMember } from "wow/guild-store";
import {
  GuildCommandResult,
  GuildEventCode,
  parseGuildCommandResult,
  parseGuildEvent,
  parseGuildInvitePacket,
  parseGuildQueryResponse,
  parseGuildRoster,
} from "wow/protocol/guild";
import type { PacketReader } from "wow/protocol/packet";

export function handleGuildRoster(conn: WorldConn, r: PacketReader): void {
  const raw = parseGuildRoster(r);
  const members: GuildMember[] = raw.members.map((m) => ({ ...m }));
  conn.guildStore.setRoster(raw.motd, raw.guildInfo, members);
}

export function handleGuildQueryResponse(
  conn: WorldConn,
  r: PacketReader,
): void {
  const result = parseGuildQueryResponse(r);
  conn.guildStore.setGuildMeta(result.name, result.rankNames);
}

export function handleGuildEvent(conn: WorldConn, r: PacketReader): void {
  const raw = parseGuildEvent(r);
  const param = (index: number): string => raw.params[index] ?? "";
  switch (raw.eventType) {
    case GuildEventCode.PROMOTION:
      conn.onGuildEvent?.({
        type: "promotion",
        officer: param(0),
        member: param(1),
        rank: param(2),
      });
      break;
    case GuildEventCode.DEMOTION:
      conn.onGuildEvent?.({
        type: "demotion",
        officer: param(0),
        member: param(1),
        rank: param(2),
      });
      break;
    case GuildEventCode.REMOVED:
      conn.onGuildEvent?.({
        type: "removed",
        member: param(0),
        officer: param(1),
      });
      break;
    case GuildEventCode.LEADER_CHANGED:
      conn.onGuildEvent?.({
        type: "leader_changed",
        oldLeader: param(0),
        newLeader: param(1),
      });
      break;
    default:
      emitGuildNotice(conn, raw.eventType, param);
      break;
  }
}

function emitGuildNotice(
  conn: WorldConn,
  eventType: number,
  param: (index: number) => string,
): void {
  switch (eventType) {
    case GuildEventCode.MOTD:
      conn.onGuildEvent?.({ type: "motd", text: param(0) });
      break;
    case GuildEventCode.JOINED:
      conn.onGuildEvent?.({ type: "joined", name: param(0) });
      break;
    case GuildEventCode.LEFT:
      conn.onGuildEvent?.({ type: "left", name: param(0) });
      break;
    case GuildEventCode.LEADER_IS:
      conn.onGuildEvent?.({ type: "leader_is", name: param(0) });
      break;
    case GuildEventCode.DISBANDED:
      conn.onGuildEvent?.({ type: "disbanded" });
      break;
    case GuildEventCode.SIGNED_ON:
      conn.onGuildEvent?.({ type: "signed_on", name: param(0) });
      break;
    case GuildEventCode.SIGNED_OFF:
      conn.onGuildEvent?.({ type: "signed_off", name: param(0) });
      break;
    default:
      break;
  }
}

export function handleGuildCommandResult(
  conn: WorldConn,
  r: PacketReader,
): void {
  const packet = parseGuildCommandResult(r);
  if (packet.result !== GuildCommandResult.PLAYER_NO_MORE_IN_GUILD) {
    conn.onGuildEvent?.({
      type: "command_result",
      command: packet.command,
      name: packet.name,
      result: packet.result,
    });
  }
}

export function handleGuildInvitePacket(
  conn: WorldConn,
  r: PacketReader,
): void {
  const packet = parseGuildInvitePacket(r);
  conn.onGuildEvent?.({
    type: "guild_invite",
    inviter: packet.inviterName,
    guildName: packet.guildName,
  });
}

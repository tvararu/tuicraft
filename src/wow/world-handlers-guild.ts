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
      conn.events.guild.emit({
        type: "promotion",
        officer: param(0),
        member: param(1),
        rank: param(2),
      });
      break;
    case GuildEventCode.DEMOTION:
      conn.events.guild.emit({
        type: "demotion",
        officer: param(0),
        member: param(1),
        rank: param(2),
      });
      break;
    case GuildEventCode.REMOVED:
      conn.events.guild.emit({
        type: "removed",
        member: param(0),
        officer: param(1),
      });
      break;
    case GuildEventCode.LEADER_CHANGED:
      conn.events.guild.emit({
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
      conn.events.guild.emit({ type: "motd", text: param(0) });
      break;
    case GuildEventCode.JOINED:
      conn.events.guild.emit({ type: "joined", name: param(0) });
      break;
    case GuildEventCode.LEFT:
      conn.events.guild.emit({ type: "left", name: param(0) });
      break;
    case GuildEventCode.LEADER_IS:
      conn.events.guild.emit({ type: "leader_is", name: param(0) });
      break;
    case GuildEventCode.DISBANDED:
      conn.events.guild.emit({ type: "disbanded" });
      break;
    case GuildEventCode.SIGNED_ON:
      conn.events.guild.emit({ type: "signed_on", name: param(0) });
      break;
    case GuildEventCode.SIGNED_OFF:
      conn.events.guild.emit({ type: "signed_off", name: param(0) });
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
    conn.events.guild.emit({
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
  conn.events.guild.emit({
    type: "guild_invite",
    inviter: packet.inviterName,
    guildName: packet.guildName,
  });
}

import type { WorldHandle } from "wow/client";
import type { GuildRoster } from "wow/guild-store";
import {
  buildJoinChannel,
  buildLeaveChannel,
  buildRandomRoll,
} from "wow/protocol/chat";
import { buildDuelAccepted, buildDuelCancelled } from "wow/protocol/duel";
import {
  buildGroupAccept,
  buildGroupDecline,
  buildGroupDisband,
  buildGroupInvite,
  buildGroupSetLeader,
  buildGroupUninvite,
} from "wow/protocol/group";
import {
  buildGuildDemote,
  buildGuildInvite,
  buildGuildLeader,
  buildGuildMotd,
  buildGuildPromote,
  buildGuildQuery,
  buildGuildRemove,
} from "wow/protocol/guild";
import { ChatType, GameOpcode } from "wow/protocol/opcodes";
import type { PacketReader } from "wow/protocol/packet";
import {
  buildAddFriend,
  buildAddIgnore,
  buildDelFriend,
  buildDelIgnore,
} from "wow/protocol/social";
import type { WorldConn } from "wow/world-conn";
import { sendPacket } from "wow/world-handlers";
import {
  handleGuildQueryResponse,
  handleGuildRoster,
} from "wow/world-handlers-guild";

function notify(conn: WorldConn, message: string): void {
  conn.events.message.emit({ type: ChatType.SYSTEM, sender: "", message });
}
function acceptPending(conn: WorldConn): void {
  if (conn.pendingRequest === "duel") {
    sendPacket(
      conn,
      GameOpcode.CMSG_DUEL_ACCEPTED,
      buildDuelAccepted(conn.duelArbiter),
    );
  } else if (conn.pendingRequest === "group") {
    sendPacket(conn, GameOpcode.CMSG_GROUP_ACCEPT, buildGroupAccept());
  } else {
    notify(conn, "Nothing to accept.");
  }
  conn.pendingRequest = null;
}

function declinePending(conn: WorldConn): void {
  if (conn.pendingRequest === "duel") {
    sendPacket(
      conn,
      GameOpcode.CMSG_DUEL_CANCELLED,
      buildDuelCancelled(conn.duelArbiter),
    );
  } else if (conn.pendingRequest === "group") {
    sendPacket(conn, GameOpcode.CMSG_GROUP_DECLINE, buildGroupDecline());
  } else {
    notify(conn, "Nothing to decline.");
  }
  conn.pendingRequest = null;
}

export function groupMethods(conn: WorldConn) {
  return {
    invite(name) {
      sendPacket(conn, GameOpcode.CMSG_GROUP_INVITE, buildGroupInvite(name));
    },
    uninvite(name) {
      sendPacket(
        conn,
        GameOpcode.CMSG_GROUP_UNINVITE,
        buildGroupUninvite(name),
      );
    },
    leaveGroup() {
      sendPacket(conn, GameOpcode.CMSG_GROUP_DISBAND, buildGroupDisband());
    },
    joinChannel(name, password) {
      sendPacket(
        conn,
        GameOpcode.CMSG_JOIN_CHANNEL,
        buildJoinChannel(name, password),
      );
    },
    leaveChannel(name) {
      sendPacket(conn, GameOpcode.CMSG_LEAVE_CHANNEL, buildLeaveChannel(name));
    },
    setLeader(name) {
      const member = conn.partyMembers.get(name);
      if (!member) {
        notify(conn, `"${name}" is not in your party.`);
        return;
      }
      sendPacket(
        conn,
        GameOpcode.CMSG_GROUP_SET_LEADER,
        buildGroupSetLeader(member.guidLow, member.guidHigh),
      );
    },
    acceptInvite() {
      acceptPending(conn);
    },
    declineInvite() {
      declinePending(conn);
    },
    onGroupEvent(cb) {
      return conn.events.group.subscribe(cb);
    },
  } satisfies Partial<WorldHandle>;
}

export function socialMethods(conn: WorldConn) {
  return {
    onEntityEvent(cb) {
      return conn.events.entity.subscribe(cb);
    },
    onPacketError(cb) {
      return conn.events.packetError.subscribe(cb);
    },
    getNearbyEntities() {
      return conn.entityStore.all();
    },
    getFriends() {
      return conn.friendStore.all();
    },
    addFriend(name) {
      sendPacket(conn, GameOpcode.CMSG_ADD_FRIEND, buildAddFriend(name, ""));
    },
    removeFriend(name) {
      const friend = conn.friendStore.findByName(name);
      if (!friend) {
        notify(conn, `"${name}" is not on your friends list.`);
        return;
      }
      sendPacket(conn, GameOpcode.CMSG_DEL_FRIEND, buildDelFriend(friend.guid));
    },
    sendRoll(min, max) {
      sendPacket(conn, GameOpcode.MSG_RANDOM_ROLL, buildRandomRoll(min, max));
    },
    onFriendEvent(cb) {
      return conn.events.friend.subscribe(cb);
    },
  } satisfies Partial<WorldHandle>;
}

export function ignoreMethods(conn: WorldConn) {
  return {
    getIgnored() {
      return conn.ignoreStore.all();
    },
    addIgnore(name) {
      sendPacket(conn, GameOpcode.CMSG_ADD_IGNORE, buildAddIgnore(name));
    },
    removeIgnore(name) {
      const entry = conn.ignoreStore.findByName(name);
      if (!entry) {
        notify(conn, `"${name}" is not on your ignore list.`);
        return;
      }
      sendPacket(conn, GameOpcode.CMSG_DEL_IGNORE, buildDelIgnore(entry.guid));
    },
    onIgnoreEvent(cb) {
      return conn.events.ignore.subscribe(cb);
    },
  } satisfies Partial<WorldHandle>;
}

async function requestGuildRoster(
  conn: WorldConn,
): Promise<GuildRoster | undefined> {
  sendPacket(conn, GameOpcode.CMSG_GUILD_ROSTER);
  const rosterPromise = conn.dispatch.expect(GameOpcode.SMSG_GUILD_ROSTER);
  let queryPromise: Promise<PacketReader> | undefined;
  if (conn.guildId) {
    sendPacket(
      conn,
      GameOpcode.CMSG_GUILD_QUERY,
      buildGuildQuery(conn.guildId),
    );
    queryPromise = conn.dispatch.expect(GameOpcode.SMSG_GUILD_QUERY_RESPONSE);
  }
  const [rosterReader, queryReader] = await Promise.all([
    rosterPromise,
    queryPromise ?? Promise.resolve(undefined),
  ]);
  handleGuildRoster(conn, rosterReader);
  if (queryReader) handleGuildQueryResponse(conn, queryReader);
  return conn.guildStore.get();
}

export function guildMethods(conn: WorldConn) {
  return {
    requestGuildRoster() {
      return requestGuildRoster(conn);
    },
    onGuildEvent(cb) {
      return conn.events.guild.subscribe(cb);
    },
    guildInvite(name) {
      sendPacket(conn, GameOpcode.CMSG_GUILD_INVITE, buildGuildInvite(name));
    },
    guildRemove(name) {
      sendPacket(conn, GameOpcode.CMSG_GUILD_REMOVE, buildGuildRemove(name));
    },
    guildLeave() {
      sendPacket(conn, GameOpcode.CMSG_GUILD_LEAVE);
    },
    guildPromote(name) {
      sendPacket(conn, GameOpcode.CMSG_GUILD_PROMOTE, buildGuildPromote(name));
    },
    guildDemote(name) {
      sendPacket(conn, GameOpcode.CMSG_GUILD_DEMOTE, buildGuildDemote(name));
    },
    guildLeader(name) {
      sendPacket(conn, GameOpcode.CMSG_GUILD_LEADER, buildGuildLeader(name));
    },
    guildMotd(motd) {
      sendPacket(conn, GameOpcode.CMSG_GUILD_MOTD, buildGuildMotd(motd));
    },
    acceptGuildInvite() {
      sendPacket(conn, GameOpcode.CMSG_GUILD_ACCEPT);
    },
    declineGuildInvite() {
      sendPacket(conn, GameOpcode.CMSG_GUILD_DECLINE);
    },
    onDuelEvent(cb) {
      return conn.events.duel.subscribe(cb);
    },
  } satisfies Partial<WorldHandle>;
}

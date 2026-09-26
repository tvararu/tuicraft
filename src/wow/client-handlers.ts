import {
  registerCombatHandlers,
  registerLootHandlers,
  registerQuestHandlers,
  registerRecoveryHandlers,
  registerTrainerHandlers,
  registerVendorHandlers,
} from "wow/gameplay-handlers";
import { registerMovementHandlers } from "wow/movement-handlers";
import { ChatType, GameOpcode } from "wow/protocol/opcodes";
import type { PacketReader } from "wow/protocol/packet";
import { registerStubs } from "wow/protocol/stubs";
import type { WorldConn } from "wow/world-conn";
import {
  handleDuelComplete,
  handleDuelCountdown,
  handleDuelInBounds,
  handleDuelOutOfBounds,
  handleDuelRequested,
  handleDuelWinner,
  handleGroupDeclineMsg,
  handleGroupDestroyed,
  handleGroupInviteReceived,
  handleGroupListMsg,
  handleGroupSetLeaderMsg,
  handleGroupUninvite,
  handlePartyCommandResult,
  handlePartyMemberStatsMsg,
  handleTimeSync,
} from "wow/world-handlers";
import {
  handleChannelNotify,
  handleChatMessage,
  handleChatRestricted,
  handleChatWrongFaction,
  handleGmChatMessage,
  handleMotd,
  handleNameQueryResponse,
  handleNotification,
  handlePlayerNotFound,
  handleRandomRoll,
  handleReceivedMail,
  handleServerBroadcast,
} from "wow/world-handlers-chat";
import {
  handleCompressedUpdateObject,
  handleCreatureQueryResponse,
  handleDestroyObject,
  handleGameObjectQueryResponse,
  handleUpdateObject,
} from "wow/world-handlers-entity";
import {
  handleGuildCommandResult,
  handleGuildEvent,
  handleGuildInvitePacket,
  handleGuildQueryResponse,
  handleGuildRoster,
} from "wow/world-handlers-guild";
import {
  handleContactList,
  handleFriendStatus,
} from "wow/world-handlers-social";

function registerChatHandlers(conn: WorldConn): void {
  const on = (opcode: number, handle: (r: PacketReader) => void) =>
    conn.dispatch.on(opcode, handle);
  on(GameOpcode.SMSG_TIME_SYNC_REQ, (r) => handleTimeSync(conn, r));
  on(GameOpcode.SMSG_MESSAGE_CHAT, (r) => handleChatMessage(conn, r));
  on(GameOpcode.SMSG_GM_MESSAGECHAT, (r) => handleGmChatMessage(conn, r));
  on(GameOpcode.SMSG_NAME_QUERY_RESPONSE, (r) =>
    handleNameQueryResponse(conn, r),
  );
  on(GameOpcode.SMSG_MOTD, (r) => handleMotd(conn, r));
  on(GameOpcode.SMSG_CHAT_PLAYER_NOT_FOUND, (r) =>
    handlePlayerNotFound(conn, r),
  );
  on(GameOpcode.SMSG_CHAT_RESTRICTED, (r) => handleChatRestricted(conn, r));
  on(GameOpcode.SMSG_CHAT_WRONG_FACTION, () => handleChatWrongFaction(conn));
  on(GameOpcode.SMSG_CHANNEL_NOTIFY, (r) => handleChannelNotify(conn, r));
  on(GameOpcode.SMSG_CHAT_SERVER_MESSAGE, (r) =>
    handleServerBroadcast(conn, r),
  );
  on(GameOpcode.SMSG_NOTIFICATION, (r) => handleNotification(conn, r));
  on(GameOpcode.SMSG_RECEIVED_MAIL, (r) => handleReceivedMail(conn, r));
}

function registerPartyHandlers(conn: WorldConn): void {
  const on = (opcode: number, handle: (r: PacketReader) => void) =>
    conn.dispatch.on(opcode, handle);
  on(GameOpcode.SMSG_DUEL_REQUESTED, (r) => handleDuelRequested(conn, r));
  on(GameOpcode.SMSG_DUEL_COUNTDOWN, (r) => handleDuelCountdown(conn, r));
  on(GameOpcode.SMSG_DUEL_COMPLETE, (r) => handleDuelComplete(conn, r));
  on(GameOpcode.SMSG_DUEL_WINNER, (r) => handleDuelWinner(conn, r));
  on(GameOpcode.SMSG_DUEL_OUTOFBOUNDS, () => handleDuelOutOfBounds(conn));
  on(GameOpcode.SMSG_DUEL_INBOUNDS, () => handleDuelInBounds(conn));
  on(GameOpcode.SMSG_PARTY_COMMAND_RESULT, (r) =>
    handlePartyCommandResult(conn, r),
  );
  on(GameOpcode.SMSG_GROUP_INVITE, (r) => handleGroupInviteReceived(conn, r));
  on(GameOpcode.SMSG_GROUP_SET_LEADER, (r) => handleGroupSetLeaderMsg(conn, r));
  on(GameOpcode.SMSG_GROUP_LIST, (r) => handleGroupListMsg(conn, r));
  on(GameOpcode.SMSG_GROUP_DESTROYED, () => handleGroupDestroyed(conn));
  on(GameOpcode.SMSG_GROUP_UNINVITE, () => handleGroupUninvite(conn));
  on(GameOpcode.SMSG_GROUP_DECLINE, (r) => handleGroupDeclineMsg(conn, r));
  on(GameOpcode.SMSG_PARTY_MEMBER_STATS, (r) =>
    handlePartyMemberStatsMsg(conn, r),
  );
  on(GameOpcode.SMSG_PARTY_MEMBER_STATS_FULL, (r) =>
    handlePartyMemberStatsMsg(conn, r, true),
  );
}

function registerObjectHandlers(conn: WorldConn): void {
  const on = (opcode: number, handle: (r: PacketReader) => void) =>
    conn.dispatch.on(opcode, handle);
  on(GameOpcode.SMSG_UPDATE_OBJECT, (r) => handleUpdateObject(conn, r));
  on(GameOpcode.SMSG_COMPRESSED_UPDATE_OBJECT, (r) =>
    handleCompressedUpdateObject(conn, r),
  );
  on(GameOpcode.SMSG_DESTROY_OBJECT, (r) => handleDestroyObject(conn, r));
  on(GameOpcode.SMSG_CREATURE_QUERY_RESPONSE, (r) =>
    handleCreatureQueryResponse(conn, r),
  );
  on(GameOpcode.SMSG_GAMEOBJECT_QUERY_RESPONSE, (r) =>
    handleGameObjectQueryResponse(conn, r),
  );
  on(GameOpcode.MSG_RANDOM_ROLL, (r) => handleRandomRoll(conn, r));
  on(GameOpcode.SMSG_CONTACT_LIST, (r) => handleContactList(conn, r));
  on(GameOpcode.SMSG_FRIEND_STATUS, (r) => handleFriendStatus(conn, r));
  on(GameOpcode.SMSG_GUILD_ROSTER, (r) => handleGuildRoster(conn, r));
  on(GameOpcode.SMSG_GUILD_QUERY_RESPONSE, (r) =>
    handleGuildQueryResponse(conn, r),
  );
  on(GameOpcode.SMSG_GUILD_EVENT, (r) => handleGuildEvent(conn, r));
  on(GameOpcode.SMSG_GUILD_COMMAND_RESULT, (r) =>
    handleGuildCommandResult(conn, r),
  );
  on(GameOpcode.SMSG_GUILD_INVITE, (r) => handleGuildInvitePacket(conn, r));
}

export function registerGameHandlers(conn: WorldConn): void {
  registerChatHandlers(conn);
  registerPartyHandlers(conn);
  registerObjectHandlers(conn);
  registerMovementHandlers(conn);
  registerCombatHandlers(conn);
  registerQuestHandlers(conn);
  registerLootHandlers(conn);
  registerRecoveryHandlers(conn);
  registerTrainerHandlers(conn);
  registerVendorHandlers(conn);
}

export function registerWorldHandlers(conn: WorldConn): void {
  registerGameHandlers(conn);
  registerStubs(conn.dispatch, (msg) => {
    if (conn.events.message.size === 0) return false;
    conn.events.message.emit({
      type: ChatType.SYSTEM,
      sender: "",
      message: msg,
    });
    return true;
  });
}

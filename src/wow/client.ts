import type { Socket } from "bun";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { Arc4 } from "wow/crypto/arc4";
import { GameOpcode, ChatType, Language } from "wow/protocol/opcodes";
import {
  buildChatMessage,
  buildWhoRequest,
  parseWhoResponse,
  buildRandomRoll,
  type ChatMessage as RawChatMessage,
  type WhoResult,
} from "wow/protocol/chat";
import {
  buildWorldAuthPacket,
  parseCharacterList,
  OpcodeDispatch,
  AccumulatorBuffer,
  INCOMING_HEADER_SIZE,
  buildOutgoingPacket,
  decryptIncomingHeader,
} from "wow/protocol/world";
import {
  buildGroupInvite,
  buildGroupAccept,
  buildGroupDecline,
  buildGroupUninvite,
  buildGroupDisband,
  buildGroupSetLeader,
} from "wow/protocol/group";
import { registerStubs } from "wow/protocol/stubs";
import { EntityStore, type Entity, type EntityEvent } from "wow/entity-store";
import {
  FriendStore,
  type FriendEntry,
  type FriendEvent,
} from "wow/friend-store";
import { buildAddFriend, buildDelFriend } from "wow/protocol/social";
import {
  sendPacket,
  handleTimeSync,
  handleChatMessage,
  handleGmChatMessage,
  handleNameQueryResponse,
  handleMotd,
  handlePlayerNotFound,
  handleChatRestricted,
  handleChatWrongFaction,
  handleChannelNotify,
  handleServerBroadcast,
  handleNotification,
  handlePartyCommandResult,
  handleGroupInviteReceived,
  handleGroupSetLeaderMsg,
  handleGroupListMsg,
  handleGroupDestroyed,
  handleGroupUninvite,
  handleGroupDeclineMsg,
  handleRandomRoll,
  handleUpdateObject,
  handleCompressedUpdateObject,
  handleDestroyObject,
  handleCreatureQueryResponse,
  handleGameObjectQueryResponse,
  handlePartyMemberStatsMsg,
  handleContactList,
  handleFriendStatus,
} from "wow/world-handlers";

export type ClientConfig = {
  host: string;
  port: number;
  account: string;
  password: string;
  character: string;
  srpPrivateKey?: bigint;
  clientSeed?: Uint8Array;
  pingIntervalMs?: number;
  language?: number;
  cachedSessionKey?: Uint8Array;
};

import type { AuthResult } from "wow/auth";
export { authHandshake, authWithRetry, ReconnectRequiredError } from "wow/auth";
export type { AuthResult } from "wow/auth";

export type ChatMessage = {
  type: number;
  sender: string;
  message: string;
  channel?: string;
  origin?: "server" | "notification";
};

export type GroupEvent =
  | { type: "invite_received"; from: string }
  | {
      type: "command_result";
      operation: number;
      target: string;
      result: number;
    }
  | { type: "leader_changed"; name: string }
  | {
      type: "group_list";
      members: Array<{
        name: string;
        guidLow: number;
        guidHigh: number;
        online: boolean;
      }>;
      leader: string;
    }
  | { type: "group_destroyed" }
  | { type: "kicked" }
  | { type: "invite_declined"; name: string }
  | {
      type: "member_stats";
      guidLow: number;
      online?: boolean;
      hp?: number;
      maxHp?: number;
      level?: number;
    };

export type { WhoResult };
export type { Entity, EntityEvent };
export type { FriendEntry, FriendEvent };

export type ChatMode =
  | { type: "say" }
  | { type: "yell" }
  | { type: "guild" }
  | { type: "party" }
  | { type: "raid" }
  | { type: "emote" }
  | { type: "whisper"; target: string }
  | { type: "channel"; channel: string };

export type WorldHandle = {
  closed: Promise<void>;
  close(): void;
  onMessage(cb: (msg: ChatMessage) => void): void;
  sendWhisper(target: string, message: string): void;
  sendSay(message: string): void;
  sendYell(message: string): void;
  sendGuild(message: string): void;
  sendParty(message: string): void;
  sendRaid(message: string): void;
  sendEmote(message: string): void;
  sendDnd(message: string): void;
  sendAfk(message: string): void;
  sendChannel(channel: string, message: string): void;
  getChannel(index: number): string | undefined;
  who(opts?: {
    name?: string;
    minLevel?: number;
    maxLevel?: number;
  }): Promise<WhoResult[]>;
  getLastChatMode(): ChatMode;
  setLastChatMode(mode: ChatMode): void;
  sendInCurrentMode(message: string): void;
  invite(name: string): void;
  uninvite(name: string): void;
  leaveGroup(): void;
  setLeader(name: string): void;
  acceptInvite(): void;
  declineInvite(): void;
  onGroupEvent(cb: (event: GroupEvent) => void): void;
  onEntityEvent(cb: (event: EntityEvent) => void): void;
  onPacketError(cb: (opcode: number, err: Error) => void): void;
  getNearbyEntities(): Entity[];
  getFriends(): FriendEntry[];
  addFriend(name: string): void;
  removeFriend(name: string): void;
  sendRoll(min: number, max: number): void;
  onFriendEvent(cb: (event: FriendEvent) => void): void;
};

export type WorldConn = {
  socket: Socket;
  dispatch: OpcodeDispatch;
  buf: AccumulatorBuffer;
  arc4?: Arc4;
  startTime: number;
  pendingHeader?: { size: number; opcode: number };
  nameCache: Map<number, string>;
  pendingMessages: Map<number, RawChatMessage[]>;
  channels: string[];
  lastChatMode: ChatMode;
  onMessage?: (msg: ChatMessage) => void;
  selfName: string;
  selfGuidLow: number;
  selfGuidHigh: number;
  partyMembers: Map<string, { guidLow: number; guidHigh: number }>;
  onGroupEvent?: (event: GroupEvent) => void;
  entityStore: EntityStore;
  creatureNameCache: Map<number, string>;
  gameObjectNameCache: Map<number, string>;
  onEntityEvent?: (event: EntityEvent) => void;
  onPacketError?: (opcode: number, err: Error) => void;
  pendingNameQueries: Set<string>;
  friendStore: FriendStore;
  onFriendEvent?: (event: FriendEvent) => void;
};

function drainWorldPackets(conn: WorldConn): void {
  while (true) {
    if (!conn.pendingHeader) {
      if (conn.buf.length < INCOMING_HEADER_SIZE) break;
      conn.pendingHeader = decryptIncomingHeader(
        conn.buf.drain(INCOMING_HEADER_SIZE),
        conn.arc4,
      );
    }
    const bodySize = conn.pendingHeader.size - 2;
    if (conn.buf.length < bodySize) break;

    const { opcode } = conn.pendingHeader;
    conn.pendingHeader = undefined;
    try {
      conn.dispatch.handle(opcode, new PacketReader(conn.buf.drain(bodySize)));
    } catch (err) {
      if (err instanceof Error) {
        conn.onPacketError?.(opcode, err);
      }
    }
  }
}

async function authenticateWorld(
  conn: WorldConn,
  config: ClientConfig,
  auth: AuthResult,
): Promise<void> {
  const challenge = await conn.dispatch.expect(GameOpcode.SMSG_AUTH_CHALLENGE);
  challenge.uint32LE();
  const serverSeed = challenge.bytes(4);

  const body = await buildWorldAuthPacket(
    config.account,
    auth.sessionKey,
    serverSeed,
    auth.realmId,
    config.clientSeed,
  );
  conn.socket.write(buildOutgoingPacket(GameOpcode.CMSG_AUTH_SESSION, body));
  conn.arc4 = new Arc4(auth.sessionKey);

  const resp = await conn.dispatch.expect(GameOpcode.SMSG_AUTH_RESPONSE);
  const status = resp.uint8();
  if (status !== 0x0c) {
    const names: Record<number, string> = {
      0x0d: "system error",
      0x15: "account in use",
    };
    const label = names[status] ?? `status 0x${status.toString(16)}`;
    throw new Error(`World auth failed: ${label}`);
  }
}

async function selectCharacter(
  conn: WorldConn,
  config: ClientConfig,
): Promise<void> {
  sendPacket(conn, GameOpcode.CMSG_CHAR_ENUM);

  const enumReader = await conn.dispatch.expect(GameOpcode.SMSG_CHAR_ENUM);
  const chars = parseCharacterList(enumReader);
  const char = chars.find(
    (c) => c.name.toLowerCase() === config.character.toLowerCase(),
  );
  if (!char) {
    throw new Error(
      `Character "${config.character}" not found. Available: ${chars.map((c) => c.name).join(", ")}`,
    );
  }

  conn.selfName = char.name;
  conn.selfGuidLow = char.guidLow;
  conn.selfGuidHigh = char.guidHigh;

  const w = new PacketWriter();
  w.uint32LE(char.guidLow);
  w.uint32LE(char.guidHigh);
  sendPacket(conn, GameOpcode.CMSG_PLAYER_LOGIN, w.finish());

  await conn.dispatch.expect(GameOpcode.SMSG_LOGIN_VERIFY_WORLD);
}

function startPingLoop(
  conn: WorldConn,
  intervalMs: number,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const w = new PacketWriter();
    w.uint32LE(0);
    w.uint32LE(0);
    sendPacket(conn, GameOpcode.CMSG_PING, w.finish());
  }, intervalMs);
}

export function worldSession(
  config: ClientConfig,
  auth: AuthResult,
): Promise<WorldHandle> {
  return new Promise((resolve, reject) => {
    const conn: WorldConn = {
      socket: undefined!,
      dispatch: new OpcodeDispatch(),
      buf: new AccumulatorBuffer(),
      startTime: Date.now(),
      nameCache: new Map(),
      pendingMessages: new Map(),
      channels: [],
      lastChatMode: { type: "say" },
      selfName: "",
      selfGuidLow: 0,
      selfGuidHigh: 0,
      partyMembers: new Map(),
      entityStore: new EntityStore(),
      creatureNameCache: new Map(),
      gameObjectNameCache: new Map(),
      pendingNameQueries: new Set(),
      friendStore: new FriendStore(),
    };
    conn.entityStore.onEvent((event) => conn.onEntityEvent?.(event));
    conn.friendStore.onEvent((event) => conn.onFriendEvent?.(event));

    let pingInterval: ReturnType<typeof setInterval>;
    let done = false;
    let closedResolve: () => void;
    const closed = new Promise<void>((r) => {
      closedResolve = r;
    });

    conn.dispatch.on(GameOpcode.SMSG_TIME_SYNC_REQ, (r) =>
      handleTimeSync(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_MESSAGE_CHAT, (r) =>
      handleChatMessage(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_GM_MESSAGECHAT, (r) =>
      handleGmChatMessage(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_NAME_QUERY_RESPONSE, (r) =>
      handleNameQueryResponse(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_MOTD, (r) => handleMotd(conn, r));
    conn.dispatch.on(GameOpcode.SMSG_CHAT_PLAYER_NOT_FOUND, (r) =>
      handlePlayerNotFound(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_CHAT_RESTRICTED, (r) =>
      handleChatRestricted(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_CHAT_WRONG_FACTION, () =>
      handleChatWrongFaction(conn),
    );
    conn.dispatch.on(GameOpcode.SMSG_CHANNEL_NOTIFY, (r) =>
      handleChannelNotify(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_CHAT_SERVER_MESSAGE, (r) =>
      handleServerBroadcast(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_NOTIFICATION, (r) =>
      handleNotification(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_PARTY_COMMAND_RESULT, (r) =>
      handlePartyCommandResult(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_GROUP_INVITE, (r) =>
      handleGroupInviteReceived(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_GROUP_SET_LEADER, (r) =>
      handleGroupSetLeaderMsg(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_GROUP_LIST, (r) =>
      handleGroupListMsg(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_GROUP_DESTROYED, () =>
      handleGroupDestroyed(conn),
    );
    conn.dispatch.on(GameOpcode.SMSG_GROUP_UNINVITE, () =>
      handleGroupUninvite(conn),
    );
    conn.dispatch.on(GameOpcode.SMSG_GROUP_DECLINE, (r) =>
      handleGroupDeclineMsg(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_PARTY_MEMBER_STATS, (r) =>
      handlePartyMemberStatsMsg(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_PARTY_MEMBER_STATS_FULL, (r) =>
      handlePartyMemberStatsMsg(conn, r, true),
    );
    conn.dispatch.on(GameOpcode.SMSG_UPDATE_OBJECT, (r) =>
      handleUpdateObject(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_COMPRESSED_UPDATE_OBJECT, (r) =>
      handleCompressedUpdateObject(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_DESTROY_OBJECT, (r) =>
      handleDestroyObject(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_CREATURE_QUERY_RESPONSE, (r) =>
      handleCreatureQueryResponse(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_GAMEOBJECT_QUERY_RESPONSE, (r) =>
      handleGameObjectQueryResponse(conn, r),
    );

    conn.dispatch.on(GameOpcode.MSG_RANDOM_ROLL, (r) =>
      handleRandomRoll(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_CONTACT_LIST, (r) =>
      handleContactList(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_FRIEND_STATUS, (r) =>
      handleFriendStatus(conn, r),
    );

    registerStubs(conn.dispatch, (msg) => {
      if (!conn.onMessage) return false;
      conn.onMessage({
        type: ChatType.SYSTEM,
        sender: "",
        message: msg,
      });
      return true;
    });

    async function login() {
      await authenticateWorld(conn, config, auth);
      await selectCharacter(conn, config);
      pingInterval = startPingLoop(conn, config.pingIntervalMs ?? 30_000);
      const lang = config.language ?? Language.COMMON;
      done = true;
      const handle: WorldHandle = {
        closed,
        close() {
          clearInterval(pingInterval);
          conn.onEntityEvent = undefined;
          conn.onFriendEvent = undefined;
          conn.socket.end();
        },
        onMessage(cb) {
          conn.onMessage = cb;
        },
        sendWhisper(target, message) {
          if (target) conn.lastChatMode = { type: "whisper", target };
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.WHISPER, lang, message, target),
          );
        },
        sendSay(message) {
          conn.lastChatMode = { type: "say" };
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.SAY, lang, message),
          );
        },
        sendYell(message) {
          conn.lastChatMode = { type: "yell" };
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.YELL, lang, message),
          );
        },
        sendGuild(message) {
          conn.lastChatMode = { type: "guild" };
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.GUILD, lang, message),
          );
        },
        sendParty(message) {
          conn.lastChatMode = { type: "party" };
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.PARTY, lang, message),
          );
        },
        sendRaid(message) {
          conn.lastChatMode = { type: "raid" };
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.RAID, lang, message),
          );
        },
        sendEmote(message) {
          conn.lastChatMode = { type: "emote" };
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.EMOTE, lang, message),
          );
        },
        sendDnd(message) {
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.DND, lang, message),
          );
        },
        sendAfk(message) {
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.AFK, lang, message),
          );
        },
        sendChannel(channel, message) {
          conn.lastChatMode = { type: "channel", channel };
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.CHANNEL, lang, message, channel),
          );
        },
        getChannel(index) {
          return conn.channels[index - 1];
        },
        async who(opts = {}) {
          sendPacket(conn, GameOpcode.CMSG_WHO, buildWhoRequest(opts));
          const r = await conn.dispatch.expect(GameOpcode.SMSG_WHO);
          return parseWhoResponse(r);
        },
        getLastChatMode() {
          return conn.lastChatMode;
        },
        setLastChatMode(mode) {
          conn.lastChatMode = mode;
        },
        sendInCurrentMode(message) {
          const mode = conn.lastChatMode;
          switch (mode.type) {
            case "say":
              handle.sendSay(message);
              break;
            case "yell":
              handle.sendYell(message);
              break;
            case "guild":
              handle.sendGuild(message);
              break;
            case "party":
              handle.sendParty(message);
              break;
            case "raid":
              handle.sendRaid(message);
              break;
            case "emote":
              handle.sendEmote(message);
              break;
            case "whisper":
              handle.sendWhisper(mode.target, message);
              break;
            case "channel":
              handle.sendChannel(mode.channel, message);
              break;
          }
        },
        invite(name) {
          sendPacket(
            conn,
            GameOpcode.CMSG_GROUP_INVITE,
            buildGroupInvite(name),
          );
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
        setLeader(name) {
          const member = conn.partyMembers.get(name);
          if (!member) {
            conn.onMessage?.({
              type: ChatType.SYSTEM,
              sender: "",
              message: `"${name}" is not in your party.`,
            });
            return;
          }
          sendPacket(
            conn,
            GameOpcode.CMSG_GROUP_SET_LEADER,
            buildGroupSetLeader(member.guidLow, member.guidHigh),
          );
        },
        acceptInvite() {
          sendPacket(conn, GameOpcode.CMSG_GROUP_ACCEPT, buildGroupAccept());
        },
        declineInvite() {
          sendPacket(conn, GameOpcode.CMSG_GROUP_DECLINE, buildGroupDecline());
        },
        onGroupEvent(cb) {
          conn.onGroupEvent = cb;
        },
        onEntityEvent(cb) {
          conn.onEntityEvent = cb;
        },
        onPacketError(cb) {
          conn.onPacketError = cb;
        },
        getNearbyEntities() {
          return conn.entityStore.all();
        },
        getFriends() {
          return conn.friendStore.all();
        },
        addFriend(name) {
          sendPacket(
            conn,
            GameOpcode.CMSG_ADD_FRIEND,
            buildAddFriend(name, ""),
          );
        },
        removeFriend(name) {
          const friend = conn.friendStore.findByName(name);
          if (!friend) {
            conn.onMessage?.({
              type: ChatType.SYSTEM,
              sender: "",
              message: `"${name}" is not on your friends list.`,
            });
            return;
          }
          sendPacket(
            conn,
            GameOpcode.CMSG_DEL_FRIEND,
            buildDelFriend(friend.guid),
          );
        },
        sendRoll(min, max) {
          sendPacket(
            conn,
            GameOpcode.MSG_RANDOM_ROLL,
            buildRandomRoll(min, max),
          );
        },
        onFriendEvent(cb) {
          conn.onFriendEvent = cb;
        },
      };
      resolve(handle);
    }

    login().catch((err) => {
      done = true;
      clearInterval(pingInterval);
      reject(err);
      conn.socket?.end();
    });

    Bun.connect({
      hostname: auth.realmHost,
      port: auth.realmPort,
      socket: {
        open(s) {
          conn.socket = s;
        },
        data(_s, data) {
          conn.buf.append(new Uint8Array(data));
          drainWorldPackets(conn);
        },
        close() {
          clearInterval(pingInterval);
          conn.entityStore.clear();
          if (!done) reject(new Error("World connection closed"));
          closedResolve();
        },
      },
    }).catch(reject);
  });
}

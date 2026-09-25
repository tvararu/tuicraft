import type { Socket } from "bun";
import type { CombatEvent, CombatRuntime, CombatState } from "wow/combat";
import type {
  ControlEvent,
  ControlPose,
  ControlRuntime,
  ControlState,
  MovementDirection,
  NavigationState,
  WalkOutcome,
} from "wow/control";
import { Arc4 } from "wow/crypto/arc4";
import type {
  CycleEvent,
  CycleState,
  EncounterCycleRuntime,
} from "wow/encounter-cycle";
import { type Entity, type EntityEvent, EntityStore } from "wow/entity-store";
import type { FramingVariant } from "wow/framing";
import {
  type FriendEntry,
  type FriendEvent,
  FriendStore,
} from "wow/friend-store";
import {
  registerCombatHandlers,
  registerLootHandlers,
  registerQuestHandlers,
  registerRecoveryHandlers,
} from "wow/gameplay-handlers";
import { bearing } from "wow/geometry";
import { type GuildEvent, type GuildRoster, GuildStore } from "wow/guild-store";
import {
  type IgnoreEntry,
  type IgnoreEvent,
  IgnoreStore,
} from "wow/ignore-store";
import type { InventoryState } from "wow/inventory";
import { registerMovementHandlers } from "wow/movement-handlers";
import {
  classifyNavigationRefusal,
  type Navigation,
  type NavPoint,
} from "wow/navigation";
import {
  buildChatMessage,
  buildJoinChannel,
  buildLeaveChannel,
  buildRandomRoll,
  buildWhoRequest,
  parseWhoResponse,
  type ChatMessage as RawChatMessage,
  type WhoResult,
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
import { ChatType, GameOpcode, Language } from "wow/protocol/opcodes";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import {
  buildAddFriend,
  buildAddIgnore,
  buildDelFriend,
  buildDelIgnore,
} from "wow/protocol/social";
import { registerStubs } from "wow/protocol/stubs";
import {
  AccumulatorBuffer,
  buildOutgoingPacket,
  buildWorldAuthPacket,
  CLASS_NAMES,
  decryptIncomingHeader,
  INCOMING_HEADER_SIZE,
  OpcodeDispatch,
  parseCharacterList,
} from "wow/protocol/world";
import type { QuestEvent, QuestRuntime, QuestState } from "wow/quests";
import type {
  RecoveryEvent,
  RecoveryRuntime,
  RecoveryState,
} from "wow/recovery";
import type { RewardsEvent, RewardsRuntime, RewardsState } from "wow/rewards";
import { createRuntimes, type Runtimes } from "wow/runtime";
import type { SpellDefinition } from "wow/spell-catalog";
import type { TacticsEvent, TacticsLoop, TacticsState } from "wow/tactics";
import {
  handleChannelNotify,
  handleChatMessage,
  handleChatRestricted,
  handleChatWrongFaction,
  handleCompressedUpdateObject,
  handleContactList,
  handleCreatureQueryResponse,
  handleDestroyObject,
  handleDuelComplete,
  handleDuelCountdown,
  handleDuelInBounds,
  handleDuelOutOfBounds,
  handleDuelRequested,
  handleDuelWinner,
  handleFriendStatus,
  handleGameObjectQueryResponse,
  handleGmChatMessage,
  handleGroupDeclineMsg,
  handleGroupDestroyed,
  handleGroupInviteReceived,
  handleGroupListMsg,
  handleGroupSetLeaderMsg,
  handleGroupUninvite,
  handleGuildCommandResult,
  handleGuildEvent,
  handleGuildInvitePacket,
  handleGuildQueryResponse,
  handleGuildRoster,
  handleMotd,
  handleNameQueryResponse,
  handleNotification,
  handlePartyCommandResult,
  handlePartyMemberStatsMsg,
  handlePlayerNotFound,
  handleRandomRoll,
  handleReceivedMail,
  handleServerBroadcast,
  handleTimeSync,
  handleUpdateObject,
  sendPacket,
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
  spellDataDir?: string;
  navigationDataDir?: string;
  navigationLibrary?: string;
  jevApiKey?: string;
  jevEndpointUrl?: string;
  jevFault?: string;
};

import type { AuthResult } from "wow/auth";

export type ChatMessage = {
  type: number;
  sender: string;
  message: string;
  channel?: string;
  origin?: "server" | "notification" | "mail";
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

export type DuelEvent =
  | { type: "duel_requested"; challenger: string }
  | { type: "duel_countdown"; timeMs: number }
  | { type: "duel_complete"; completed: boolean }
  | {
      type: "duel_winner";
      reason: "won" | "fled";
      winner: string;
      loser: string;
    }
  | { type: "duel_out_of_bounds" }
  | { type: "duel_in_bounds" };

export type { Entity, EntityEvent } from "wow/entity-store";
export type { FriendEntry, FriendEvent } from "wow/friend-store";
export type { GuildEvent, GuildRoster } from "wow/guild-store";
export type { IgnoreEntry, IgnoreEvent } from "wow/ignore-store";
export type { WhoResult } from "wow/protocol/chat";

export type ChatMode =
  | { type: "say" }
  | { type: "yell" }
  | { type: "guild" }
  | { type: "party" }
  | { type: "raid" }
  | { type: "emote" }
  | { type: "whisper"; target: string }
  | { type: "channel"; channel: string };
export type WalkTarget =
  | { kind: "guid"; guid: bigint }
  | { kind: "point"; x: number; y: number; z: number };

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
  joinChannel(name: string, password?: string): void;
  leaveChannel(name: string): void;
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
  getIgnored(): IgnoreEntry[];
  addIgnore(name: string): void;
  removeIgnore(name: string): void;
  onIgnoreEvent(cb: (event: IgnoreEvent) => void): void;
  requestGuildRoster(): Promise<GuildRoster | undefined>;
  onGuildEvent(cb: (event: GuildEvent) => void): void;
  onDuelEvent(cb: (event: DuelEvent) => void): void;
  guildInvite(name: string): void;
  guildRemove(name: string): void;
  guildLeave(): void;
  guildPromote(name: string): void;
  guildDemote(name: string): void;
  guildLeader(name: string): void;
  guildMotd(motd: string): void;
  acceptGuildInvite(): void;
  declineGuildInvite(): void;
  getControlState(): ControlState;
  move(direction: MovementDirection, durationMs: number): void;
  face(orientation: number): void;
  faceGuid(guid: bigint): void;
  walkToward(
    target: WalkTarget,
    yards: number,
    signal?: AbortSignal,
  ): Promise<WalkOutcome>;
  selectTarget(guid: bigint): void;
  halt(): void;
  onControlEvent(cb: ((event: ControlEvent) => void) | undefined): void;
  getCombatState(): CombatState;
  getSpellbook(): Promise<SpellDefinition[]>;
  cast(spellId: number, targetGuid: bigint): void;
  attack(targetGuid: bigint): void;
  cancelCast(): void;
  stopAttack(): void;
  startTactics(
    targetGuid: bigint,
    instruction: string,
    signal?: AbortSignal,
    framing?: FramingVariant,
  ): Promise<void>;
  getTacticsState(): TacticsState;
  goTo(x: number, y: number, z: number): void;
  getNavigationState(): NavigationState;
  onCombatEvent(cb: ((event: CombatEvent) => void) | undefined): void;
  onTacticsEvent(cb: ((event: TacticsEvent) => void) | undefined): void;
  getRecoveryState(): RecoveryState;
  queryCorpse(): void;
  releaseSpirit(): void;
  reclaimCorpse(): void;
  activateSpiritHealer(guid: bigint): void;
  respondResurrection(accept: boolean): void;
  onRecoveryEvent(cb: ((event: RecoveryEvent) => void) | undefined): void;
  getQuestState(): QuestState;
  talk(guid: bigint): void;
  queryQuest(questId: number): void;
  selectGossipOption(optionId: number, code?: string): void;
  selectQuest(questId: number): void;
  acceptQuest(): void;
  completeQuest(questId: number): void;
  requestQuestReward(): void;
  chooseQuestReward(index: number): void;
  abandonQuest(slot: number): void;
  cancelInteraction(): void;
  onQuestEvent(cb: ((event: QuestEvent) => void) | undefined): void;
  getInventoryState(): InventoryState;
  getRewardsState(): RewardsState;
  openLoot(guid: bigint): void;
  takeLoot(slot: number): void;
  takeLootMoney(): void;
  releaseLoot(): void;
  onRewardsEvent(cb: ((event: RewardsEvent) => void) | undefined): void;
  startCycle(
    guids: bigint[],
    instruction: string,
    maxStarts?: number,
  ): Promise<void>;
  stopCycle(): void;
  getCycleState(): CycleState;
  onCycleEvent(cb: ((event: CycleEvent) => void) | undefined): void;
};

export type WorldConn = {
  socket?: Socket;
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
  selfClass?: string;
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
  ignoreStore: IgnoreStore;
  onIgnoreEvent?: (event: IgnoreEvent) => void;
  guildStore: GuildStore;
  guildId: number;
  onGuildEvent?: (event: GuildEvent) => void;
  pendingRequest: "group" | "duel" | null;
  duelArbiter: bigint;
  onDuelEvent?: (event: DuelEvent) => void;
  control?: ControlRuntime;
  combat?: CombatRuntime;
  recovery?: RecoveryRuntime;
  quests?: QuestRuntime;
  rewards?: RewardsRuntime;
  cycle?: EncounterCycleRuntime;
  tactics?: TacticsLoop;
  onControlEvent?: (event: ControlEvent) => void;
  onRecoveryEvent?: (event: RecoveryEvent) => void;
  onRewardsEvent?: (event: RewardsEvent) => void;
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

  const body = await buildWorldAuthPacket({
    account: config.account,
    sessionKey: auth.sessionKey,
    serverSeed,
    realmId: auth.realmId,
    clientSeed: config.clientSeed,
  });
  if (!conn.socket) throw new Error("World socket is not connected");
  conn.socket.write(buildOutgoingPacket(GameOpcode.CMSG_AUTH_SESSION, body));
  conn.arc4 = new Arc4(auth.sessionKey);

  const resp = await conn.dispatch.expect(GameOpcode.SMSG_AUTH_RESPONSE);
  const status = resp.uint8();
  if (status !== 0x0c) {
    const names: Record<number, string> = {
      13: "system error",
      21: "account in use",
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
  conn.selfClass = CLASS_NAMES[char.classId];
  conn.selfGuidLow = char.guidLow;
  conn.selfGuidHigh = char.guidHigh;
  conn.guildId = char.guildId;

  const w = new PacketWriter();
  w.uint32LE(char.guidLow);
  w.uint32LE(char.guidHigh);
  sendPacket(conn, GameOpcode.CMSG_PLAYER_LOGIN, w.finish());
  if (!conn.control) throw new Error("no_control");
  await conn.control.waitLogin();
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

function notify(conn: WorldConn, message: string): void {
  conn.onMessage?.({ type: ChatType.SYSTEM, sender: "", message });
}

function createWorldConn(): WorldConn {
  const conn: WorldConn = {
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
    ignoreStore: new IgnoreStore(),
    guildStore: new GuildStore(),
    guildId: 0,
    pendingRequest: null,
    duelArbiter: 0n,
  };
  conn.entityStore.onEvent((event) => {
    if (event.type === "disappear") conn.combat?.forget(event.guid);
    conn.recovery?.observeEntity(event);
    conn.rewards?.observeEntity(event);
    conn.cycle?.observeEntity(event);
    conn.onEntityEvent?.(event);
  });
  conn.friendStore.onEvent((event) => conn.onFriendEvent?.(event));
  conn.ignoreStore.onEvent((event) => conn.onIgnoreEvent?.(event));
  conn.guildStore.onEvent((event) => conn.onGuildEvent?.(event));
  return conn;
}

function cleanupSession(
  conn: WorldConn,
  rt: Runtimes,
  sendStop: boolean,
): void {
  conn.onEntityEvent = undefined;
  conn.onFriendEvent = undefined;
  conn.onIgnoreEvent = undefined;
  conn.onGuildEvent = undefined;
  conn.onGroupEvent = undefined;
  conn.onDuelEvent = undefined;
  conn.onControlEvent = undefined;
  conn.onRecoveryEvent = undefined;
  conn.onRewardsEvent = undefined;
  rt.dispose(sendStop);
}

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

function registerWorldHandlers(conn: WorldConn): void {
  registerChatHandlers(conn);
  registerPartyHandlers(conn);
  registerObjectHandlers(conn);
  registerMovementHandlers(conn);
  registerCombatHandlers(conn);
  registerQuestHandlers(conn);
  registerLootHandlers(conn);
  registerRecoveryHandlers(conn);
  registerStubs(conn.dispatch, (msg) => {
    if (!conn.onMessage) return false;
    conn.onMessage({
      type: ChatType.SYSTEM,
      sender: "",
      message: msg,
    });
    return true;
  });
}

function chatMethods(conn: WorldConn, lang: number) {
  const chat = (type: number, message: string, target?: string): void =>
    sendPacket(
      conn,
      GameOpcode.CMSG_MESSAGE_CHAT,
      buildChatMessage(type, lang, message, target),
    );
  return {
    sendWhisper(target, message) {
      if (target) conn.lastChatMode = { type: "whisper", target };
      chat(ChatType.WHISPER, message, target);
    },
    sendSay(message) {
      conn.lastChatMode = { type: "say" };
      chat(ChatType.SAY, message);
    },
    sendYell(message) {
      conn.lastChatMode = { type: "yell" };
      chat(ChatType.YELL, message);
    },
    sendGuild(message) {
      conn.lastChatMode = { type: "guild" };
      chat(ChatType.GUILD, message);
    },
    sendParty(message) {
      conn.lastChatMode = { type: "party" };
      chat(ChatType.PARTY, message);
    },
    sendRaid(message) {
      conn.lastChatMode = { type: "raid" };
      chat(ChatType.RAID, message);
    },
    sendEmote(message) {
      conn.lastChatMode = { type: "emote" };
      chat(ChatType.EMOTE, message);
    },
    sendDnd(message) {
      chat(ChatType.DND, message);
    },
    sendAfk(message) {
      chat(ChatType.AFK, message);
    },
    sendChannel(channel, message) {
      conn.lastChatMode = { type: "channel", channel };
      chat(ChatType.CHANNEL, message, channel);
    },
  } satisfies Partial<WorldHandle>;
}

function sendInMode(
  handle: WorldHandle,
  mode: ChatMode,
  message: string,
): void {
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
    default:
      break;
  }
}

function channelMethods(conn: WorldConn, handle: () => WorldHandle) {
  return {
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
      sendInMode(handle(), conn.lastChatMode, message);
    },
  } satisfies Partial<WorldHandle>;
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

function groupMethods(conn: WorldConn) {
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
      conn.onGroupEvent = cb;
    },
  } satisfies Partial<WorldHandle>;
}

function socialMethods(conn: WorldConn) {
  return {
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
      conn.onFriendEvent = cb;
    },
  } satisfies Partial<WorldHandle>;
}

function ignoreMethods(conn: WorldConn) {
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
      conn.onIgnoreEvent = cb;
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

function guildMethods(conn: WorldConn) {
  return {
    requestGuildRoster() {
      return requestGuildRoster(conn);
    },
    onGuildEvent(cb) {
      conn.onGuildEvent = cb;
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
      conn.onDuelEvent = cb;
    },
  } satisfies Partial<WorldHandle>;
}

function manualMove(
  rt: Runtimes,
  direction: MovementDirection,
  durationMs: number,
): void {
  const state = rt.control.snapshot();
  if (
    state.owner !== "manual" ||
    !state.moving ||
    state.direction !== direction ||
    rt.control.walkActive() ||
    rt.tactics.snapshot().status !== "idle" ||
    rt.cycle.snapshot().active
  )
    rt.override();
  rt.control.move(direction, durationMs);
}

function groundedPoint(
  navigation: Navigation,
  target: NavPoint,
  pose: ControlPose,
): NavPoint {
  if (![target.x, target.y, target.z].every(Number.isFinite))
    throw new Error("invalid_destination");
  let z: number;
  try {
    z = navigation.height(pose.mapId, target.x, target.y);
  } catch {
    z = navigation.height(pose.mapId, target.x, target.y, pose);
  }
  if (Math.abs(z - target.z) > 0.25)
    throw new Error("destination_not_grounded");
  return { x: target.x, y: target.y, z };
}

function resolveWalkDestination(
  rt: Runtimes,
  target: WalkTarget,
  pose: ControlPose,
): NavPoint {
  const navigation = rt.navigation();
  const destination =
    target.kind === "guid"
      ? rt.observedTarget(target.guid)
      : groundedPoint(navigation, target, pose);
  const ground = navigation.height(pose.mapId, pose.x, pose.y, pose);
  if (Math.abs(ground - pose.z) > 0.25) throw new Error("self_not_grounded");
  return destination;
}

async function walkTowardTarget(
  rt: Runtimes,
  target: WalkTarget,
  yards: number,
  signal: AbortSignal | undefined,
): Promise<WalkOutcome> {
  if (!Number.isFinite(yards) || yards <= 0 || yards > 20)
    throw new Error("invalid_distance");
  const pose = rt.control.snapshot().pose;
  if (!pose) throw new Error("no_pose");
  if (signal?.aborted)
    return { status: "stopped", reason: "abort", traveled: 0, pose };
  let destination: NavPoint;
  try {
    destination = resolveWalkDestination(rt, target, pose);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "target_unavailable";
    return { status: "stopped", reason, traveled: 0, pose };
  }
  rt.override();
  try {
    return await rt.control.walkToward(destination, yards, signal);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "movement_unavailable";
    return {
      status: "stopped",
      reason,
      traveled: 0,
      pose: rt.control.snapshot().pose ?? pose,
    };
  }
}

function navigateTo(rt: Runtimes, destination: NavPoint): void {
  rt.override();
  const { x, y, z } = destination;
  if (![x, y, z].every(Number.isFinite))
    throw new Error("stop: invalid_destination");
  const pose = rt.control.snapshot().pose;
  if (!pose) throw new Error("stop: no_pose");
  const navigation = rt.navigation();
  try {
    rt.control.navigate(
      navigation.plan(pose.mapId, pose, destination),
      destination,
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : "navigation_failed";
    const refusal = classifyNavigationRefusal(raw);
    rt.control.navigationError(destination, raw, refusal);
    throw new Error(`${refusal}: ${raw}`);
  }
}

function controlMethods(conn: WorldConn, rt: Runtimes) {
  const { control } = rt;
  return {
    getControlState() {
      return control.snapshot();
    },
    move(direction, durationMs) {
      manualMove(rt, direction, durationMs);
    },
    face(orientation) {
      rt.override();
      control.face(orientation);
    },
    faceGuid(guid) {
      const target = rt.observedTarget(guid);
      rt.override();
      const pose = control.snapshot().pose;
      if (!pose) throw new Error("no_pose");
      if (pose.x === target.x && pose.y === target.y)
        throw new Error("target_coincident");
      control.face(bearing(pose, target));
    },
    walkToward(target, yards, signal) {
      return walkTowardTarget(rt, target, yards, signal);
    },
    selectTarget(guid) {
      rt.override();
      control.selectTarget(guid);
    },
    halt() {
      rt.tactics.stop("halt");
      rt.cycle.stop("halt");
      rt.halt();
    },
    goTo(x, y, z) {
      navigateTo(rt, { x, y, z });
    },
    getNavigationState() {
      return control.navigationState();
    },
    onControlEvent(cb) {
      conn.onControlEvent = cb;
    },
  } satisfies Partial<WorldHandle>;
}

function combatMethods(rt: Runtimes) {
  const { combat, tactics, recovery } = rt;
  return {
    getCombatState() {
      return combat.snapshot();
    },
    async getSpellbook() {
      await rt.prepareCatalog();
      return combat.spellbook();
    },
    cast(spellId, targetGuid) {
      rt.override();
      combat.cast(spellId, targetGuid);
    },
    attack(targetGuid) {
      rt.override();
      combat.attack(targetGuid);
    },
    cancelCast() {
      tactics.stop("manual_override");
      combat.cancelCast();
    },
    stopAttack() {
      tactics.stop("manual_override");
      combat.stopAttack();
    },
    startTactics(targetGuid, instruction, signal, framing) {
      const life = recovery.snapshot().life;
      if (life === "dead" || life === "ghost")
        throw new Error("self_not_alive");
      return tactics.start({ targetGuid, instruction, framing }, signal);
    },
    getTacticsState() {
      return tactics.snapshot();
    },
    onCombatEvent(cb) {
      combat.onEvent(cb);
    },
    onTacticsEvent(cb) {
      tactics.onEvent(cb);
    },
  } satisfies Partial<WorldHandle>;
}

function recoveryMethods(conn: WorldConn, rt: Runtimes) {
  const { recovery } = rt;
  return {
    getRecoveryState() {
      return recovery.snapshot();
    },
    queryCorpse() {
      recovery.queryCorpse();
    },
    releaseSpirit() {
      rt.override();
      recovery.releaseSpirit();
    },
    reclaimCorpse() {
      rt.override();
      recovery.reclaimCorpse();
    },
    activateSpiritHealer(guid) {
      rt.override();
      recovery.activateSpiritHealer(guid);
    },
    respondResurrection(accept) {
      rt.override();
      recovery.respondResurrection(accept);
    },
    onRecoveryEvent(cb) {
      conn.onRecoveryEvent = cb;
    },
  } satisfies Partial<WorldHandle>;
}

function questMethods(rt: Runtimes) {
  const { quests } = rt;
  return {
    getQuestState() {
      return quests.snapshot();
    },
    talk(guid) {
      rt.override();
      quests.talk(guid);
    },
    queryQuest(questId) {
      quests.query(questId);
    },
    selectGossipOption(optionId, code) {
      rt.override();
      quests.selectOption(optionId, code);
    },
    selectQuest(questId) {
      rt.override();
      quests.selectQuest(questId);
    },
    acceptQuest() {
      rt.override();
      quests.accept();
    },
    onQuestEvent(cb) {
      quests.onEvent(cb);
    },
  } satisfies Partial<WorldHandle>;
}

function questRewardMethods(rt: Runtimes) {
  const { quests } = rt;
  return {
    completeQuest(questId) {
      rt.override();
      quests.complete(questId);
    },
    requestQuestReward() {
      rt.override();
      quests.requestReward();
    },
    chooseQuestReward(index) {
      rt.override();
      quests.chooseReward(index);
    },
    abandonQuest(slot) {
      rt.override();
      quests.abandon(slot);
    },
    cancelInteraction() {
      rt.override();
      quests.cancel();
    },
  } satisfies Partial<WorldHandle>;
}

function rewardsMethods(conn: WorldConn, rt: Runtimes) {
  const { rewards } = rt;
  return {
    getInventoryState() {
      return rewards.snapshot().inventory;
    },
    getRewardsState() {
      return rewards.snapshot();
    },
    openLoot(guid) {
      rt.override();
      rewards.open(guid);
    },
    takeLoot(slot) {
      rt.override();
      rewards.take(slot);
    },
    takeLootMoney() {
      rt.override();
      rewards.takeMoney();
    },
    releaseLoot() {
      rt.override();
      rewards.close();
    },
    onRewardsEvent(cb) {
      conn.onRewardsEvent = cb;
    },
  } satisfies Partial<WorldHandle>;
}

function cycleMethods(rt: Runtimes) {
  const { cycle } = rt;
  return {
    async startCycle(guids, instruction, maxStarts) {
      rt.override();
      await cycle.start({ guids, instruction, maxStarts });
    },
    stopCycle() {
      cycle.stop("manual_override");
    },
    getCycleState() {
      return cycle.snapshot();
    },
    onCycleEvent(cb) {
      cycle.onEvent(cb);
    },
  } satisfies Partial<WorldHandle>;
}

type SessionHandle = {
  conn: WorldConn;
  rt: Runtimes;
  lang: number;
  lifecycle: Pick<WorldHandle, "closed" | "close">;
};

function createHandle(session: SessionHandle): WorldHandle {
  const { conn, rt, lang, lifecycle } = session;
  const handle: WorldHandle = {
    ...lifecycle,
    onMessage(cb) {
      conn.onMessage = cb;
    },
    ...chatMethods(conn, lang),
    ...channelMethods(conn, () => handle),
    ...groupMethods(conn),
    ...socialMethods(conn),
    ...ignoreMethods(conn),
    ...guildMethods(conn),
    ...controlMethods(conn, rt),
    ...combatMethods(rt),
    ...recoveryMethods(conn, rt),
    ...questMethods(rt),
    ...questRewardMethods(rt),
    ...rewardsMethods(conn, rt),
    ...cycleMethods(rt),
  };
  return handle;
}

function connectWorld(
  conn: WorldConn,
  auth: AuthResult,
  hooks: { close: () => void; reject: (error: unknown) => void },
): void {
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
        hooks.close();
      },
    },
  }).catch(hooks.reject);
}

export function worldSession(
  config: ClientConfig,
  auth: AuthResult,
): Promise<WorldHandle> {
  return new Promise((resolve, reject) => {
    const conn = createWorldConn();
    const rt = createRuntimes(conn, config);
    let pingInterval: ReturnType<typeof setInterval> | undefined;
    let done = false;
    const { promise: closed, resolve: closedResolve } =
      Promise.withResolvers<void>();
    registerWorldHandlers(conn);

    async function login(): Promise<void> {
      await authenticateWorld(conn, config, auth);
      await selectCharacter(conn, config);
      pingInterval = startPingLoop(conn, config.pingIntervalMs ?? 30_000);
      const lang = config.language ?? Language.COMMON;
      done = true;
      const close = (): void => {
        clearInterval(pingInterval);
        cleanupSession(conn, rt, true);
        conn.socket?.end();
      };
      resolve(createHandle({ conn, rt, lang, lifecycle: { closed, close } }));
    }

    login().catch((err) => {
      done = true;
      clearInterval(pingInterval);
      reject(err);
      cleanupSession(conn, rt, false);
      conn.socket?.end();
    });

    connectWorld(conn, auth, {
      close() {
        clearInterval(pingInterval);
        cleanupSession(conn, rt, false);
        conn.entityStore.clear();
        if (!done) reject(new Error("World connection closed"));
        closedResolve();
      },
      reject,
    });
  });
}

import type { Socket } from "bun";
import type { Unsubscribe } from "lib/emitter";
import { channelMethods, chatMethods } from "wow/client-chat";
import {
  authenticateWorld,
  cleanupSession,
  connectWorld,
  createWorldConn,
  selectCharacter,
  startPingLoop,
} from "wow/client-connection";
import { controlMethods } from "wow/client-control";
import {
  combatMethods,
  cycleMethods,
  questMethods,
  questRewardMethods,
  recoveryMethods,
  rewardsMethods,
} from "wow/client-gameplay";
import { registerWorldHandlers } from "wow/client-handlers";
import {
  groupMethods,
  guildMethods,
  ignoreMethods,
  socialMethods,
} from "wow/client-social";
import type { CombatEvent, CombatRuntime, CombatState } from "wow/combat";
import type {
  ControlEvent,
  ControlRuntime,
  ControlState,
  MovementDirection,
  NavigationState,
  WalkOutcome,
} from "wow/control";
import type { Arc4 } from "wow/crypto/arc4";
import type {
  CycleEvent,
  CycleState,
  EncounterCycleRuntime,
} from "wow/encounter-cycle";
import type { Entity, EntityEvent, EntityStore } from "wow/entity-store";
import type { FramingVariant } from "wow/framing";
import type { FriendEntry, FriendEvent, FriendStore } from "wow/friend-store";
import type { GuildEvent, GuildRoster, GuildStore } from "wow/guild-store";
import type { IgnoreEntry, IgnoreEvent, IgnoreStore } from "wow/ignore-store";
import type { InventoryState } from "wow/inventory";
import type {
  ChatMessage as RawChatMessage,
  WhoResult,
} from "wow/protocol/chat";
import { Language } from "wow/protocol/opcodes";
import type { AccumulatorBuffer, OpcodeDispatch } from "wow/protocol/world";
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
import type { WorldEvents } from "wow/world-events";

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
  close: () => void;
  onMessage: (cb: (msg: ChatMessage) => void) => Unsubscribe;
  sendWhisper: (target: string, message: string) => void;
  sendSay: (message: string) => void;
  sendYell: (message: string) => void;
  sendGuild: (message: string) => void;
  sendParty: (message: string) => void;
  sendRaid: (message: string) => void;
  sendEmote: (message: string) => void;
  sendDnd: (message: string) => void;
  sendAfk: (message: string) => void;
  sendChannel: (channel: string, message: string) => void;
  getChannel: (index: number) => string | undefined;
  who: (opts?: {
    name?: string;
    minLevel?: number;
    maxLevel?: number;
  }) => Promise<WhoResult[]>;
  getLastChatMode: () => ChatMode;
  setLastChatMode: (mode: ChatMode) => void;
  sendInCurrentMode: (message: string) => void;
  invite: (name: string) => void;
  uninvite: (name: string) => void;
  leaveGroup: () => void;
  joinChannel: (name: string, password?: string) => void;
  leaveChannel: (name: string) => void;
  setLeader: (name: string) => void;
  acceptInvite: () => void;
  declineInvite: () => void;
  onGroupEvent: (cb: (event: GroupEvent) => void) => Unsubscribe;
  onEntityEvent: (cb: (event: EntityEvent) => void) => Unsubscribe;
  onPacketError: (cb: (opcode: number, err: Error) => void) => Unsubscribe;
  getNearbyEntities: () => Entity[];
  getFriends: () => FriendEntry[];
  addFriend: (name: string) => void;
  removeFriend: (name: string) => void;
  sendRoll: (min: number, max: number) => void;
  onFriendEvent: (cb: (event: FriendEvent) => void) => Unsubscribe;
  getIgnored: () => IgnoreEntry[];
  addIgnore: (name: string) => void;
  removeIgnore: (name: string) => void;
  onIgnoreEvent: (cb: (event: IgnoreEvent) => void) => Unsubscribe;
  requestGuildRoster: () => Promise<GuildRoster | undefined>;
  onGuildEvent: (cb: (event: GuildEvent) => void) => Unsubscribe;
  onDuelEvent: (cb: (event: DuelEvent) => void) => Unsubscribe;
  guildInvite: (name: string) => void;
  guildRemove: (name: string) => void;
  guildLeave: () => void;
  guildPromote: (name: string) => void;
  guildDemote: (name: string) => void;
  guildLeader: (name: string) => void;
  guildMotd: (motd: string) => void;
  acceptGuildInvite: () => void;
  declineGuildInvite: () => void;
  getControlState: () => ControlState;
  move: (direction: MovementDirection, durationMs: number) => void;
  face: (orientation: number) => void;
  faceGuid: (guid: bigint) => void;
  walkToward: (
    target: WalkTarget,
    yards: number,
    signal?: AbortSignal,
  ) => Promise<WalkOutcome>;
  selectTarget: (guid: bigint) => void;
  halt: () => void;
  onControlEvent: (cb: (event: ControlEvent) => void) => Unsubscribe;
  getCombatState: () => CombatState;
  getSpellbook: () => Promise<SpellDefinition[]>;
  cast: (spellId: number, targetGuid: bigint) => void;
  attack: (targetGuid: bigint) => void;
  cancelCast: () => void;
  stopAttack: () => void;
  startTactics: (
    targetGuid: bigint,
    instruction: string,
    signal?: AbortSignal,
    framing?: FramingVariant,
  ) => Promise<void>;
  getTacticsState: () => TacticsState;
  goTo: (x: number, y: number, z: number) => void;
  getNavigationState: () => NavigationState;
  onCombatEvent: (cb: (event: CombatEvent) => void) => Unsubscribe;
  onTacticsEvent: (cb: (event: TacticsEvent) => void) => Unsubscribe;
  getRecoveryState: () => RecoveryState;
  queryCorpse: () => void;
  releaseSpirit: () => void;
  reclaimCorpse: () => void;
  activateSpiritHealer: (guid: bigint) => void;
  respondResurrection: (accept: boolean) => void;
  onRecoveryEvent: (cb: (event: RecoveryEvent) => void) => Unsubscribe;
  getQuestState: () => QuestState;
  talk: (guid: bigint) => void;
  queryQuest: (questId: number) => void;
  selectGossipOption: (optionId: number, code?: string) => void;
  selectQuest: (questId: number) => void;
  acceptQuest: () => void;
  completeQuest: (questId: number) => void;
  requestQuestReward: () => void;
  chooseQuestReward: (index: number) => void;
  abandonQuest: (slot: number) => void;
  cancelInteraction: () => void;
  onQuestEvent: (cb: (event: QuestEvent) => void) => Unsubscribe;
  getInventoryState: () => InventoryState;
  getRewardsState: () => RewardsState;
  openLoot: (guid: bigint) => void;
  takeLoot: (slot: number) => void;
  takeLootMoney: () => void;
  releaseLoot: () => void;
  onRewardsEvent: (cb: (event: RewardsEvent) => void) => Unsubscribe;
  startCycle: (
    guids: bigint[],
    instruction: string,
    maxStarts?: number,
  ) => Promise<void>;
  stopCycle: () => void;
  getCycleState: () => CycleState;
  onCycleEvent: (cb: (event: CycleEvent) => void) => Unsubscribe;
};

export type WorldConn = {
  socket?: Socket;
  dispatch: OpcodeDispatch;
  buf: AccumulatorBuffer;
  arc4?: Arc4;
  startTime: number;
  pendingHeader?: { size: number; opcode: number };
  dispatchingOpcode?: number;
  nameCache: Map<number, string>;
  pendingMessages: Map<number, RawChatMessage[]>;
  channels: string[];
  lastChatMode: ChatMode;
  selfName: string;
  selfClass?: string;
  selfGuidLow: number;
  selfGuidHigh: number;
  partyMembers: Map<string, { guidLow: number; guidHigh: number }>;
  entityStore: EntityStore;
  creatureNameCache: Map<number, string>;
  gameObjectNameCache: Map<number, string>;
  pendingNameQueries: Set<string>;
  friendStore: FriendStore;
  ignoreStore: IgnoreStore;
  guildStore: GuildStore;
  guildId: number;
  pendingRequest: "group" | "duel" | null;
  duelArbiter: bigint;
  events: WorldEvents;
  control?: ControlRuntime;
  combat?: CombatRuntime;
  recovery?: RecoveryRuntime;
  quests?: QuestRuntime;
  rewards?: RewardsRuntime;
  cycle?: EncounterCycleRuntime;
  tactics?: TacticsLoop;
};
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
      return conn.events.message.subscribe(cb);
    },
    ...chatMethods(conn, lang),
    ...channelMethods(conn, () => handle),
    ...groupMethods(conn),
    ...socialMethods(conn),
    ...ignoreMethods(conn),
    ...guildMethods(conn),
    ...controlMethods(conn, rt),
    ...combatMethods(conn, rt),
    ...recoveryMethods(conn, rt),
    ...questMethods(conn, rt),
    ...questRewardMethods(rt),
    ...rewardsMethods(conn, rt),
    ...cycleMethods(conn, rt),
  };
  return handle;
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

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
  defenseMethods,
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
import { type NamedTrainerState, trainerMethods } from "wow/client-trainer";
import { type NamedVendorState, vendorMethods } from "wow/client-vendor";
import type { CombatEvent, CombatState } from "wow/combat";
import type {
  ControlEvent,
  ControlState,
  MovementDirection,
  NavigationState,
  WalkOutcome,
} from "wow/control";
import type { DestroyEvent, DestroyState } from "wow/destroy";
import type { CycleEvent, CycleState } from "wow/encounter-cycle";
import type { Entity, EntityEvent } from "wow/entity-store";
import type { ExperienceState } from "wow/experience";
import type { FramingVariant } from "wow/framing";
import type { FriendEntry, FriendEvent } from "wow/friend-store";
import type { GuildEvent, GuildRoster } from "wow/guild-store";
import type { IgnoreEntry, IgnoreEvent } from "wow/ignore-store";
import type { NamedInventoryState, NamedRewardsState } from "wow/item-labels";
import type { NavigationObservation } from "wow/navigation-observation";
import type { NearbyQuery, NearbyRow } from "wow/nearby";
import type { PartyChange, PartyLoot, PartyState } from "wow/party-store";
import type { WhoResult } from "wow/protocol/chat";
import type { RollVote } from "wow/protocol/loot";
import { Language } from "wow/protocol/opcodes";
import type { QuestEvent, QuestState } from "wow/quests";
import type { RecoveryEvent, RecoveryState } from "wow/recovery";
import type { RemoteMotionEvent, RemotePose } from "wow/remote-motion";
import type { RewardsEvent } from "wow/rewards";
import { createRuntimes, type Runtimes } from "wow/runtime";
import type { DefenseEvent, DefenseState } from "wow/self-defense";
import type { SpellDefinition } from "wow/spell-catalog";
import type { TacticsEvent, TacticsState } from "wow/tactics";
import type { TrainerEvent } from "wow/trainer";
import type { VendorEvent } from "wow/vendor";
import type { WorldConn } from "wow/world-conn";

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
      change: PartyChange;
      loot: PartyLoot | null;
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
export type GotoTarget =
  | { kind: "guid"; guid: bigint }
  | { kind: "point"; x: number; y: number; z?: number };

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
  getPartyState: () => PartyState;
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
  getRemotePoses: () => RemotePose[];
  queryNearby: (query?: NearbyQuery) => NearbyRow[];
  onRemoteMotionEvent: (cb: (event: RemoteMotionEvent) => void) => Unsubscribe;
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
  goTo: (target: GotoTarget) => void;
  getNavigationState: () => NavigationState;
  observeNavigation: () => NavigationObservation;
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
  getInventoryState: () => NamedInventoryState;
  getExperienceState: () => ExperienceState;
  getRewardsState: () => NamedRewardsState;
  openLoot: (guid: bigint) => void;
  takeLoot: (slot: number) => void;
  takeLootMoney: () => void;
  releaseLoot: () => void;
  useItem: (bag: number, slot: number) => Promise<void>;
  rollLoot: (guid: bigint, slot: number, vote: RollVote) => void;
  onRewardsEvent: (cb: (event: RewardsEvent) => void) => Unsubscribe;
  destroyItem: (bag: number, slot: number, count?: number) => void;
  getDestroyState: () => DestroyState;
  onDestroyEvent: (cb: (event: DestroyEvent) => void) => Unsubscribe;
  startCycle: (
    guids: bigint[],
    instruction: string,
    maxStarts?: number,
  ) => Promise<void>;
  startQuestCycle: (
    questId: number,
    sources: number[],
    instruction: string,
    maxStarts?: number,
  ) => Promise<void>;
  resumeCycle: (
    instruction: string | undefined,
    maxStarts: number | undefined,
  ) => Promise<void>;
  stopCycle: () => void;
  getCycleState: () => CycleState;
  onCycleEvent: (cb: (event: CycleEvent) => void) => Unsubscribe;
  getTrainerState: () => Promise<NamedTrainerState>;
  openTrainer: (guid: bigint) => void;
  trainSpell: (spellId: number) => void;
  onTrainerEvent: (cb: (event: TrainerEvent) => void) => Unsubscribe;
  getVendorState: () => NamedVendorState;
  openVendor: (guid: bigint) => void;
  sellItem: (bag: number, slot: number, count?: number) => void;
  buyItem: (slot: number, count?: number) => void;
  repairAll: () => void;
  onVendorEvent: (cb: (event: VendorEvent) => void) => Unsubscribe;
  armDefense: (instruction: string) => void;
  disarmDefense: () => void;
  getDefenseState: () => DefenseState;
  onDefenseEvent: (cb: (event: DefenseEvent) => void) => Unsubscribe;
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
    ...trainerMethods(conn, rt),
    ...vendorMethods(conn, rt),
    ...defenseMethods(conn, rt),
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

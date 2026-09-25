import { jest } from "bun:test";
import type {
  ChatMessage,
  ChatMode,
  DuelEvent,
  GroupEvent,
  WorldHandle,
} from "wow/client";
import { type CombatEvent, CombatRuntime } from "wow/combat";
import type { ControlEvent, ControlState } from "wow/control";
import { EncounterCycleRuntime } from "wow/encounter-cycle";
import type { Entity, EntityEvent } from "wow/entity-store";
import type { FriendEntry, FriendEvent } from "wow/friend-store";
import type { GuildEvent, GuildRoster } from "wow/guild-store";
import type { IgnoreEntry, IgnoreEvent } from "wow/ignore-store";
import { type QuestEvent, QuestRuntime } from "wow/quests";
import { type RecoveryEvent, RecoveryRuntime } from "wow/recovery";
import { type RewardsEvent, RewardsRuntime } from "wow/rewards";
import type { TacticsEvent, TacticsState } from "wow/tactics";

export function createMockHandle(): WorldHandle & {
  triggerMessage: (msg: ChatMessage) => void;
  triggerGroupEvent: (event: GroupEvent) => void;
  triggerDuelEvent: (event: DuelEvent) => void;
  triggerEntityEvent: (event: EntityEvent) => void;
  triggerFriendEvent: (event: FriendEvent) => void;
  triggerIgnoreEvent: (event: IgnoreEvent) => void;
  triggerGuildEvent: (event: GuildEvent) => void;
  triggerControlEvent: (event: ControlEvent) => void;
  triggerCombatEvent: (event: CombatEvent) => void;
  triggerTacticsEvent: (event: TacticsEvent) => void;
  triggerRecoveryEvent: (event: RecoveryEvent) => void;
  triggerQuestEvent: (event: QuestEvent) => void;
  triggerRewardsEvent: (event: RewardsEvent) => void;
  resolveClosed: () => void;
} {
  let messageCb: ((msg: ChatMessage) => void) | undefined;
  let groupEventCb: ((event: GroupEvent) => void) | undefined;
  let duelEventCb: ((event: DuelEvent) => void) | undefined;
  let entityEventCb: ((event: EntityEvent) => void) | undefined;
  let friendEventCb: ((event: FriendEvent) => void) | undefined;
  let ignoreEventCb: ((event: IgnoreEvent) => void) | undefined;
  let guildEventCb: ((event: GuildEvent) => void) | undefined;
  let controlEventCb: ((event: ControlEvent) => void) | undefined;
  const controlState: ControlState = {
    blockedReason: undefined,
    direction: undefined,
    movementAllowed: true,
    moving: false,
    owner: "none",
    pose: undefined,
    requestedTarget: undefined,
    selfGuid: 0n,
    serverPose: undefined,
    speed: 0,
    target: undefined,
  };
  let combatEventCb: ((event: CombatEvent) => void) | undefined;
  let tacticsEventCb: ((event: TacticsEvent) => void) | undefined;
  let recoveryEventCb: ((event: RecoveryEvent) => void) | undefined;
  let questEventCb: ((event: QuestEvent) => void) | undefined;
  let rewardsEventCb: ((event: RewardsEvent) => void) | undefined;
  const runtimeDeps = {
    getEntity: () => undefined,
    now: () => 0,
    selfGuid: () => 0n,
    send: () => {},
  };
  const combat = new CombatRuntime({
    ...runtimeDeps,
    selectedGuid: () => undefined,
    selfPose: () => undefined,
  });
  const recovery = new RecoveryRuntime({
    ...runtimeDeps,
    pose: () => undefined,
  });
  const quests = new QuestRuntime(runtimeDeps);
  const rewards = new RewardsRuntime(runtimeDeps);
  const tacticsState: TacticsState = {
    instruction: "",
    lastDecision: undefined,
    lastDiscardReason: undefined,
    lastOutcome: undefined,
    lastRequest: undefined,
    lastResult: undefined,
    runId: undefined,
    status: "idle",
    targetGuid: undefined,
  };
  const cycle = new EncounterCycleRuntime({
    control: { face: () => {}, move: () => {}, snapshot: () => controlState },
    now: runtimeDeps.now,
    recovery,
    rewards,
    tactics: {
      snapshot: () => tacticsState,
      start: (_context, signal) =>
        new Promise<void>((resolve) =>
          signal?.addEventListener("abort", () => resolve(), { once: true }),
        ),
      stop: () => {},
    },
  });

  let closeResolve: () => void;
  const closed = new Promise<void>((r) => {
    closeResolve = r;
  });
  let lastChatMode: ChatMode = { type: "say" };

  return {
    abandonQuest: jest.fn(),
    acceptGuildInvite: jest.fn(),
    acceptInvite: jest.fn(),
    acceptQuest: jest.fn(),
    activateSpiritHealer: jest.fn(),
    addFriend: jest.fn(),
    addIgnore: jest.fn(),
    attack: jest.fn(),
    cancelCast: jest.fn(),
    cancelInteraction: jest.fn(),
    cast: jest.fn(),
    chooseQuestReward: jest.fn(),
    close: jest.fn(() => closeResolve()),
    closed,
    completeQuest: jest.fn(),
    declineGuildInvite: jest.fn(),
    declineInvite: jest.fn(),
    face: jest.fn(),
    faceGuid: jest.fn(),
    getChannel: jest.fn(),
    getCombatState: jest.fn(() => combat.snapshot()),
    getControlState: jest.fn((): ControlState => controlState),
    getCycleState: jest.fn(() => cycle.snapshot()),
    getFriends: jest.fn((): FriendEntry[] => []),
    getIgnored: jest.fn((): IgnoreEntry[] => []),
    getInventoryState: jest.fn(() => rewards.snapshot().inventory),
    getLastChatMode: jest.fn(() => lastChatMode),
    getNavigationState: jest.fn(() => ({
      active: false,
      blockedReason: undefined,
      destination: undefined,
      owner: "none" as const,
      refusal: undefined,
      remaining: undefined,
    })),
    getNearbyEntities: jest.fn((): Entity[] => []),
    getQuestState: jest.fn(() => quests.snapshot()),
    getRecoveryState: jest.fn(() => recovery.snapshot()),
    getRewardsState: jest.fn(() => rewards.snapshot()),
    getSpellbook: jest.fn(async () => []),
    getTacticsState: jest.fn(() => tacticsState),
    goTo: jest.fn(),
    guildDemote: jest.fn(),
    guildInvite: jest.fn(),
    guildLeader: jest.fn(),
    guildLeave: jest.fn(),
    guildMotd: jest.fn(),
    guildPromote: jest.fn(),
    guildRemove: jest.fn(),
    halt: jest.fn(() => {
      cycle.stop("halt");
    }),
    invite: jest.fn(),
    joinChannel: jest.fn(),
    leaveChannel: jest.fn(),
    leaveGroup: jest.fn(),
    move: jest.fn(),
    onCombatEvent(cb) {
      combatEventCb = cb;
    },
    onControlEvent(cb) {
      controlEventCb = cb;
    },
    onCycleEvent(cb) {
      cycle.onEvent(cb);
    },
    onDuelEvent(cb) {
      duelEventCb = cb;
    },
    onEntityEvent(cb) {
      entityEventCb = cb;
    },
    onFriendEvent(cb) {
      friendEventCb = cb;
    },
    onGroupEvent(cb) {
      groupEventCb = cb;
    },
    onGuildEvent(cb) {
      guildEventCb = cb;
    },
    onIgnoreEvent(cb) {
      ignoreEventCb = cb;
    },
    onMessage(cb) {
      messageCb = cb;
    },
    onPacketError: jest.fn(),
    onQuestEvent(cb) {
      questEventCb = cb;
    },
    onRecoveryEvent(cb) {
      recoveryEventCb = cb;
    },
    onRewardsEvent(cb) {
      rewardsEventCb = cb;
    },
    onTacticsEvent(cb) {
      tacticsEventCb = cb;
    },
    openLoot: jest.fn(),
    queryCorpse: jest.fn(),
    queryQuest: jest.fn(),
    reclaimCorpse: jest.fn(),
    releaseLoot: jest.fn(),
    releaseSpirit: jest.fn(),
    removeFriend: jest.fn(),
    removeIgnore: jest.fn(),
    requestGuildRoster: jest.fn(
      async (): Promise<GuildRoster | undefined> => undefined,
    ),
    requestQuestReward: jest.fn(),
    resolveClosed() {
      closeResolve();
    },
    respondResurrection: jest.fn(),
    selectGossipOption: jest.fn(),
    selectQuest: jest.fn(),
    selectTarget: jest.fn(),
    sendAfk: jest.fn(),
    sendChannel: jest.fn(),
    sendDnd: jest.fn(),
    sendEmote: jest.fn(),
    sendGuild: jest.fn(),
    sendInCurrentMode: jest.fn(),
    sendParty: jest.fn(),
    sendRaid: jest.fn(),
    sendRoll: jest.fn(),
    sendSay: jest.fn(),
    sendWhisper: jest.fn(),
    sendYell: jest.fn(),
    setLastChatMode: jest.fn((mode: ChatMode) => {
      lastChatMode = mode;
    }),
    setLeader: jest.fn(),
    startCycle: jest.fn(
      (guids: bigint[], instruction: string, maxStarts?: number) =>
        cycle.start({ guids, instruction, maxStarts }),
    ),
    startTactics: jest.fn(async () => {}),
    stopAttack: jest.fn(),
    stopCycle: jest.fn(() => {
      cycle.stop("manual_override");
    }),
    takeLoot: jest.fn(),
    takeLootMoney: jest.fn(),
    talk: jest.fn(),
    triggerCombatEvent(event) {
      combatEventCb?.(event);
    },
    triggerControlEvent(event) {
      controlEventCb?.(event);
    },
    triggerDuelEvent(event) {
      duelEventCb?.(event);
    },
    triggerEntityEvent(event) {
      entityEventCb?.(event);
    },
    triggerFriendEvent(event) {
      friendEventCb?.(event);
    },
    triggerGroupEvent(event) {
      groupEventCb?.(event);
    },
    triggerGuildEvent(event) {
      guildEventCb?.(event);
    },
    triggerIgnoreEvent(event) {
      ignoreEventCb?.(event);
    },
    triggerMessage(msg) {
      messageCb?.(msg);
    },
    triggerQuestEvent(event) {
      questEventCb?.(event);
    },
    triggerRecoveryEvent(event) {
      recoveryEventCb?.(event);
    },
    triggerRewardsEvent(event) {
      rewardsEventCb?.(event);
    },
    triggerTacticsEvent(event) {
      tacticsEventCb?.(event);
    },
    uninvite: jest.fn(),
    walkToward: jest.fn(async () => {
      throw new Error("mock_walk_unavailable");
    }),
    who: jest.fn(async () => []),
  };
}

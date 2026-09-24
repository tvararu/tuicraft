import { CombatRuntime, type CombatEvent } from "wow/combat";
import type { TacticsState, TacticsEvent } from "wow/tactics";
import { RecoveryRuntime, type RecoveryEvent } from "wow/recovery";
import { QuestRuntime, type QuestEvent } from "wow/quests";
import { RewardsRuntime, type RewardsEvent } from "wow/rewards";
import { EncounterCycleRuntime } from "wow/encounter-cycle";
import { jest } from "bun:test";
import type {
  WorldHandle,
  ChatMessage,
  ChatMode,
  GroupEvent,
  DuelEvent,
} from "wow/client";
import type { Entity, EntityEvent } from "wow/entity-store";
import type { FriendEntry, FriendEvent } from "wow/friend-store";
import type { IgnoreEntry, IgnoreEvent } from "wow/ignore-store";
import type { GuildRoster, GuildEvent } from "wow/guild-store";
import type { ControlEvent, ControlState } from "wow/control";

export function createMockHandle(): WorldHandle & {
  triggerMessage(msg: ChatMessage): void;
  triggerGroupEvent(event: GroupEvent): void;
  triggerDuelEvent(event: DuelEvent): void;
  triggerEntityEvent(event: EntityEvent): void;
  triggerFriendEvent(event: FriendEvent): void;
  triggerIgnoreEvent(event: IgnoreEvent): void;
  triggerGuildEvent(event: GuildEvent): void;
  triggerControlEvent(event: ControlEvent): void;
  triggerCombatEvent(event: CombatEvent): void;
  triggerTacticsEvent(event: TacticsEvent): void;
  triggerRecoveryEvent(event: RecoveryEvent): void;
  triggerQuestEvent(event: QuestEvent): void;
  triggerRewardsEvent(event: RewardsEvent): void;
  resolveClosed(): void;
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
    selfGuid: 0n,
    pose: undefined,
    serverPose: undefined,
    target: undefined,
    requestedTarget: undefined,
    moving: false,
    direction: undefined,
    movementAllowed: true,
    blockedReason: undefined,
    speed: 0,
    owner: "none",
  };
  let combatEventCb: ((event: CombatEvent) => void) | undefined;
  let tacticsEventCb: ((event: TacticsEvent) => void) | undefined;
  let recoveryEventCb: ((event: RecoveryEvent) => void) | undefined;
  let questEventCb: ((event: QuestEvent) => void) | undefined;
  let rewardsEventCb: ((event: RewardsEvent) => void) | undefined;
  const runtimeDeps = {
    send: () => {},
    now: () => 0,
    selfGuid: () => 0n,
    getEntity: () => undefined,
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
    status: "idle",
    runId: undefined,
    targetGuid: undefined,
    instruction: "",
    lastRequest: undefined,
    lastResult: undefined,
    lastDecision: undefined,
    lastOutcome: undefined,
    lastDiscardReason: undefined,
  };
  const cycle = new EncounterCycleRuntime({
    tactics: {
      start: (_context, signal) =>
        new Promise<void>((resolve) =>
          signal?.addEventListener("abort", () => resolve(), { once: true }),
        ),
      stop: () => {},
      snapshot: () => tacticsState,
    },
    rewards,
    recovery,
    control: { snapshot: () => controlState, face: () => {}, move: () => {} },
    now: runtimeDeps.now,
  });

  let closeResolve: () => void;
  const closed = new Promise<void>((r) => {
    closeResolve = r;
  });
  let lastChatMode: ChatMode = { type: "say" };

  return {
    closed,
    close: jest.fn(() => closeResolve()),
    onMessage(cb) {
      messageCb = cb;
    },
    sendWhisper: jest.fn(),
    sendSay: jest.fn(),
    sendYell: jest.fn(),
    sendGuild: jest.fn(),
    sendParty: jest.fn(),
    sendRaid: jest.fn(),
    sendEmote: jest.fn(),
    sendDnd: jest.fn(),
    sendAfk: jest.fn(),
    sendChannel: jest.fn(),
    getChannel: jest.fn(),
    who: jest.fn(async () => []),
    getLastChatMode: jest.fn(() => lastChatMode),
    setLastChatMode: jest.fn((mode: ChatMode) => {
      lastChatMode = mode;
    }),
    sendInCurrentMode: jest.fn(),
    invite: jest.fn(),
    uninvite: jest.fn(),
    leaveGroup: jest.fn(),
    joinChannel: jest.fn(),
    leaveChannel: jest.fn(),
    setLeader: jest.fn(),
    acceptInvite: jest.fn(),
    declineInvite: jest.fn(),
    onGroupEvent(cb) {
      groupEventCb = cb;
    },
    onDuelEvent(cb) {
      duelEventCb = cb;
    },
    onEntityEvent(cb) {
      entityEventCb = cb;
    },
    onPacketError: jest.fn(),
    getNearbyEntities: jest.fn((): Entity[] => []),
    getFriends: jest.fn((): FriendEntry[] => []),
    addFriend: jest.fn(),
    removeFriend: jest.fn(),
    sendRoll: jest.fn(),
    onFriendEvent(cb) {
      friendEventCb = cb;
    },
    getIgnored: jest.fn((): IgnoreEntry[] => []),
    addIgnore: jest.fn(),
    removeIgnore: jest.fn(),
    guildInvite: jest.fn(),
    guildRemove: jest.fn(),
    guildLeave: jest.fn(),
    guildPromote: jest.fn(),
    guildDemote: jest.fn(),
    guildLeader: jest.fn(),
    guildMotd: jest.fn(),
    acceptGuildInvite: jest.fn(),
    declineGuildInvite: jest.fn(),
    onIgnoreEvent(cb) {
      ignoreEventCb = cb;
    },
    requestGuildRoster: jest.fn(
      async (): Promise<GuildRoster | undefined> => undefined,
    ),
    onGuildEvent(cb) {
      guildEventCb = cb;
    },
    getControlState: jest.fn((): ControlState => controlState),
    move: jest.fn(),
    face: jest.fn(),
    faceGuid: jest.fn(),
    walkToward: jest.fn(async () => {
      throw new Error("mock_walk_unavailable");
    }),
    selectTarget: jest.fn(),
    halt: jest.fn(() => {
      cycle.stop("halt");
    }),
    onControlEvent(cb) {
      controlEventCb = cb;
    },
    getCombatState: jest.fn(() => combat.snapshot()),
    getSpellbook: jest.fn(async () => []),
    cast: jest.fn(),
    attack: jest.fn(),
    cancelCast: jest.fn(),
    stopAttack: jest.fn(),
    startTactics: jest.fn(async () => {}),
    getTacticsState: jest.fn(() => tacticsState),
    goTo: jest.fn(),
    getNavigationState: jest.fn(() => ({
      active: false,
      destination: undefined,
      remaining: undefined,
      owner: "none" as const,
      blockedReason: undefined,
      refusal: undefined,
    })),
    onCombatEvent(cb) {
      combatEventCb = cb;
    },
    onTacticsEvent(cb) {
      tacticsEventCb = cb;
    },
    getRecoveryState: jest.fn(() => recovery.snapshot()),
    queryCorpse: jest.fn(),
    releaseSpirit: jest.fn(),
    reclaimCorpse: jest.fn(),
    activateSpiritHealer: jest.fn(),
    respondResurrection: jest.fn(),
    onRecoveryEvent(cb) {
      recoveryEventCb = cb;
    },
    getQuestState: jest.fn(() => quests.snapshot()),
    talk: jest.fn(),
    queryQuest: jest.fn(),
    selectGossipOption: jest.fn(),
    selectQuest: jest.fn(),
    acceptQuest: jest.fn(),
    completeQuest: jest.fn(),
    requestQuestReward: jest.fn(),
    chooseQuestReward: jest.fn(),
    abandonQuest: jest.fn(),
    cancelInteraction: jest.fn(),
    onQuestEvent(cb) {
      questEventCb = cb;
    },
    triggerRecoveryEvent(event) {
      recoveryEventCb?.(event);
    },
    triggerQuestEvent(event) {
      questEventCb?.(event);
    },
    getInventoryState: jest.fn(() => rewards.snapshot().inventory),
    getRewardsState: jest.fn(() => rewards.snapshot()),
    openLoot: jest.fn(),
    takeLoot: jest.fn(),
    takeLootMoney: jest.fn(),
    releaseLoot: jest.fn(),
    onRewardsEvent(cb) {
      rewardsEventCb = cb;
    },
    triggerRewardsEvent(event) {
      rewardsEventCb?.(event);
    },
    startCycle: jest.fn(
      (guids: bigint[], instruction: string, maxStarts?: number) =>
        cycle.start({ guids, instruction, maxStarts }),
    ),
    stopCycle: jest.fn(() => {
      cycle.stop("manual_override");
    }),
    getCycleState: jest.fn(() => cycle.snapshot()),
    onCycleEvent(cb) {
      cycle.onEvent(cb);
    },
    triggerCombatEvent(event) {
      combatEventCb?.(event);
    },
    triggerTacticsEvent(event) {
      tacticsEventCb?.(event);
    },
    triggerMessage(msg) {
      messageCb?.(msg);
    },
    triggerGroupEvent(event) {
      groupEventCb?.(event);
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
    triggerIgnoreEvent(event) {
      ignoreEventCb?.(event);
    },
    triggerGuildEvent(event) {
      guildEventCb?.(event);
    },
    triggerControlEvent(event) {
      controlEventCb?.(event);
    },
    resolveClosed() {
      closeResolve();
    },
  };
}

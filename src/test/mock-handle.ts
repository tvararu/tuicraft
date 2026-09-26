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
import { labelInventory, labelRewards } from "wow/item-labels";
import { observeNavigation } from "wow/navigation-observation";
import { type NearbyQuery, queryNearby } from "wow/nearby";
import { PartyStore } from "wow/party-store";
import { type QuestEvent, QuestRuntime } from "wow/quests";
import { type RecoveryEvent, RecoveryRuntime } from "wow/recovery";
import type { RemotePose } from "wow/remote-motion";
import { type RewardsEvent, RewardsRuntime } from "wow/rewards";
import { SelfDefense } from "wow/self-defense";
import type { TacticsEvent, TacticsState } from "wow/tactics";
import { type VendorEvent, VendorRuntime } from "wow/vendor";
import { createWorldEvents } from "wow/world-events";

type MockHandle = WorldHandle & {
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
  triggerVendorEvent: (event: VendorEvent) => void;
  resolveClosed: () => void;
};

export function createMockHandle(): MockHandle {
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
  const vendor = new VendorRuntime(runtimeDeps);
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
    timeouts: { consecutive: 0, limit: 3, total: 0 },
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
  const unanswered = () => ({ name: null, quality: null });

  const defense = new SelfDefense({
    alive: () => true,
    attack: () => {},
    attackers: () => [],
    face: () => {},
    jev: () => false,
    now: runtimeDeps.now,
    owner: () => undefined,
    tactics: {
      snapshot: () => tacticsState,
      start: async () => {},
      stop: () => {},
    },
  });
  const events = createWorldEvents();
  defense.onEvent((event) => events.defense.emit(event));
  let closeResolve: () => void;
  const closed = new Promise<void>((r) => {
    closeResolve = r;
  });
  let lastChatMode: ChatMode = { type: "say" };

  const handle: MockHandle = {
    abandonQuest: jest.fn(),
    acceptGuildInvite: jest.fn(),
    acceptInvite: jest.fn(),
    acceptQuest: jest.fn(),
    activateSpiritHealer: jest.fn(),
    addFriend: jest.fn(),
    addIgnore: jest.fn(),
    armDefense: jest.fn((instruction: string) => defense.arm(instruction)),
    attack: jest.fn(),
    buyItem: jest.fn(),
    cancelCast: jest.fn(),
    cancelInteraction: jest.fn(),
    cast: jest.fn(),
    chooseQuestReward: jest.fn(),
    close: jest.fn(() => closeResolve()),
    closed,
    completeQuest: jest.fn(),
    declineGuildInvite: jest.fn(),
    declineInvite: jest.fn(),
    destroyItem: jest.fn(),
    disarmDefense: jest.fn(() => defense.disarm("command")),
    face: jest.fn(),
    faceGuid: jest.fn(),
    getChannel: jest.fn(),
    getCombatState: jest.fn(() => combat.snapshot()),
    getControlState: jest.fn((): ControlState => controlState),
    getCycleState: jest.fn(() => cycle.snapshot()),
    getDefenseState: jest.fn(() => defense.snapshot()),
    getDestroyState: jest.fn(() => ({
      lastOutcome: undefined,
      pending: undefined,
    })),
    getExperienceState: jest.fn(() => ({
      lastLevelUp: undefined,
      lastXp: undefined,
      level: undefined,
      nextLevelXp: undefined,
      xp: undefined,
    })),
    getFriends: jest.fn((): FriendEntry[] => []),
    getIgnored: jest.fn((): IgnoreEntry[] => []),
    getInventoryState: jest.fn(() =>
      labelInventory(rewards.snapshot().inventory, unanswered),
    ),
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
    getPartyState: jest.fn(() => new PartyStore().snapshot()),
    getQuestState: jest.fn(() => quests.snapshot()),
    getRecoveryState: jest.fn(() => recovery.snapshot()),
    getRemotePoses: jest.fn((): RemotePose[] => []),
    getRewardsState: jest.fn(() =>
      labelRewards(rewards.snapshot(), unanswered),
    ),
    getSpellbook: jest.fn(async () => []),
    getTacticsState: jest.fn(() => tacticsState),
    getTrainerState: jest.fn(async () => ({
      coinage: undefined,
      lastOutcome: undefined,
      level: undefined,
      offer: undefined,
      pending: undefined,
    })),
    getVendorState: jest.fn(() => ({
      ...vendor.snapshot(),
      window: undefined,
    })),
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
    observeNavigation: jest.fn(() =>
      observeNavigation(handle.getNavigationState()),
    ),
    onCombatEvent(cb) {
      return events.combat.subscribe(cb);
    },
    onControlEvent(cb) {
      return events.control.subscribe(cb);
    },
    onCycleEvent(cb) {
      return cycle.onEvent(cb);
    },
    onDefenseEvent(cb) {
      return events.defense.subscribe(cb);
    },
    onDestroyEvent(cb) {
      return events.destroy.subscribe(cb);
    },
    onDuelEvent(cb) {
      return events.duel.subscribe(cb);
    },
    onEntityEvent(cb) {
      return events.entity.subscribe(cb);
    },
    onFriendEvent(cb) {
      return events.friend.subscribe(cb);
    },
    onGroupEvent(cb) {
      return events.group.subscribe(cb);
    },
    onGuildEvent(cb) {
      return events.guild.subscribe(cb);
    },
    onIgnoreEvent(cb) {
      return events.ignore.subscribe(cb);
    },
    onMessage(cb) {
      return events.message.subscribe(cb);
    },
    onPacketError: jest.fn((cb: (opcode: number, err: Error) => void) =>
      events.packetError.subscribe(cb),
    ),
    onQuestEvent(cb) {
      return events.quest.subscribe(cb);
    },
    onRecoveryEvent(cb) {
      return events.recovery.subscribe(cb);
    },
    onRemoteMotionEvent(cb) {
      return events.remoteMotion.subscribe(cb);
    },
    onRewardsEvent(cb) {
      return events.rewards.subscribe(cb);
    },
    onTacticsEvent(cb) {
      return events.tactics.subscribe(cb);
    },
    onTrainerEvent(cb) {
      return events.trainer.subscribe(cb);
    },
    onVendorEvent(cb) {
      return events.vendor.subscribe(cb);
    },
    openLoot: jest.fn(),
    openTrainer: jest.fn(),
    openVendor: jest.fn(),
    queryCorpse: jest.fn(),
    queryNearby: jest.fn((query?: NearbyQuery) =>
      queryNearby(
        {
          control: handle.getControlState(),
          entities: handle.getNearbyEntities(),
          now: Date.now(),
          remotePoses: handle.getRemotePoses(),
        },
        query,
      ),
    ),
    queryQuest: jest.fn(),
    reclaimCorpse: jest.fn(),
    releaseLoot: jest.fn(),
    releaseSpirit: jest.fn(),
    removeFriend: jest.fn(),
    removeIgnore: jest.fn(),
    repairAll: jest.fn(),
    requestGuildRoster: jest.fn(
      async (): Promise<GuildRoster | undefined> => undefined,
    ),
    requestQuestReward: jest.fn(),
    resolveClosed() {
      closeResolve();
    },
    respondResurrection: jest.fn(),
    resumeCycle: jest.fn(
      (instruction: string | undefined, maxStarts: number | undefined) =>
        cycle.resume({ instruction, maxStarts }),
    ),
    rollLoot: jest.fn(),
    selectGossipOption: jest.fn(),
    selectQuest: jest.fn(),
    selectTarget: jest.fn(),
    sellItem: jest.fn(),
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
    startQuestCycle: jest.fn(async () => {}),
    startTactics: jest.fn(async () => {}),
    stopAttack: jest.fn(),
    stopCycle: jest.fn(() => {
      cycle.stop("manual_override");
    }),
    takeLoot: jest.fn(),
    takeLootMoney: jest.fn(),
    talk: jest.fn(),
    trainSpell: jest.fn(),
    triggerCombatEvent(event) {
      events.combat.emit(event);
    },
    triggerControlEvent(event) {
      events.control.emit(event);
    },
    triggerDuelEvent(event) {
      events.duel.emit(event);
    },
    triggerEntityEvent(event) {
      events.entity.emit(event);
    },
    triggerFriendEvent(event) {
      events.friend.emit(event);
    },
    triggerGroupEvent(event) {
      events.group.emit(event);
    },
    triggerGuildEvent(event) {
      events.guild.emit(event);
    },
    triggerIgnoreEvent(event) {
      events.ignore.emit(event);
    },
    triggerMessage(msg) {
      events.message.emit(msg);
    },
    triggerQuestEvent(event) {
      events.quest.emit(event);
    },
    triggerRecoveryEvent(event) {
      events.recovery.emit(event);
    },
    triggerRewardsEvent(event) {
      events.rewards.emit(event);
    },
    triggerTacticsEvent(event) {
      events.tactics.emit(event);
    },
    triggerVendorEvent(event) {
      events.vendor.emit(event);
    },
    uninvite: jest.fn(),
    useItem: jest.fn(async () => {}),
    walkToward: jest.fn(async () => {
      throw new Error("mock_walk_unavailable");
    }),
    who: jest.fn(async () => []),
  };
  return handle;
}

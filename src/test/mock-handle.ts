import { jest } from "bun:test";
import type {
  WorldHandle,
  ChatMessage,
  ChatMode,
  GroupEvent,
  DuelEvent,
  MoveEvent,
  CombatFeedEvent,
} from "wow/client";
import type { Entity, EntityEvent } from "wow/entity-store";
import type { FriendEntry, FriendEvent } from "wow/friend-store";
import type { IgnoreEntry, IgnoreEvent } from "wow/ignore-store";
import type { GuildRoster, GuildEvent } from "wow/guild-store";

export function createMockHandle(): WorldHandle & {
  triggerMessage(msg: ChatMessage): void;
  triggerGroupEvent(event: GroupEvent): void;
  triggerDuelEvent(event: DuelEvent): void;
  triggerEntityEvent(event: EntityEvent): void;
  triggerFriendEvent(event: FriendEvent): void;
  triggerIgnoreEvent(event: IgnoreEvent): void;
  triggerGuildEvent(event: GuildEvent): void;
  triggerMoveEvent(event: MoveEvent): void;
  triggerCombatEvent(event: CombatFeedEvent): void;
  resolveClosed(): void;
} {
  let messageCb: ((msg: ChatMessage) => void) | undefined;
  let groupEventCb: ((event: GroupEvent) => void) | undefined;
  let duelEventCb: ((event: DuelEvent) => void) | undefined;
  let entityEventCb: ((event: EntityEvent) => void) | undefined;
  let friendEventCb: ((event: FriendEvent) => void) | undefined;
  let ignoreEventCb: ((event: IgnoreEvent) => void) | undefined;
  let guildEventCb: ((event: GuildEvent) => void) | undefined;
  let moveEventCb: ((event: MoveEvent) => void) | undefined;
  let combatEventCb: ((event: CombatFeedEvent) => void) | undefined;
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
    moveTo: jest.fn(),
    follow: jest.fn(() => true),
    face: jest.fn(),
    stopMoving: jest.fn(),
    targetByName: jest.fn(() => true),
    attackTarget: jest.fn(() => true),
    stopAttack: jest.fn(),
    castSpell: jest.fn(() => true),
    lootTarget: jest.fn(() => true),
    hunt: jest.fn(() => true),
    releaseSpirit: jest.fn(),
    reclaimCorpse: jest.fn(),
    queryCorpse: jest.fn(),
    acceptResurrect: jest.fn(),
    sit: jest.fn(),
    stand: jest.fn(),
    getSpellbook: jest.fn((): number[] => []),
    getAuras: jest.fn(
      (): Array<{ spellId: number; remainingMs?: number }> => [],
    ),
    getVitals: jest.fn(() => ({
      health: 187,
      maxHealth: 187,
      mana: 472,
      maxMana: 472,
      level: 10,
      dead: false,
    })),
    getCombatState: jest.fn(() => "idle"),
    onCombatEvent(cb) {
      combatEventCb = cb;
    },
    triggerCombatEvent(event) {
      combatEventCb?.(event);
    },
    getOwnPosition: jest.fn(() => ({
      mapId: 0,
      x: 0,
      y: 0,
      z: 0,
      orientation: 0,
      moveFlags: 0,
      runSpeed: 7,
      state: { kind: "idle" as const },
    })),
    onMoveEvent(cb) {
      moveEventCb = cb;
    },
    triggerMoveEvent(event) {
      moveEventCb?.(event);
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
    resolveClosed() {
      closeResolve();
    },
  };
}

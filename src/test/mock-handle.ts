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
    selectTarget: jest.fn(),
    halt: jest.fn(),
    onControlEvent(cb) {
      controlEventCb = cb;
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

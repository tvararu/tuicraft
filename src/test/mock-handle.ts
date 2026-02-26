import { jest } from "bun:test";
import type {
  WorldHandle,
  ChatMessage,
  ChatMode,
  GroupEvent,
} from "wow/client";
import type { Entity, EntityEvent } from "wow/entity-store";

export function createMockHandle(): WorldHandle & {
  triggerMessage(msg: ChatMessage): void;
  triggerGroupEvent(event: GroupEvent): void;
  triggerEntityEvent(event: EntityEvent): void;
  resolveClosed(): void;
} {
  let messageCb: ((msg: ChatMessage) => void) | undefined;
  let groupEventCb: ((event: GroupEvent) => void) | undefined;
  let entityEventCb: ((event: EntityEvent) => void) | undefined;
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
    setLeader: jest.fn(),
    acceptInvite: jest.fn(),
    declineInvite: jest.fn(),
    onGroupEvent(cb) {
      groupEventCb = cb;
    },
    onEntityEvent(cb) {
      entityEventCb = cb;
    },
    onPacketError: jest.fn(),
    getNearbyEntities: jest.fn((): Entity[] => []),
    triggerMessage(msg) {
      messageCb?.(msg);
    },
    triggerGroupEvent(event) {
      groupEventCb?.(event);
    },
    triggerEntityEvent(event) {
      entityEventCb?.(event);
    },
    resolveClosed() {
      closeResolve();
    },
  };
}

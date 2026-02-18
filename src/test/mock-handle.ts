import { jest } from "bun:test";
import type { WorldHandle, ChatMessage } from "wow/client";

export function createMockHandle(): WorldHandle & {
  triggerMessage(msg: ChatMessage): void;
  resolveClosed(): void;
} {
  let messageCb: ((msg: ChatMessage) => void) | undefined;
  let closeResolve: () => void;
  const closed = new Promise<void>((r) => {
    closeResolve = r;
  });

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
    triggerMessage(msg) {
      messageCb?.(msg);
    },
    resolveClosed() {
      closeResolve();
    },
  };
}

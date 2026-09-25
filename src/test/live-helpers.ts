import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { startDaemonServer } from "daemon/server";
import { SessionLog } from "lib/session-log";
import { must } from "test/must";
import type {
  ChatMessage,
  EntityEvent,
  GroupEvent,
  WorldHandle,
} from "wow/client";

export type GpsFix = { map: number; x: number; y: number; z: number };

type GpsPos = { x: number; y: number; z: number };

export function parseGpsPos(msg: string): GpsPos | undefined {
  const posMatch = msg.match(/X: (-?[\d.]+) Y: (-?[\d.]+) Z: (-?[\d.]+)/);
  if (!posMatch) return undefined;
  return {
    x: Number.parseFloat(must(posMatch[1])),
    y: Number.parseFloat(must(posMatch[2])),
    z: Number.parseFloat(must(posMatch[3])),
  };
}

export function parseGpsMap(msg: string): number | undefined {
  const mapMatch = msg.match(/^Map: (\d+)/);
  if (!mapMatch) return undefined;
  return Number.parseInt(must(mapMatch[1]), 10);
}

export function parseGps(messages: ChatMessage[]): GpsFix | undefined {
  let map: number | undefined;
  let pos: GpsPos | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = must(messages[i]).message;
    pos ??= parseGpsPos(msg);
    map ??= parseGpsMap(msg);
    if (map !== undefined && pos !== undefined) break;
  }
  if (map === undefined || pos === undefined) return undefined;
  return { map, ...pos };
}

export function dist2d(a: GpsFix, b: GpsFix): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export async function appearBeside(
  handle: WorldHandle,
  self: string,
  target: string,
): Promise<() => Promise<void>> {
  const chat: ChatMessage[] = [];
  handle.onMessage((m) => chat.push(m));
  handle.sendWhisper(self, ".gps");
  await Bun.sleep(2500);
  const home = must(parseGps(chat));
  handle.sendWhisper(self, `.appear ${target}`);
  await Bun.sleep(2500);
  return async () => {
    handle.sendWhisper(
      self,
      `.go xyz ${home.x} ${home.y} ${home.z} ${home.map}`,
    );
    await Bun.sleep(2500);
  };
}

export async function daemonSock(
  handle: WorldHandle,
  tag: string,
): Promise<{ sock: string; log: string; close: () => Promise<void> }> {
  const sockPath = join("./tmp", `test-fault-${tag}-${Date.now()}.sock`);
  const logFile = join("./tmp", `test-fault-${tag}-${Date.now()}.log`);
  const log = new SessionLog(logFile);
  const { server } = startDaemonServer({ handle, log, sock: sockPath });
  return {
    close: async () => {
      server.stop(true);
      await unlink(sockPath).catch(() => {});
      await unlink(logFile).catch(() => {});
    },
    log: logFile,
    sock: sockPath,
  };
}

export function waitForGroupEvent<T extends GroupEvent["type"]>(
  events: GroupEvent[],
  type: T,
  filter?: (e: Extract<GroupEvent, { type: T }>) => boolean,
  timeoutMs = 5000,
): Promise<Extract<GroupEvent, { type: T }>> {
  const startIdx = events.length;
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`timeout waiting for ${type}`));
    }, timeoutMs);
    const poll = setInterval(() => {
      for (let i = startIdx; i < events.length; i++) {
        const e = must(events[i]);
        if (
          e.type === type &&
          (!filter || filter(e as Extract<GroupEvent, { type: T }>))
        ) {
          clearInterval(poll);
          clearTimeout(deadline);
          resolve(e as Extract<GroupEvent, { type: T }>);
          return;
        }
      }
    }, 50);
  });
}

export function waitForEntityEvent<T extends EntityEvent["type"]>(
  events: EntityEvent[],
  type: T,
  filter?: (e: Extract<EntityEvent, { type: T }>) => boolean,
  timeoutMs = 10_000,
): Promise<Extract<EntityEvent, { type: T }>> {
  const startIdx = events.length;
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`timeout waiting for entity ${type}`));
    }, timeoutMs);
    const poll = setInterval(() => {
      for (let i = startIdx; i < events.length; i++) {
        const e = must(events[i]);
        if (
          e.type === type &&
          (!filter || filter(e as Extract<EntityEvent, { type: T }>))
        ) {
          clearInterval(poll);
          clearTimeout(deadline);
          resolve(e as Extract<EntityEvent, { type: T }>);
          return;
        }
      }
    }, 50);
  });
}

export function waitUntil(
  check: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      clearInterval(poll);
      reject(new Error("timeout waiting for condition"));
    }, timeoutMs);
    const poll = setInterval(() => {
      if (!check()) return;
      clearInterval(poll);
      clearTimeout(deadline);
      resolve();
    }, 50);
  });
}

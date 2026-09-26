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
import type { Position } from "wow/entity-store";

export type GpsFix = {
  map: number;
  x: number;
  y: number;
  z: number;
  orientation: number;
};

export type Spot = Omit<GpsFix, "orientation"> & { orientation?: number };

export const SUNSTRIDER_SPAWN: Spot = {
  map: 530,
  orientation: 5.316_05,
  x: 10_349.6,
  y: -6357.29,
  z: 33.4026,
};

type GpsPos = Omit<GpsFix, "map">;

function parseGpsPos(msg: string): GpsPos | undefined {
  const posMatch = msg.match(
    /X: (-?[\d.]+) Y: (-?[\d.]+) Z: (-?[\d.]+) Orientation: (-?[\d.]+)/,
  );
  if (!posMatch) return undefined;
  return {
    orientation: Number.parseFloat(must(posMatch[4])),
    x: Number.parseFloat(must(posMatch[1])),
    y: Number.parseFloat(must(posMatch[2])),
    z: Number.parseFloat(must(posMatch[3])),
  };
}

function parseGpsMap(msg: string): number | undefined {
  const mapMatch = msg.match(/^Map: (\d+)/);
  if (!mapMatch) return undefined;
  return Number.parseInt(must(mapMatch[1]), 10);
}

function parseGps(messages: ChatMessage[]): GpsFix | undefined {
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

export function dist2d(a: Spot, b: Spot): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function near(
  pose: Position | undefined,
  spot: Spot,
  yards: number,
): boolean {
  return (
    pose?.mapId === spot.map &&
    Math.hypot(pose.x - spot.x, pose.y - spot.y) < yards
  );
}

export function goXyz({ map, x, y, z, orientation }: Spot): string {
  return [".go xyz", x, y, z, map, orientation]
    .filter((part) => part !== undefined)
    .join(" ");
}

export async function gps(handle: WorldHandle, self: string): Promise<GpsFix> {
  const chat: ChatMessage[] = [];
  const unsubscribe = handle.onMessage((m) => chat.push(m));
  try {
    handle.sendWhisper(self, ".gps");
    await waitUntil(() => parseGps(chat) !== undefined);
    return must(parseGps(chat));
  } finally {
    unsubscribe();
  }
}

function returnTo(
  handle: WorldHandle,
  self: string,
  home: GpsFix,
): () => Promise<void> {
  return async () => {
    handle.sendWhisper(self, goXyz(home));
    await Bun.sleep(2500);
  };
}

export async function standAt(
  handle: WorldHandle,
  self: string,
  spot: Spot,
): Promise<{ start: GpsFix; restore: () => Promise<void> }> {
  const home = await gps(handle, self);
  handle.sendWhisper(self, goXyz(spot));
  await waitUntil(() => near(handle.getControlState().serverPose, spot, 1));
  const start = await gps(handle, self);
  if (start.map !== spot.map || dist2d(start, spot) >= 1) {
    throw new Error(`${goXyz(spot)} left the character at ${goXyz(start)}`);
  }
  return { restore: returnTo(handle, self, home), start };
}

export async function appearBeside(
  handle: WorldHandle,
  self: string,
  target: string,
): Promise<() => Promise<void>> {
  const home = await gps(handle, self);
  handle.sendWhisper(self, `.appear ${target}`);
  await Bun.sleep(2500);
  return returnTo(handle, self, home);
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
      handle.close();
      await handle.closed;
      await log.flush();
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

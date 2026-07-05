import { openNavMap, type NavMap, type Vec3 } from "nav/namigator";

export type NavRoute = {
  findPath(start: Vec3, end: Vec3): Vec3[] | undefined;
  groundHeight(from: Vec3, toX: number, toY: number): number | undefined;
};

export type NavProvider = {
  forMap(mapId: number): NavRoute | undefined;
  close(): void;
};

export const MAP_NAMES: Record<number, string> = {
  0: "Azeroth",
  1: "Kalimdor",
  530: "Expansion01",
  571: "Northrend",
};

const ADT_SIZE = 533.33333;

function adtKey(x: number, y: number): string {
  const adtX = Math.floor((32 * ADT_SIZE - y) / ADT_SIZE);
  const adtY = Math.floor((32 * ADT_SIZE - x) / ADT_SIZE);
  return `${adtX},${adtY}`;
}

export function openNavProvider(libPath: string, dataDir: string): NavProvider {
  const maps = new Map<number, NavRoute | undefined>();
  const open: NavMap[] = [];

  function createRoute(mapName: string): NavRoute | undefined {
    let map: NavMap;
    try {
      map = openNavMap(libPath, dataDir, mapName);
    } catch {
      return undefined;
    }
    open.push(map);
    const loaded = new Set<string>();

    function ensureAdt(x: number, y: number): void {
      const key = adtKey(x, y);
      if (loaded.has(key)) return;
      if (map.loadAdtAt(x, y)) loaded.add(key);
    }

    function ensureCorridor(start: Vec3, end: Vec3): void {
      const dist = Math.hypot(end.x - start.x, end.y - start.y);
      const steps = Math.max(1, Math.ceil(dist / (ADT_SIZE / 2)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = start.x + (end.x - start.x) * t;
        const y = start.y + (end.y - start.y) * t;
        for (const dx of [-100, 0, 100]) {
          for (const dy of [-100, 0, 100]) {
            ensureAdt(x + dx, y + dy);
          }
        }
      }
    }

    return {
      findPath(start, end) {
        ensureCorridor(start, end);
        return map.findPath(start, end);
      },
      groundHeight(from, toX, toY) {
        ensureAdt(toX, toY);
        return map.findHeight(from, toX, toY);
      },
    };
  }

  return {
    forMap(mapId) {
      if (maps.has(mapId)) return maps.get(mapId);
      const name = MAP_NAMES[mapId];
      const route = name ? createRoute(name) : undefined;
      maps.set(mapId, route);
      return route;
    },
    close() {
      for (const map of open) map.free();
      maps.clear();
      open.length = 0;
    },
  };
}

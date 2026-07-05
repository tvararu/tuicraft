import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";

export type Vec3 = { x: number; y: number; z: number };

export type NavMap = {
  loadAllAdts(): number;
  loadAdtAt(x: number, y: number): boolean;
  findPath(start: Vec3, end: Vec3): Vec3[] | undefined;
  findHeight(start: Vec3, stopX: number, stopY: number): number | undefined;
  findHeights(x: number, y: number): number[];
  lineOfSight(from: Vec3, to: Vec3, doodads?: boolean): boolean | undefined;
  zoneAndArea(pos: Vec3): { zone: number; area: number } | undefined;
  free(): void;
};

const SUCCESS = 0;
const BUFFER_TOO_SMALL = 82;
const UNKNOWN_PATH = 83;
const UNKNOWN_HEIGHT = 84;

function cstr(s: string): Uint8Array {
  return new TextEncoder().encode(`${s}\0`);
}

export function openNavLib(libPath: string) {
  const lib = dlopen(libPath, {
    pathfind_new_map: {
      args: [FFIType.cstring, FFIType.cstring, FFIType.ptr],
      returns: FFIType.ptr,
    },
    pathfind_free_map: { args: [FFIType.ptr], returns: FFIType.void },
    pathfind_load_all_adts: {
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.u8,
    },
    pathfind_load_adt_at: {
      args: [FFIType.ptr, FFIType.f32, FFIType.f32, FFIType.ptr, FFIType.ptr],
      returns: FFIType.u8,
    },
    pathfind_find_path: {
      args: [
        FFIType.ptr,
        FFIType.f32,
        FFIType.f32,
        FFIType.f32,
        FFIType.f32,
        FFIType.f32,
        FFIType.f32,
        FFIType.ptr,
        FFIType.u32,
        FFIType.ptr,
      ],
      returns: FFIType.u8,
    },
    pathfind_find_height: {
      args: [
        FFIType.ptr,
        FFIType.f32,
        FFIType.f32,
        FFIType.f32,
        FFIType.f32,
        FFIType.f32,
        FFIType.ptr,
      ],
      returns: FFIType.u8,
    },
    pathfind_find_heights: {
      args: [
        FFIType.ptr,
        FFIType.f32,
        FFIType.f32,
        FFIType.ptr,
        FFIType.u32,
        FFIType.ptr,
      ],
      returns: FFIType.u8,
    },
    pathfind_line_of_sight: {
      args: [
        FFIType.ptr,
        FFIType.f32,
        FFIType.f32,
        FFIType.f32,
        FFIType.f32,
        FFIType.f32,
        FFIType.f32,
        FFIType.ptr,
        FFIType.u8,
      ],
      returns: FFIType.u8,
    },
    pathfind_get_zone_and_area: {
      args: [
        FFIType.ptr,
        FFIType.f32,
        FFIType.f32,
        FFIType.f32,
        FFIType.ptr,
        FFIType.ptr,
      ],
      returns: FFIType.u8,
    },
  });
  return lib;
}

export function openNavMap(
  libPath: string,
  navDataDir: string,
  mapName: string,
): NavMap {
  const { symbols } = openNavLib(libPath);
  const result = new Uint8Array(1);
  const map = symbols.pathfind_new_map(
    ptr(cstr(navDataDir)),
    ptr(cstr(mapName)),
    ptr(result),
  ) as Pointer | null;
  if (!map) {
    throw new Error(
      `pathfind_new_map failed for "${mapName}" in ${navDataDir} (code ${result[0]})`,
    );
  }

  return {
    loadAllAdts() {
      const count = new Int32Array(1);
      const code = symbols.pathfind_load_all_adts(map, ptr(count));
      if (code !== SUCCESS)
        throw new Error(`pathfind_load_all_adts failed (code ${code})`);
      return count[0]!;
    },
    loadAdtAt(x, y) {
      const outX = new Float32Array(1);
      const outY = new Float32Array(1);
      const code = symbols.pathfind_load_adt_at(
        map,
        x,
        y,
        ptr(outX),
        ptr(outY),
      );
      return code === SUCCESS;
    },
    findPath(start, end) {
      let capacity = 32;
      for (let attempt = 0; attempt < 4; attempt++) {
        const buffer = new Float32Array(capacity * 3);
        const count = new Uint32Array(1);
        const code = symbols.pathfind_find_path(
          map,
          start.x,
          start.y,
          start.z,
          end.x,
          end.y,
          end.z,
          ptr(buffer),
          capacity,
          ptr(count),
        );
        if (code === SUCCESS) {
          const verts: Vec3[] = [];
          for (let i = 0; i < count[0]!; i++) {
            verts.push({
              x: buffer[i * 3]!,
              y: buffer[i * 3 + 1]!,
              z: buffer[i * 3 + 2]!,
            });
          }
          return verts;
        }
        if (code === BUFFER_TOO_SMALL) {
          capacity = Math.max(count[0]!, capacity * 2);
          continue;
        }
        if (code === UNKNOWN_PATH) return undefined;
        throw new Error(`pathfind_find_path failed (code ${code})`);
      }
      return undefined;
    },
    findHeight(start, stopX, stopY) {
      const stopZ = new Float32Array(1);
      const code = symbols.pathfind_find_height(
        map,
        start.x,
        start.y,
        start.z,
        stopX,
        stopY,
        ptr(stopZ),
      );
      if (code === UNKNOWN_HEIGHT) return undefined;
      if (code !== SUCCESS)
        throw new Error(`pathfind_find_height failed (code ${code})`);
      return stopZ[0]!;
    },
    findHeights(x, y) {
      const buffer = new Float32Array(64);
      const count = new Uint32Array(1);
      const code = symbols.pathfind_find_heights(
        map,
        x,
        y,
        ptr(buffer),
        64,
        ptr(count),
      );
      if (code !== SUCCESS) return [];
      return [...buffer.slice(0, count[0]!)];
    },
    lineOfSight(from, to, doodads = true) {
      const los = new Uint8Array(1);
      const code = symbols.pathfind_line_of_sight(
        map,
        from.x,
        from.y,
        from.z,
        to.x,
        to.y,
        to.z,
        ptr(los),
        doodads ? 1 : 0,
      );
      if (code !== SUCCESS) return undefined;
      return los[0] === 1;
    },
    zoneAndArea(pos) {
      const zone = new Uint32Array(1);
      const area = new Uint32Array(1);
      const code = symbols.pathfind_get_zone_and_area(
        map,
        pos.x,
        pos.y,
        pos.z,
        ptr(zone),
        ptr(area),
      );
      if (code !== SUCCESS) return undefined;
      return { zone: zone[0]!, area: area[0]! };
    },
    free() {
      symbols.pathfind_free_map(map);
    },
  };
}

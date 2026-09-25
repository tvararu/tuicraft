import { dlopen, FFIType, ptr } from "bun:ffi";
import { existsSync } from "node:fs";

export type NativePoint = { x: number; y: number; z: number };

export type NativeMap = {
  loadAdtAt(x: number, y: number): void;
  findHeights(x: number, y: number): number[];
  findHeight(from: NativePoint, x: number, y: number): number;
  lineOfSight(from: NativePoint, to: NativePoint): boolean;
  findPath(from: NativePoint, to: NativePoint): NativePoint[];
  close(): void;
};

const GEOMETRY_REJECTION = Symbol("navigation_geometry");
type GroundError = Error & { [GEOMETRY_REJECTION]: true };
type Ptr = number;

type NamigatorSymbols = {
  pathfind_new_map: (data: Ptr, name: Ptr, result: Ptr) => Ptr;
  pathfind_free_map: (map: Ptr) => void;
  pathfind_load_adt_at: (
    map: Ptr,
    x: number,
    y: number,
    outX: Ptr,
    outY: Ptr,
  ) => number;
  pathfind_find_path: (
    map: Ptr,
    startX: number,
    startY: number,
    startZ: number,
    stopX: number,
    stopY: number,
    stopZ: number,
    buffer: Ptr,
    bufferLength: number,
    count: Ptr,
  ) => number;
  pathfind_find_height: (
    map: Ptr,
    startX: number,
    startY: number,
    startZ: number,
    stopX: number,
    stopY: number,
    height: Ptr,
  ) => number;
  pathfind_line_of_sight: (
    map: Ptr,
    startX: number,
    startY: number,
    startZ: number,
    stopX: number,
    stopY: number,
    stopZ: number,
    visible: Ptr,
    doodads: number,
  ) => number;
  pathfind_find_heights: (
    map: Ptr,
    x: number,
    y: number,
    buffer: Ptr,
    bufferLength: number,
    count: Ptr,
  ) => number;
};

const ADT_MID = 32 * (533 + 1 / 3);
const ADT_SIZE = Math.fround(533 + 1 / 3);
const SUCCESS = 0;
const BUFFER_TOO_SMALL = 82;
const UNKNOWN_PATH = 83;
const UNKNOWN_HEIGHT = 84;
const FAILED_TO_LOAD_ADT = 86;
const MAP_DOES_NOT_HAVE_ADT = 87;
const UNKNOWN_EXCEPTION = 0xff;

const ERRORS: Record<number, string> = {
  [UNKNOWN_PATH]: "UNKNOWN_PATH",
  [UNKNOWN_HEIGHT]: "UNKNOWN_HEIGHT",
  [FAILED_TO_LOAD_ADT]: "FAILED_TO_LOAD_ADT",
  [MAP_DOES_NOT_HAVE_ADT]: "MAP_DOES_NOT_HAVE_ADT",
  [UNKNOWN_EXCEPTION]: "UNKNOWN_EXCEPTION",
};

export function openNativeMap(
  dataPath: string,
  libraryPath: string,
  mapName: string,
): NativeMap {
  if (!existsSync(libraryPath))
    throw new Error(`navigation library not found: ${libraryPath}`);
  const mapFile = `${dataPath.replace(/\/$/, "")}/${mapName}.map`;
  if (!existsSync(mapFile))
    throw new Error(`navigation data not found: ${mapFile}`);
  const data = cstr(dataPath);
  const name = cstr(mapName);
  const library = dlopen(libraryPath, {
    pathfind_new_map: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.ptr,
    },
    pathfind_free_map: { args: [FFIType.ptr], returns: FFIType.void },
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
  });
  const symbols = library.symbols as unknown as NamigatorSymbols;
  const status = new Uint8Array(1);
  const handle = symbols.pathfind_new_map(ptr(data), ptr(name), ptr(status));
  if (!handle || status[0] !== SUCCESS) {
    if (handle) symbols.pathfind_free_map(handle);
    library.close();
    throw new Error(
      `pathfind_new_map failed (${errorName(status[0] ?? UNKNOWN_EXCEPTION)})`,
    );
  }
  return new NamigatorMap(symbols, handle, () => library.close());
}

class NamigatorMap implements NativeMap {
  private handle: Ptr | null;
  private readonly symbols: NamigatorSymbols;
  private readonly closeLibrary: () => void;

  constructor(
    symbols: NamigatorSymbols,
    handle: Ptr,
    closeLibrary: () => void,
  ) {
    this.symbols = symbols;
    this.handle = handle;
    this.closeLibrary = closeLibrary;
  }

  loadAdtAt(x: number, y: number): void {
    validateNativeXY(x, y);
    const outX = new Float32Array(1);
    const outY = new Float32Array(1);
    const code = this.symbols.pathfind_load_adt_at(
      this.requireHandle(),
      x,
      y,
      ptr(outX),
      ptr(outY),
    );
    if (code !== SUCCESS) throw nativeError("pathfind_load_adt_at", code);
  }

  findHeights(x: number, y: number): number[] {
    validateNativeXY(x, y);
    const count = new Uint32Array(1);
    for (let capacity = 8; capacity <= 4096; capacity *= 2) {
      const heights = new Float32Array(capacity);
      const code = this.symbols.pathfind_find_heights(
        this.requireHandle(),
        x,
        y,
        ptr(heights),
        capacity,
        ptr(count),
      );
      if (code === BUFFER_TOO_SMALL) continue;
      if (code === UNKNOWN_HEIGHT) return [];
      if (code !== SUCCESS) throw nativeError("pathfind_find_heights", code);
      if (count[0]! > capacity)
        throw new Error("native height count exceeds buffer");
      return Array.from(heights.subarray(0, count[0]!));
    }
    throw new Error("native height column exceeds supported capacity");
  }

  findHeight(from: NativePoint, x: number, y: number): number {
    validateNativePoint(from);
    validateNativeXY(x, y);
    const height = new Float32Array(1);
    const code = this.symbols.pathfind_find_height(
      this.requireHandle(),
      from.x,
      from.y,
      from.z,
      x,
      y,
      ptr(height),
    );
    if (code === UNKNOWN_HEIGHT)
      throw groundError("pathfind_find_height failed (UNKNOWN_HEIGHT)");
    if (code !== SUCCESS) throw nativeError("pathfind_find_height", code);
    return height[0]!;
  }

  lineOfSight(from: NativePoint, to: NativePoint): boolean {
    validateNativePoint(from);
    validateNativePoint(to);
    const visible = new Uint8Array(1);
    const code = this.symbols.pathfind_line_of_sight(
      this.requireHandle(),
      from.x,
      from.y,
      from.z,
      to.x,
      to.y,
      to.z,
      ptr(visible),
      1,
    );
    if (code !== SUCCESS) throw nativeError("pathfind_line_of_sight", code);
    return visible[0] === 1;
  }

  findPath(from: NativePoint, to: NativePoint): NativePoint[] {
    validateNativePoint(from);
    validateNativePoint(to);
    const count = new Uint32Array(1);
    let verts = new Float32Array(64 * 3);
    let code = this.callFindPath(from, to, verts, count);
    if (code === BUFFER_TOO_SMALL) {
      if (count[0]! > 4096)
        throw new Error("native path exceeds supported capacity");
      verts = new Float32Array(Math.max(count[0]!, 64) * 3);
      code = this.callFindPath(from, to, verts, count);
    }
    if (code !== SUCCESS) throw nativeError("pathfind_find_path", code);
    if (count[0]! > verts.length / 3)
      throw new Error("native path count exceeds buffer");
    return readVertices(verts, count[0]!);
  }

  close(): void {
    if (this.handle === null) return;
    const handle = this.handle;
    this.handle = null;
    try {
      this.symbols.pathfind_free_map(handle);
    } finally {
      this.closeLibrary();
    }
  }

  private callFindPath(
    from: NativePoint,
    to: NativePoint,
    verts: Float32Array,
    count: Uint32Array,
  ): number {
    return this.symbols.pathfind_find_path(
      this.requireHandle(),
      from.x,
      from.y,
      from.z,
      to.x,
      to.y,
      to.z,
      ptr(verts),
      verts.length / 3,
      ptr(count),
    );
  }

  private requireHandle(): Ptr {
    if (this.handle === null) throw new Error("navigation map is closed");
    return this.handle;
  }
}

function cstr(value: string): Uint8Array {
  if (value.includes("\0")) throw new Error("native path contains a null byte");
  return new TextEncoder().encode(`${value}\0`);
}

function readVertices(verts: Float32Array, count: number): NativePoint[] {
  const points: NativePoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      x: verts[i * 3]!,
      y: verts[i * 3 + 1]!,
      z: verts[i * 3 + 2]!,
    });
  }
  return points;
}

function errorName(code: number): string {
  return ERRORS[code] ?? `code ${code}`;
}

function nativeError(op: string, code: number): Error {
  return new Error(`${op} failed (${errorName(code)})`);
}

export function validateNativePoint(point: NativePoint): void {
  validateNativeXY(point.x, point.y);
  if (!Number.isFinite(Math.fround(point.z)))
    throw new Error("invalid native coordinate z");
}

export function validateNativeXY(x: number, y: number): void {
  if (!(insideAdts(x) && insideAdts(y)))
    throw new Error("native coordinate outside the 64x64 ADT domain");
}

function insideAdts(value: number): boolean {
  const coordinate = Math.fround(value);
  const index = (ADT_MID - coordinate) / ADT_SIZE;
  return (
    Number.isFinite(coordinate) &&
    Math.abs(value) <= ADT_MID &&
    index >= 0 &&
    index < 64
  );
}

export function groundError(message: string): GroundError {
  return Object.assign(new Error(message), {
    [GEOMETRY_REJECTION]: true as const,
  });
}

export function isGroundError(error: unknown): error is GroundError {
  return (
    error instanceof Error &&
    GEOMETRY_REJECTION in error &&
    error[GEOMETRY_REJECTION] === true
  );
}

export type DbcSpec = {
  file: string;
  fields: number;
  recordSize: number;
};

export type DbcFile = {
  name: string;
  fields: number;
  records: DataView;
  strings: Uint8Array;
  recordCount: number;
  byId: Map<number, number>;
};

const utf8 = new TextDecoder("utf-8");

export async function openDbc(
  directory: string,
  spec: DbcSpec,
): Promise<DbcFile> {
  const path = `${directory.replace(/\/$/, "")}/${spec.file}`;
  const handle = Bun.file(path);
  if (!(await handle.exists()))
    throw new Error(`missing ${spec.file} in ${directory}`);
  return parseDbc(spec, new Uint8Array(await handle.arrayBuffer()));
}

type DbcHeader = {
  recordCount: number;
  recordSize: number;
  stringBlockSize: number;
};

function readHeader(spec: DbcSpec, bytes: Uint8Array): DbcHeader {
  const { file: name, fields, recordSize } = spec;
  if (bytes.byteLength < 20) throw new Error(`${name}: truncated header`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== "WDBC") throw new Error(`${name}: expected WDBC, got ${magic}`);
  const fieldCount = view.getUint32(8, true);
  const recSize = view.getUint32(12, true);
  if (fieldCount !== fields || recSize !== recordSize)
    throw new Error(
      `${name}: unsupported layout fields=${fieldCount} recordSize=${recSize} (need ${fields}x${recordSize} for build 12340)`,
    );
  return {
    recordCount: view.getUint32(4, true),
    recordSize,
    stringBlockSize: view.getUint32(16, true),
  };
}

export function parseDbc(spec: DbcSpec, bytes: Uint8Array): DbcFile {
  const { file: name, fields } = spec;
  const { recordCount, recordSize, stringBlockSize } = readHeader(spec, bytes);
  const recordBytes = recordCount * recordSize;
  const expected = 20 + recordBytes + stringBlockSize;
  if (bytes.byteLength !== expected)
    throw new Error(
      `${name}: truncated (expected ${expected} bytes, got ${bytes.byteLength})`,
    );
  const records = new DataView(
    bytes.buffer,
    bytes.byteOffset + 20,
    recordBytes,
  );
  const strings = bytes.subarray(20 + recordBytes);
  const byId = indexById(records, recordCount, fields);
  return { name, fields, records, strings, recordCount, byId };
}

function indexById(
  records: DataView,
  recordCount: number,
  fields: number,
): Map<number, number> {
  const byId = new Map<number, number>();
  for (let row = 0; row < recordCount; row++) {
    byId.set(records.getUint32(row * fields * 4, true), row);
  }
  return byId;
}

export function u32(file: DbcFile, row: number, col: number): number {
  return file.records.getUint32((row * file.fields + col) * 4, true);
}

export function i32(file: DbcFile, row: number, col: number): number {
  return file.records.getInt32((row * file.fields + col) * 4, true);
}

export function f32(file: DbcFile, row: number, col: number): number {
  return file.records.getFloat32((row * file.fields + col) * 4, true);
}

export function readString(file: DbcFile, row: number, col: number): string {
  const offset = u32(file, row, col);
  if (offset >= file.strings.byteLength) return "";
  let end = offset;
  while (end < file.strings.byteLength && file.strings[end] !== 0) end++;
  return utf8.decode(file.strings.subarray(offset, end));
}

export function localeString(
  file: DbcFile,
  row: number,
  start: number,
): string {
  let fallback = "";
  for (let slot = 0; slot < 16; slot++) {
    const text = readString(file, row, start + slot);
    if (text.length === 0) continue;
    if (slot === 0) return text;
    if (fallback.length === 0) fallback = text;
  }
  return fallback;
}

export function joinRow(file: DbcFile, id: number): number | undefined {
  if (id === 0) return undefined;
  return file.byId.get(id);
}

export class DbcTable<T> {
  private readonly cache = new Map<number, T>();

  constructor(
    readonly file: DbcFile,
    private readonly decode: (file: DbcFile, row: number) => T,
  ) {}

  get(id: number): T | undefined {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const row = this.file.byId.get(id);
    if (row === undefined) return undefined;
    const value = this.decode(this.file, row);
    this.cache.set(id, value);
    return value;
  }
}

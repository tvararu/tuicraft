import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFactionTemplates } from "wow/faction-template";

const FIELDS = 14;
const dirs: string[] = [];

async function emptyDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "faction-template-"));
  dirs.push(dir);
  return dir;
}

function packDbc(rows: number[][]): Uint8Array {
  const recordSize = FIELDS * 4;
  const strings = new Uint8Array([0]);
  const buf = new Uint8Array(20 + rows.length * recordSize + 1);
  const view = new DataView(buf.buffer);
  buf[0] = 0x57;
  buf[1] = 0x44;
  buf[2] = 0x42;
  buf[3] = 0x43;
  view.setUint32(4, rows.length, true);
  view.setUint32(8, FIELDS, true);
  view.setUint32(12, recordSize, true);
  view.setUint32(16, 1, true);
  let offset = 20;
  for (const row of rows) {
    for (let col = 0; col < FIELDS; col++) {
      view.setUint32(offset + col * 4, row[col] ?? 0, true);
    }
    offset += recordSize;
  }
  buf.set(strings, offset);
  return buf;
}

function templateRow(cells: Record<number, number>): number[] {
  const row = new Array<number>(FIELDS).fill(0);
  for (const [key, value] of Object.entries(cells)) row[Number(key)] = value;
  return row;
}

async function writeTemplates(rows: number[][]): Promise<string> {
  const dir = await emptyDir();
  await Bun.write(join(dir, "FactionTemplate.dbc"), packDbc(rows));
  return dir;
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("loadFactionTemplates", () => {
  test("fails when FactionTemplate.dbc is missing", async () => {
    const dir = await emptyDir();
    await expect(loadFactionTemplates(dir)).rejects.toThrow(
      /FactionTemplate\.dbc/,
    );
  });

  test("fails on unsupported layout", async () => {
    const dir = await emptyDir();
    const buf = packDbc([templateRow({ 0: 1 })]);
    const view = new DataView(buf.buffer);
    view.setUint32(8, 4, true);
    view.setUint32(12, 16, true);
    await Bun.write(
      join(dir, "FactionTemplate.dbc"),
      buf.subarray(0, 20 + 16 + 1),
    );
    await expect(loadFactionTemplates(dir)).rejects.toThrow(/14/);
  });
});

describe("FactionTemplateCatalog.relation", () => {
  test("returns unknown for missing templates instead of inventing hostility", async () => {
    const catalog = await loadFactionTemplates(
      await writeTemplates([templateRow({ 0: 1, 1: 10, 3: 2, 4: 2 })]),
    );
    expect(catalog.get(99)).toBeUndefined();
    expect(catalog.relation(1, 99)).toBe("unknown");
    expect(catalog.relation(99, 1)).toBe("unknown");
  });

  test("treats the same parent faction as friendly", async () => {
    const catalog = await loadFactionTemplates(
      await writeTemplates([
        templateRow({ 0: 1, 1: 67, 3: 2 }),
        templateRow({ 0: 2, 1: 67, 3: 2 }),
      ]),
    );
    expect(catalog.relation(1, 2)).toBe("friendly");
  });

  test("uses explicit enemy and friend faction lists", async () => {
    const catalog = await loadFactionTemplates(
      await writeTemplates([
        templateRow({ 0: 10, 1: 100, 6: 200 }),
        templateRow({ 0: 11, 1: 200 }),
        templateRow({ 0: 12, 1: 100, 10: 300 }),
        templateRow({ 0: 13, 1: 300 }),
      ]),
    );
    expect(catalog.relation(10, 11)).toBe("hostile");
    expect(catalog.relation(12, 13)).toBe("friendly");
  });

  test("applies group masks when lists are empty", async () => {
    const catalog = await loadFactionTemplates(
      await writeTemplates([
        templateRow({ 0: 1, 1: 1, 3: 2, 4: 2, 5: 4 }),
        templateRow({ 0: 2, 1: 2, 3: 4, 4: 4, 5: 2 }),
        templateRow({ 0: 3, 1: 3, 3: 8 }),
      ]),
    );
    expect(catalog.relation(1, 2)).toBe("hostile");
    expect(catalog.relation(1, 1)).toBe("friendly");
    expect(catalog.relation(1, 3)).toBe("neutral");
  });

  test("returns unknown when friend and enemy rules conflict", async () => {
    const catalog = await loadFactionTemplates(
      await writeTemplates([
        templateRow({ 0: 1, 1: 50, 6: 50 }),
        templateRow({ 0: 2, 1: 50 }),
      ]),
    );
    expect(catalog.relation(1, 2)).toBe("unknown");
  });
});

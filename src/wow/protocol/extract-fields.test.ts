import { describe, expect, test } from "bun:test";
import { OBJECT_FIELDS, UNIT_FIELDS, GAMEOBJECT_FIELDS } from "./entity-fields";
import {
  extractObjectFields,
  extractUnitFields,
  extractGameObjectFields,
} from "./extract-fields";

function floatBits(value: number): number {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, true);
  return new DataView(buf).getUint32(0, true);
}

describe("extractObjectFields", () => {
  test("extracts entry", () => {
    const raw = new Map([[OBJECT_FIELDS.ENTRY.offset, 12345]]);
    const result = extractObjectFields(raw);
    expect(result.entry).toBe(12345);
    expect(result._changed).toContain("entry");
  });

  test("extracts scale as float", () => {
    const raw = new Map([[OBJECT_FIELDS.SCALE_X.offset, floatBits(1.5)]]);
    const result = extractObjectFields(raw);
    expect(result.scale).toBeCloseTo(1.5);
    expect(result._changed).toContain("scale");
  });

  test("extracts guid as bigint from two fields", () => {
    const raw = new Map([
      [OBJECT_FIELDS.GUID.offset, 42],
      [OBJECT_FIELDS.GUID.offset + 1, 0],
    ]);
    const result = extractObjectFields(raw);
    expect(result.guid).toBe(42n);
    expect(result._changed).toContain("guid");
  });

  test("extracts guid with high bits", () => {
    const raw = new Map([
      [OBJECT_FIELDS.GUID.offset, 1],
      [OBJECT_FIELDS.GUID.offset + 1, 3],
    ]);
    const result = extractObjectFields(raw);
    expect(result.guid).toBe((3n << 32n) | 1n);
  });

  test("empty map returns empty changed", () => {
    const result = extractObjectFields(new Map());
    expect(result._changed).toHaveLength(0);
  });

  test("fallback preserves guid high word on partial update", () => {
    const raw = new Map([[OBJECT_FIELDS.GUID.offset, 99]]);
    const fallback = new Map([[OBJECT_FIELDS.GUID.offset + 1, 7]]);
    const result = extractObjectFields(raw, fallback);
    expect(result.guid).toBe((7n << 32n) | 99n);
    expect(result._changed).toContain("guid");
  });
});

describe("extractUnitFields", () => {
  test("extracts health and level", () => {
    const raw = new Map([
      [UNIT_FIELDS.HEALTH.offset, 5000],
      [UNIT_FIELDS.MAXHEALTH.offset, 8000],
      [UNIT_FIELDS.LEVEL.offset, 80],
    ]);
    const result = extractUnitFields(raw);
    expect(result.health).toBe(5000);
    expect(result.maxHealth).toBe(8000);
    expect(result.level).toBe(80);
    expect(result._changed).toEqual(
      expect.arrayContaining(["health", "maxHealth", "level"]),
    );
  });

  test("unpacks BYTES_0 into race/class/gender", () => {
    const packed = 2 | (1 << 8) | (0 << 16) | (1 << 24);
    const raw = new Map([[UNIT_FIELDS.BYTES_0.offset, packed]]);
    const result = extractUnitFields(raw);
    expect(result.race).toBe(2);
    expect(result.class_).toBe(1);
    expect(result.gender).toBe(0);
    expect(result._changed).toEqual(
      expect.arrayContaining(["race", "class_", "gender"]),
    );
  });

  test("extracts target as bigint from two fields", () => {
    const raw = new Map([
      [UNIT_FIELDS.TARGET.offset, 42],
      [UNIT_FIELDS.TARGET.offset + 1, 0],
    ]);
    const result = extractUnitFields(raw);
    expect(result.target).toBe(42n);
    expect(result._changed).toContain("target");
  });

  test("extracts target with high bits", () => {
    const raw = new Map([
      [UNIT_FIELDS.TARGET.offset, 1],
      [UNIT_FIELDS.TARGET.offset + 1, 2],
    ]);
    const result = extractUnitFields(raw);
    expect(result.target).toBe((2n << 32n) | 1n);
  });

  test("extracts power array entries", () => {
    const raw = new Map([
      [UNIT_FIELDS.POWER1.offset, 3000],
      [UNIT_FIELDS.POWER3.offset, 100],
    ]);
    const result = extractUnitFields(raw);
    expect(result.power).toBeDefined();
    expect(result.power![0]).toBe(3000);
    expect(result.power![2]).toBe(100);
  });

  test("extracts maxPower array entries", () => {
    const raw = new Map([
      [UNIT_FIELDS.MAXPOWER1.offset, 5000],
      [UNIT_FIELDS.MAXPOWER5.offset, 200],
    ]);
    const result = extractUnitFields(raw);
    expect(result.maxPower).toBeDefined();
    expect(result.maxPower![0]).toBe(5000);
    expect(result.maxPower![4]).toBe(200);
  });

  test("extracts displayId and npcFlags", () => {
    const raw = new Map([
      [UNIT_FIELDS.DISPLAYID.offset, 19876],
      [UNIT_FIELDS.NPC_FLAGS.offset, 0x01],
    ]);
    const result = extractUnitFields(raw);
    expect(result.displayId).toBe(19876);
    expect(result.npcFlags).toBe(1);
  });

  test("extracts factionTemplate and unitFlags", () => {
    const raw = new Map([
      [UNIT_FIELDS.FACTIONTEMPLATE.offset, 35],
      [UNIT_FIELDS.FLAGS.offset, 0x00080000],
    ]);
    const result = extractUnitFields(raw);
    expect(result.factionTemplate).toBe(35);
    expect(result.unitFlags).toBe(0x00080000);
  });

  test("extracts nativeDisplayId", () => {
    const raw = new Map([[UNIT_FIELDS.NATIVEDISPLAYID.offset, 4444]]);
    const result = extractUnitFields(raw);
    expect(result.nativeDisplayId).toBe(4444);
    expect(result._changed).toContain("nativeDisplayId");
  });

  test("extracts dynamicFlags", () => {
    const raw = new Map([[UNIT_FIELDS.DYNAMIC_FLAGS.offset, 0x08]]);
    const result = extractUnitFields(raw);
    expect(result.dynamicFlags).toBe(0x08);
    expect(result._changed).toContain("dynamicFlags");
  });

  test("extracts modCastSpeed as float", () => {
    const raw = new Map([[UNIT_FIELDS.MOD_CAST_SPEED.offset, floatBits(1.25)]]);
    const result = extractUnitFields(raw);
    expect(result.modCastSpeed).toBeCloseTo(1.25);
    expect(result._changed).toContain("modCastSpeed");
  });

  test("sparse power array only sets updated indices", () => {
    const raw = new Map([[UNIT_FIELDS.POWER3.offset, 500]]);
    const result = extractUnitFields(raw);
    expect(result.power).toBeDefined();
    expect(result.power![2]).toBe(500);
    expect(0 in result.power!).toBe(false);
    expect(1 in result.power!).toBe(false);
    expect(3 in result.power!).toBe(false);
  });

  test("empty map returns empty changed", () => {
    const result = extractUnitFields(new Map());
    expect(result._changed).toHaveLength(0);
  });

  test("fallback preserves target high word on partial update", () => {
    const raw = new Map([[UNIT_FIELDS.TARGET.offset, 5]]);
    const fallback = new Map([[UNIT_FIELDS.TARGET.offset + 1, 10]]);
    const result = extractUnitFields(raw, fallback);
    expect(result.target).toBe((10n << 32n) | 5n);
    expect(result._changed).toContain("target");
  });

  test("fallback preserves target low word on partial update", () => {
    const raw = new Map([[UNIT_FIELDS.TARGET.offset + 1, 10]]);
    const fallback = new Map([[UNIT_FIELDS.TARGET.offset, 5]]);
    const result = extractUnitFields(raw, fallback);
    expect(result.target).toBe((10n << 32n) | 5n);
    expect(result._changed).toContain("target");
  });

  test("neither word present returns undefined even with fallback", () => {
    const raw = new Map<number, number>();
    const fallback = new Map([
      [UNIT_FIELDS.TARGET.offset, 5],
      [UNIT_FIELDS.TARGET.offset + 1, 10],
    ]);
    const result = extractUnitFields(raw, fallback);
    expect(result.target).toBeUndefined();
  });
});

describe("extractGameObjectFields", () => {
  test("extracts displayId and flags", () => {
    const raw = new Map([
      [GAMEOBJECT_FIELDS.DISPLAYID.offset, 9999],
      [GAMEOBJECT_FIELDS.FLAGS.offset, 0x20],
    ]);
    const result = extractGameObjectFields(raw);
    expect(result.displayId).toBe(9999);
    expect(result.flags).toBe(0x20);
  });

  test("unpacks BYTES_1 for state and bytes1", () => {
    const packed = 1 | (0 << 8) | (0xff << 16) | (0 << 24);
    const raw = new Map([[GAMEOBJECT_FIELDS.BYTES_1.offset, packed]]);
    const result = extractGameObjectFields(raw);
    expect(result.state).toBe(1);
    expect(result.bytes1).toBe(packed);
  });

  test("extracts level and faction", () => {
    const raw = new Map([
      [GAMEOBJECT_FIELDS.LEVEL.offset, 60],
      [GAMEOBJECT_FIELDS.FACTION.offset, 1735],
    ]);
    const result = extractGameObjectFields(raw);
    expect(result.level).toBe(60);
    expect(result.faction).toBe(1735);
  });

  test("extracts dynamic", () => {
    const raw = new Map([[GAMEOBJECT_FIELDS.DYNAMIC.offset, 0x01]]);
    const result = extractGameObjectFields(raw);
    expect(result.dynamic).toBe(0x01);
    expect(result._changed).toContain("dynamic");
  });

  test("empty map returns empty changed", () => {
    const result = extractGameObjectFields(new Map());
    expect(result._changed).toHaveLength(0);
  });
});

import {
  GAMEOBJECT_FIELDS,
  OBJECT_FIELDS,
  UNIT_FIELDS,
} from "#wow/protocol/entity-fields";
import { joinGuid } from "#wow/protocol/packet";

function uint32ToFloat(v: number): number {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, v, true);
  return new DataView(buf).getFloat32(0, true);
}

function readU64(
  raw: Map<number, number>,
  offset: number,
  fallback?: Map<number, number>,
): bigint | undefined {
  const low = raw.get(offset);
  const high = raw.get(offset + 1);
  if (low === undefined && high === undefined) return undefined;
  return joinGuid(
    low ?? fallback?.get(offset) ?? 0,
    high ?? fallback?.get(offset + 1) ?? 0,
  );
}

export type ObjectFieldsResult = {
  entry?: number;
  scale?: number;
  guid?: bigint;
  _changed: string[];
};

export function extractObjectFields(
  raw: Map<number, number>,
  fallback?: Map<number, number>,
): ObjectFieldsResult {
  const changed: string[] = [];
  const result: ObjectFieldsResult = { _changed: changed };

  const entry = raw.get(OBJECT_FIELDS.ENTRY.offset);
  if (entry !== undefined) {
    result.entry = entry;
    changed.push("entry");
  }

  const scale = raw.get(OBJECT_FIELDS.SCALE_X.offset);
  if (scale !== undefined) {
    result.scale = uint32ToFloat(scale);
    changed.push("scale");
  }

  const guid = readU64(raw, OBJECT_FIELDS.GUID.offset, fallback);
  if (guid !== undefined) {
    result.guid = guid;
    changed.push("guid");
  }

  return result;
}

export type UnitFieldsResult = {
  health?: number;
  maxHealth?: number;
  level?: number;
  factionTemplate?: number;
  displayId?: number;
  nativeDisplayId?: number;
  npcFlags?: number;
  unitFlags?: number;
  dynamicFlags?: number;
  target?: bigint;
  race?: number;
  class_?: number;
  gender?: number;
  powerType?: number;
  baseMana?: number;
  power?: number[];
  maxPower?: number[];
  modCastSpeed?: number;
  combatReach?: number;
  _changed: string[];
};

const UNIT_U32_FIELDS: [keyof typeof UNIT_FIELDS, keyof UnitFieldsResult][] = [
  ["HEALTH", "health"],
  ["MAXHEALTH", "maxHealth"],
  ["LEVEL", "level"],
  ["FACTIONTEMPLATE", "factionTemplate"],
  ["DISPLAYID", "displayId"],
  ["NATIVEDISPLAYID", "nativeDisplayId"],
  ["NPC_FLAGS", "npcFlags"],
  ["DYNAMIC_FLAGS", "dynamicFlags"],
  ["BASE_MANA", "baseMana"],
];

const UNIT_FLAGS_MAP: [keyof typeof UNIT_FIELDS, keyof UnitFieldsResult][] = [
  ["FLAGS", "unitFlags"],
];

const POWER_KEYS = [
  "POWER1",
  "POWER2",
  "POWER3",
  "POWER4",
  "POWER5",
  "POWER6",
  "POWER7",
] as const;

const MAXPOWER_KEYS = [
  "MAXPOWER1",
  "MAXPOWER2",
  "MAXPOWER3",
  "MAXPOWER4",
  "MAXPOWER5",
  "MAXPOWER6",
  "MAXPOWER7",
] as const;

function copyU32Fields(
  raw: Map<number, number>,
  map: [keyof typeof UNIT_FIELDS, keyof UnitFieldsResult][],
  result: UnitFieldsResult,
  changed: string[],
): void {
  for (const [fieldKey, resultKey] of map) {
    const v = raw.get(UNIT_FIELDS[fieldKey].offset);
    if (v !== undefined) {
      (result as Record<string, unknown>)[resultKey] = v;
      changed.push(resultKey);
    }
  }
}

function readPowerArray(
  raw: Map<number, number>,
  keys: typeof POWER_KEYS | typeof MAXPOWER_KEYS,
  changed: string[],
  changeKey: "power" | "maxPower",
): number[] | undefined {
  let arr: number[] | undefined;
  for (const [i, key] of keys.entries()) {
    const v = raw.get(UNIT_FIELDS[key].offset);
    if (v !== undefined) {
      if (!arr) {
        arr = [];
      }
      arr[i] = v;
      if (!changed.includes(changeKey)) changed.push(changeKey);
    }
  }
  return arr;
}

function readBytes0(
  raw: Map<number, number>,
  result: UnitFieldsResult,
  changed: string[],
): void {
  const b = raw.get(UNIT_FIELDS.BYTES_0.offset);
  if (b !== undefined) {
    result.race = b & 0xff;
    result.class_ = (b >> 8) & 0xff;
    result.gender = (b >> 16) & 0xff;
    result.powerType = (b >> 24) & 0xff;
    changed.push("race", "class_", "gender", "powerType");
  }
}

export function extractUnitFields(
  raw: Map<number, number>,
  fallback?: Map<number, number>,
): UnitFieldsResult {
  const changed: string[] = [];
  const result: UnitFieldsResult = { _changed: changed };

  copyU32Fields(raw, UNIT_U32_FIELDS, result, changed);
  copyU32Fields(raw, UNIT_FLAGS_MAP, result, changed);

  const target = readU64(raw, UNIT_FIELDS.TARGET.offset, fallback);
  if (target !== undefined) {
    result.target = target;
    changed.push("target");
  }

  readBytes0(raw, result, changed);

  const powerArr = readPowerArray(raw, POWER_KEYS, changed, "power");
  if (powerArr) result.power = powerArr;

  const maxPowerArr = readPowerArray(raw, MAXPOWER_KEYS, changed, "maxPower");
  if (maxPowerArr) result.maxPower = maxPowerArr;

  const castSpeed = raw.get(UNIT_FIELDS.MOD_CAST_SPEED.offset);
  if (castSpeed !== undefined) {
    result.modCastSpeed = uint32ToFloat(castSpeed);
    changed.push("modCastSpeed");
  }

  const reach = raw.get(UNIT_FIELDS.COMBATREACH.offset);
  if (reach !== undefined) {
    result.combatReach = uint32ToFloat(reach);
    changed.push("combatReach");
  }

  return result;
}

export type GameObjectFieldsResult = {
  displayId?: number;
  flags?: number;
  state?: number;
  bytes1?: number;
  dynamic?: number;
  faction?: number;
  level?: number;
  _changed: string[];
};

const GO_U32_FIELDS: [
  keyof typeof GAMEOBJECT_FIELDS,
  keyof GameObjectFieldsResult,
][] = [
  ["DISPLAYID", "displayId"],
  ["FLAGS", "flags"],
  ["DYNAMIC", "dynamic"],
  ["FACTION", "faction"],
  ["LEVEL", "level"],
];

export function extractGameObjectFields(
  raw: Map<number, number>,
): GameObjectFieldsResult {
  const changed: string[] = [];
  const result: GameObjectFieldsResult = { _changed: changed };

  for (const [fieldKey, resultKey] of GO_U32_FIELDS) {
    const v = raw.get(GAMEOBJECT_FIELDS[fieldKey].offset);
    if (v !== undefined) {
      (result as Record<string, unknown>)[resultKey] = v;
      changed.push(resultKey);
    }
  }

  const b = raw.get(GAMEOBJECT_FIELDS.BYTES_1.offset);
  if (b !== undefined) {
    result.state = b & 0xff;
    result.bytes1 = b;
    changed.push("state", "bytes1");
  }

  return result;
}

import { OBJECT_FIELDS, UNIT_FIELDS, GAMEOBJECT_FIELDS } from "./entity-fields";

function uint32ToFloat(v: number): number {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, v, true);
  return new DataView(buf).getFloat32(0, true);
}

function readU64(raw: Map<number, number>, offset: number): bigint | undefined {
  const low = raw.get(offset);
  const high = raw.get(offset + 1);
  if (low === undefined && high === undefined) return undefined;
  return (BigInt((high ?? 0) >>> 0) << 32n) | BigInt((low ?? 0) >>> 0);
}

export type ObjectFieldsResult = {
  entry?: number;
  scale?: number;
  guid?: bigint;
  _changed: string[];
};

export function extractObjectFields(
  raw: Map<number, number>,
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

  const guid = readU64(raw, OBJECT_FIELDS.GUID.offset);
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
  power?: number[];
  maxPower?: number[];
  modCastSpeed?: number;
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

export function extractUnitFields(raw: Map<number, number>): UnitFieldsResult {
  const changed: string[] = [];
  const result: UnitFieldsResult = { _changed: changed };

  for (const [fieldKey, resultKey] of UNIT_U32_FIELDS) {
    const v = raw.get(UNIT_FIELDS[fieldKey].offset);
    if (v !== undefined) {
      (result as Record<string, unknown>)[resultKey] = v;
      changed.push(resultKey);
    }
  }

  for (const [fieldKey, resultKey] of UNIT_FLAGS_MAP) {
    const v = raw.get(UNIT_FIELDS[fieldKey].offset);
    if (v !== undefined) {
      (result as Record<string, unknown>)[resultKey] = v;
      changed.push(resultKey);
    }
  }

  const target = readU64(raw, UNIT_FIELDS.TARGET.offset);
  if (target !== undefined) {
    result.target = target;
    changed.push("target");
  }

  const b = raw.get(UNIT_FIELDS.BYTES_0.offset);
  if (b !== undefined) {
    result.race = b & 0xff;
    result.class_ = (b >> 8) & 0xff;
    result.gender = (b >> 16) & 0xff;
    changed.push("race", "class_", "gender");
  }

  let powerArr: number[] | undefined;
  for (let i = 0; i < POWER_KEYS.length; i++) {
    const v = raw.get(UNIT_FIELDS[POWER_KEYS[i]!].offset);
    if (v !== undefined) {
      if (!powerArr) {
        powerArr = [];
      }
      powerArr[i] = v;
      if (!changed.includes("power")) changed.push("power");
    }
  }
  if (powerArr) result.power = powerArr;

  let maxPowerArr: number[] | undefined;
  for (let i = 0; i < MAXPOWER_KEYS.length; i++) {
    const v = raw.get(UNIT_FIELDS[MAXPOWER_KEYS[i]!].offset);
    if (v !== undefined) {
      if (!maxPowerArr) {
        maxPowerArr = [];
      }
      maxPowerArr[i] = v;
      if (!changed.includes("maxPower")) changed.push("maxPower");
    }
  }
  if (maxPowerArr) result.maxPower = maxPowerArr;

  const castSpeed = raw.get(UNIT_FIELDS.MOD_CAST_SPEED.offset);
  if (castSpeed !== undefined) {
    result.modCastSpeed = uint32ToFloat(castSpeed);
    changed.push("modCastSpeed");
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

export const enum ObjectType {
  OBJECT = 0,
  ITEM = 1,
  CONTAINER = 2,
  UNIT = 3,
  PLAYER = 4,
  GAMEOBJECT = 5,
  DYNAMICOBJECT = 6,
  CORPSE = 7,
}

export const enum UpdateType {
  VALUES = 0,
  MOVEMENT = 1,
  CREATE_OBJECT = 2,
  CREATE_OBJECT2 = 3,
  OUT_OF_RANGE = 4,
  NEAR_OBJECTS = 5,
}

export const UpdateFlag = {
  SELF: 0x0001,
  TRANSPORT: 0x0002,
  HAS_ATTACKING_TARGET: 0x0004,
  LOW_GUID: 0x0008,
  HIGH_GUID: 0x0010,
  LIVING: 0x0020,
  HAS_POSITION: 0x0040,
  VEHICLE: 0x0080,
  POSITION: 0x0100,
  ROTATION: 0x0200,
} as const;

export const MovementFlag = {
  FORWARD: 0x00000001,
  BACKWARD: 0x00000002,
  STRAFE_LEFT: 0x00000004,
  STRAFE_RIGHT: 0x00000008,
  LEFT: 0x00000010,
  RIGHT: 0x00000020,
  PITCH_UP: 0x00000040,
  PITCH_DOWN: 0x00000080,
  WALKING: 0x00000100,
  ON_TRANSPORT: 0x00000200,
  DISABLE_GRAVITY: 0x00000400,
  ROOT: 0x00000800,
  FALLING: 0x00001000,
  FALLING_FAR: 0x00002000,
  SWIMMING: 0x00200000,
  FLYING: 0x02000000,
  SPLINE_ELEVATION: 0x04000000,
  SPLINE_ENABLED: 0x08000000,
  WATERWALKING: 0x10000000,
  FALLING_SLOW: 0x20000000,
  HOVER: 0x40000000,
} as const;

export const MovementFlagExtra = {
  ALWAYS_ALLOW_PITCHING: 0x0020,
  INTERPOLATED_MOVEMENT: 0x0040,
  INTERPOLATED_TURNING: 0x0080,
  INTERPOLATED_PITCHING: 0x0100,
} as const;

export const OBJECT_END = 0x0006;
export const UNIT_END = 0x0094;
export const PLAYER_END = 0x0494;
export const GAMEOBJECT_END = 0x0012;
export const DYNAMICOBJECT_END = 0x000c;
export const CORPSE_END = 0x0024;

export type FieldDef = {
  offset: number;
  size: number;
  type: "u32" | "u64" | "f32" | "bytes4";
};

const OE = OBJECT_END;

export const OBJECT_FIELDS = {
  GUID: { offset: 0x0000, size: 2, type: "u64" },
  TYPE: { offset: 0x0002, size: 1, type: "u32" },
  ENTRY: { offset: 0x0003, size: 1, type: "u32" },
  SCALE_X: { offset: 0x0004, size: 1, type: "f32" },
} as const satisfies Record<string, FieldDef>;

export const UNIT_FIELDS = {
  CHARM: { offset: OE + 0x0000, size: 2, type: "u64" },
  SUMMON: { offset: OE + 0x0002, size: 2, type: "u64" },
  CHARMEDBY: { offset: OE + 0x0004, size: 2, type: "u64" },
  TARGET: { offset: OE + 0x000c, size: 2, type: "u64" },
  BYTES_0: { offset: OE + 0x0011, size: 1, type: "bytes4" },
  HEALTH: { offset: OE + 0x0012, size: 1, type: "u32" },
  POWER1: { offset: OE + 0x0013, size: 1, type: "u32" },
  POWER2: { offset: OE + 0x0014, size: 1, type: "u32" },
  POWER3: { offset: OE + 0x0015, size: 1, type: "u32" },
  POWER4: { offset: OE + 0x0016, size: 1, type: "u32" },
  POWER5: { offset: OE + 0x0017, size: 1, type: "u32" },
  POWER6: { offset: OE + 0x0018, size: 1, type: "u32" },
  POWER7: { offset: OE + 0x0019, size: 1, type: "u32" },
  MAXHEALTH: { offset: OE + 0x001a, size: 1, type: "u32" },
  MAXPOWER1: { offset: OE + 0x001b, size: 1, type: "u32" },
  MAXPOWER2: { offset: OE + 0x001c, size: 1, type: "u32" },
  MAXPOWER3: { offset: OE + 0x001d, size: 1, type: "u32" },
  MAXPOWER4: { offset: OE + 0x001e, size: 1, type: "u32" },
  MAXPOWER5: { offset: OE + 0x001f, size: 1, type: "u32" },
  MAXPOWER6: { offset: OE + 0x0020, size: 1, type: "u32" },
  MAXPOWER7: { offset: OE + 0x0021, size: 1, type: "u32" },
  LEVEL: { offset: OE + 0x0030, size: 1, type: "u32" },
  FACTIONTEMPLATE: { offset: OE + 0x0031, size: 1, type: "u32" },
  FLAGS: { offset: OE + 0x0035, size: 1, type: "u32" },
  FLAGS_2: { offset: OE + 0x0036, size: 1, type: "u32" },
  DISPLAYID: { offset: OE + 0x003d, size: 1, type: "u32" },
  NATIVEDISPLAYID: { offset: OE + 0x003e, size: 1, type: "u32" },
  DYNAMIC_FLAGS: { offset: OE + 0x0049, size: 1, type: "u32" },
  MOD_CAST_SPEED: { offset: OE + 0x004a, size: 1, type: "f32" },
  NPC_FLAGS: { offset: OE + 0x004c, size: 1, type: "u32" },
} as const satisfies Record<string, FieldDef>;

export const GAMEOBJECT_FIELDS = {
  CREATED_BY: { offset: OE + 0x0000, size: 2, type: "u64" },
  DISPLAYID: { offset: OE + 0x0002, size: 1, type: "u32" },
  FLAGS: { offset: OE + 0x0003, size: 1, type: "u32" },
  PARENTROTATION: { offset: OE + 0x0004, size: 4, type: "f32" },
  DYNAMIC: { offset: OE + 0x0008, size: 1, type: "u32" },
  FACTION: { offset: OE + 0x0009, size: 1, type: "u32" },
  LEVEL: { offset: OE + 0x000a, size: 1, type: "u32" },
  BYTES_1: { offset: OE + 0x000b, size: 1, type: "bytes4" },
} as const satisfies Record<string, FieldDef>;

export const DYNAMICOBJECT_FIELDS = {
  CASTER: { offset: OE + 0x0000, size: 2, type: "u64" },
  BYTES: { offset: OE + 0x0002, size: 1, type: "bytes4" },
  SPELLID: { offset: OE + 0x0003, size: 1, type: "u32" },
  RADIUS: { offset: OE + 0x0004, size: 1, type: "f32" },
  CASTTIME: { offset: OE + 0x0005, size: 1, type: "u32" },
} as const satisfies Record<string, FieldDef>;

export const CORPSE_FIELDS = {
  OWNER: { offset: OE + 0x0000, size: 2, type: "u64" },
  PARTY: { offset: OE + 0x0002, size: 2, type: "u64" },
  DISPLAY_ID: { offset: OE + 0x0004, size: 1, type: "u32" },
  ITEM: { offset: OE + 0x0005, size: 19, type: "u32" },
  BYTES_1: { offset: OE + 0x0018, size: 1, type: "bytes4" },
  BYTES_2: { offset: OE + 0x0019, size: 1, type: "bytes4" },
  GUILD: { offset: OE + 0x001a, size: 1, type: "u32" },
  FLAGS: { offset: OE + 0x001b, size: 1, type: "u32" },
  DYNAMIC_FLAGS: { offset: OE + 0x001c, size: 1, type: "u32" },
} as const satisfies Record<string, FieldDef>;

type FieldInfo = { name: string; type: string };

const FIELD_NAME_MAP: Record<string, string> = {
  GUID: "guid",
  TYPE: "type",
  ENTRY: "entry",
  SCALE_X: "scaleX",
  CHARM: "charm",
  SUMMON: "summon",
  CHARMEDBY: "charmedBy",
  TARGET: "target",
  BYTES_0: "bytes0",
  HEALTH: "health",
  POWER1: "power1",
  POWER2: "power2",
  POWER3: "power3",
  POWER4: "power4",
  POWER5: "power5",
  POWER6: "power6",
  POWER7: "power7",
  MAXHEALTH: "maxHealth",
  MAXPOWER1: "maxPower1",
  MAXPOWER2: "maxPower2",
  MAXPOWER3: "maxPower3",
  MAXPOWER4: "maxPower4",
  MAXPOWER5: "maxPower5",
  MAXPOWER6: "maxPower6",
  MAXPOWER7: "maxPower7",
  LEVEL: "level",
  FACTIONTEMPLATE: "factionTemplate",
  FLAGS: "flags",
  FLAGS_2: "flags2",
  DISPLAYID: "displayId",
  NATIVEDISPLAYID: "nativeDisplayId",
  DYNAMIC_FLAGS: "dynamicFlags",
  MOD_CAST_SPEED: "modCastSpeed",
  NPC_FLAGS: "npcFlags",
  CREATED_BY: "createdBy",
  PARENTROTATION: "parentRotation",
  DYNAMIC: "dynamic",
  FACTION: "faction",
  BYTES_1: "bytes1",
  CASTER: "caster",
  BYTES: "bytes",
  SPELLID: "spellId",
  RADIUS: "radius",
  CASTTIME: "castTime",
  OWNER: "owner",
  PARTY: "party",
  DISPLAY_ID: "displayId",
  ITEM: "item",
  BYTES_2: "bytes2",
  GUILD: "guild",
};

function buildLookup(
  ...tables: Record<string, FieldDef>[]
): Map<number, FieldInfo> {
  const map = new Map<number, FieldInfo>();
  for (const table of tables) {
    for (const [key, def] of Object.entries(table)) {
      const name = FIELD_NAME_MAP[key];
      if (name !== undefined) {
        map.set(def.offset, { name, type: def.type });
      }
    }
  }
  return map;
}

const unitLookup = buildLookup(OBJECT_FIELDS, UNIT_FIELDS);
const playerLookup = buildLookup(OBJECT_FIELDS, UNIT_FIELDS);
const gameobjectLookup = buildLookup(OBJECT_FIELDS, GAMEOBJECT_FIELDS);
const dynamicobjectLookup = buildLookup(OBJECT_FIELDS, DYNAMICOBJECT_FIELDS);
const corpseLookup = buildLookup(OBJECT_FIELDS, CORPSE_FIELDS);
const objectLookup = buildLookup(OBJECT_FIELDS);

const lookupByType: Record<number, Map<number, FieldInfo>> = {
  [ObjectType.OBJECT]: objectLookup,
  [ObjectType.ITEM]: objectLookup,
  [ObjectType.CONTAINER]: objectLookup,
  [ObjectType.UNIT]: unitLookup,
  [ObjectType.PLAYER]: playerLookup,
  [ObjectType.GAMEOBJECT]: gameobjectLookup,
  [ObjectType.DYNAMICOBJECT]: dynamicobjectLookup,
  [ObjectType.CORPSE]: corpseLookup,
};

export function fieldForBit(
  objectType: ObjectType,
  bitIndex: number,
): FieldInfo | undefined {
  return lookupByType[objectType]?.get(bitIndex);
}

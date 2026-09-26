export const ObjectType = {
  OBJECT: 0,
  ITEM: 1,
  CONTAINER: 2,
  UNIT: 3,
  PLAYER: 4,
  GAMEOBJECT: 5,
  DYNAMICOBJECT: 6,
  CORPSE: 7,
} as const;

export type ObjectType = (typeof ObjectType)[keyof typeof ObjectType];

export const UpdateType = {
  VALUES: 0,
  MOVEMENT: 1,
  CREATE_OBJECT: 2,
  CREATE_OBJECT2: 3,
  OUT_OF_RANGE: 4,
  NEAR_OBJECTS: 5,
} as const;

export const UpdateFlag = {
  SELF: 0x00_01,
  TRANSPORT: 0x00_02,
  HAS_ATTACKING_TARGET: 0x00_04,
  LOW_GUID: 0x00_08,
  HIGH_GUID: 0x00_10,
  LIVING: 0x00_20,
  HAS_POSITION: 0x00_40,
  VEHICLE: 0x00_80,
  POSITION: 0x01_00,
  ROTATION: 0x02_00,
} as const;

export const MovementFlag = {
  FORWARD: 0x00_00_00_01,
  BACKWARD: 0x00_00_00_02,
  STRAFE_LEFT: 0x00_00_00_04,
  STRAFE_RIGHT: 0x00_00_00_08,
  LEFT: 0x00_00_00_10,
  RIGHT: 0x00_00_00_20,
  PITCH_UP: 0x00_00_00_40,
  PITCH_DOWN: 0x00_00_00_80,
  WALKING: 0x00_00_01_00,
  ON_TRANSPORT: 0x00_00_02_00,
  DISABLE_GRAVITY: 0x00_00_04_00,
  ROOT: 0x00_00_08_00,
  FALLING: 0x00_00_10_00,
  FALLING_FAR: 0x00_00_20_00,
  SWIMMING: 0x00_20_00_00,
  CAN_FLY: 0x01_00_00_00,
  FLYING: 0x02_00_00_00,
  SPLINE_ELEVATION: 0x04_00_00_00,
  SPLINE_ENABLED: 0x08_00_00_00,
  WATERWALKING: 0x10_00_00_00,
  FALLING_SLOW: 0x20_00_00_00,
  HOVER: 0x40_00_00_00,
} as const;

export const MovementFlagExtra = {
  ALWAYS_ALLOW_PITCHING: 0x00_20,
  INTERPOLATED_MOVEMENT: 0x04_00,
} as const;

export const UnitFlag = {
  SERVER_CONTROLLED: 0x00_00_00_01,
  NON_ATTACKABLE: 0x00_00_00_02,
  DISABLE_MOVE: 0x00_00_00_04,
  PLAYER_CONTROLLED: 0x00_00_00_08,
  NOT_ATTACKABLE_1: 0x00_00_00_80,
  IMMUNE_TO_PC: 0x00_00_01_00,
  NON_ATTACKABLE_2: 0x00_01_00_00,
  STUNNED: 0x00_04_00_00,
  IN_COMBAT: 0x00_08_00_00,
  TAXI_FLIGHT: 0x00_10_00_00,
  CONFUSED: 0x00_40_00_00,
  FLEEING: 0x00_80_00_00,
  NOT_SELECTABLE: 0x02_00_00_00,
} as const;

export const NpcFlag = {
  SPIRIT_HEALER: 0x00_00_40_00,
} as const;

export const OBJECT_END = 0x00_06;
export const UNIT_END = 0x00_94;
const ITEM_END = OBJECT_END + 0x00_3a;

export type FieldDef = {
  offset: number;
  size: number;
  type: "u32" | "u64" | "f32" | "bytes4";
};

const OE = OBJECT_END;

export const OBJECT_FIELDS = {
  GUID: { offset: 0x00_00, size: 2, type: "u64" },
  TYPE: { offset: 0x00_02, size: 1, type: "u32" },
  ENTRY: { offset: 0x00_03, size: 1, type: "u32" },
  SCALE_X: { offset: 0x00_04, size: 1, type: "f32" },
} as const satisfies Record<string, FieldDef>;

export const UNIT_FIELDS = {
  CHARM: { offset: OE + 0x00_00, size: 2, type: "u64" },
  SUMMON: { offset: OE + 0x00_02, size: 2, type: "u64" },
  CHARMEDBY: { offset: OE + 0x00_06, size: 2, type: "u64" },
  SUMMONEDBY: { offset: OE + 0x00_08, size: 2, type: "u64" },
  TARGET: { offset: OE + 0x00_0c, size: 2, type: "u64" },
  BYTES_0: { offset: OE + 0x00_11, size: 1, type: "bytes4" },
  HEALTH: { offset: OE + 0x00_12, size: 1, type: "u32" },
  POWER1: { offset: OE + 0x00_13, size: 1, type: "u32" },
  POWER2: { offset: OE + 0x00_14, size: 1, type: "u32" },
  POWER3: { offset: OE + 0x00_15, size: 1, type: "u32" },
  POWER4: { offset: OE + 0x00_16, size: 1, type: "u32" },
  POWER5: { offset: OE + 0x00_17, size: 1, type: "u32" },
  POWER6: { offset: OE + 0x00_18, size: 1, type: "u32" },
  POWER7: { offset: OE + 0x00_19, size: 1, type: "u32" },
  MAXHEALTH: { offset: OE + 0x00_1a, size: 1, type: "u32" },
  MAXPOWER1: { offset: OE + 0x00_1b, size: 1, type: "u32" },
  MAXPOWER2: { offset: OE + 0x00_1c, size: 1, type: "u32" },
  MAXPOWER3: { offset: OE + 0x00_1d, size: 1, type: "u32" },
  MAXPOWER4: { offset: OE + 0x00_1e, size: 1, type: "u32" },
  MAXPOWER5: { offset: OE + 0x00_1f, size: 1, type: "u32" },
  MAXPOWER6: { offset: OE + 0x00_20, size: 1, type: "u32" },
  MAXPOWER7: { offset: OE + 0x00_21, size: 1, type: "u32" },
  LEVEL: { offset: OE + 0x00_30, size: 1, type: "u32" },
  FACTIONTEMPLATE: { offset: OE + 0x00_31, size: 1, type: "u32" },
  FLAGS: { offset: OE + 0x00_35, size: 1, type: "u32" },
  FLAGS_2: { offset: OE + 0x00_36, size: 1, type: "u32" },
  COMBATREACH: { offset: OE + 0x00_3c, size: 1, type: "f32" },
  DISPLAYID: { offset: OE + 0x00_3d, size: 1, type: "u32" },
  NATIVEDISPLAYID: { offset: OE + 0x00_3e, size: 1, type: "u32" },
  DYNAMIC_FLAGS: { offset: OE + 0x00_49, size: 1, type: "u32" },
  MOD_CAST_SPEED: { offset: OE + 0x00_4a, size: 1, type: "f32" },
  BASE_MANA: { offset: OE + 0x00_72, size: 1, type: "u32" },
  BYTES_2: { offset: OE + 0x00_74, size: 1, type: "bytes4" },
  NPC_FLAGS: { offset: OE + 0x00_4c, size: 1, type: "u32" },
} as const satisfies Record<string, FieldDef>;

export const PLAYER_FIELDS = {
  FLAGS: { offset: UNIT_END + 0x00_02, size: 1, type: "u32" },
  QUEST_LOG: { offset: UNIT_END + 0x00_0a, size: 125, type: "u32" },
  INV_SLOT_HEAD: { offset: UNIT_END + 0x00_b0, size: 46, type: "u64" },
  PACK_SLOT_1: { offset: UNIT_END + 0x00_de, size: 32, type: "u64" },
  KEYRING_SLOT_1: { offset: UNIT_END + 0x01_5c, size: 64, type: "u64" },
  CURRENCYTOKEN_SLOT_1: { offset: UNIT_END + 0x01_9c, size: 64, type: "u64" },
  XP: { offset: UNIT_END + 0x01_e6, size: 1, type: "u32" },
  NEXT_LEVEL_XP: { offset: UNIT_END + 0x01_e7, size: 1, type: "u32" },
  COINAGE: { offset: UNIT_END + 0x03_fe, size: 1, type: "u32" },
} as const satisfies Record<string, FieldDef>;

export const ITEM_FIELDS = {
  OWNER: { offset: OE + 0x00_00, size: 2, type: "u64" },
  CONTAINED: { offset: OE + 0x00_02, size: 2, type: "u64" },
  STACK_COUNT: { offset: OE + 0x00_08, size: 1, type: "u32" },
  FLAGS: { offset: OE + 0x00_0f, size: 1, type: "u32" },
  RANDOM_PROPERTIES_ID: { offset: OE + 0x00_35, size: 1, type: "u32" },
  DURABILITY: { offset: OE + 0x00_36, size: 1, type: "u32" },
  MAXDURABILITY: { offset: OE + 0x00_37, size: 1, type: "u32" },
} as const satisfies Record<string, FieldDef>;

export const CONTAINER_FIELDS = {
  NUM_SLOTS: { offset: ITEM_END + 0x00_00, size: 1, type: "u32" },
  SLOT_1: { offset: ITEM_END + 0x00_02, size: 72, type: "u64" },
} as const satisfies Record<string, FieldDef>;

export const GAMEOBJECT_FIELDS = {
  CREATED_BY: { offset: OE + 0x00_00, size: 2, type: "u64" },
  DISPLAYID: { offset: OE + 0x00_02, size: 1, type: "u32" },
  FLAGS: { offset: OE + 0x00_03, size: 1, type: "u32" },
  PARENTROTATION: { offset: OE + 0x00_04, size: 4, type: "f32" },
  DYNAMIC: { offset: OE + 0x00_08, size: 1, type: "u32" },
  FACTION: { offset: OE + 0x00_09, size: 1, type: "u32" },
  LEVEL: { offset: OE + 0x00_0a, size: 1, type: "u32" },
  BYTES_1: { offset: OE + 0x00_0b, size: 1, type: "bytes4" },
} as const satisfies Record<string, FieldDef>;

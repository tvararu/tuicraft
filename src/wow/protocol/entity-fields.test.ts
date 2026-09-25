import { describe, expect, test } from "bun:test";
import { must } from "test/must";
import {
  CORPSE_END,
  CORPSE_FIELDS,
  DYNAMICOBJECT_END,
  DYNAMICOBJECT_FIELDS,
  fieldForBit,
  GAMEOBJECT_END,
  GAMEOBJECT_FIELDS,
  MovementFlag,
  OBJECT_END,
  OBJECT_FIELDS,
  ObjectType,
  UNIT_END,
  UNIT_FIELDS,
  UpdateFlag,
  UpdateType,
} from "wow/protocol/entity-fields";

describe("ObjectType", () => {
  test("has correct values", () => {
    expect(ObjectType.OBJECT).toBe(0);
    expect(ObjectType.ITEM).toBe(1);
    expect(ObjectType.CONTAINER).toBe(2);
    expect(ObjectType.UNIT).toBe(3);
    expect(ObjectType.PLAYER).toBe(4);
    expect(ObjectType.GAMEOBJECT).toBe(5);
    expect(ObjectType.DYNAMICOBJECT).toBe(6);
    expect(ObjectType.CORPSE).toBe(7);
  });
});

describe("UpdateType", () => {
  test("has correct values", () => {
    expect(UpdateType.VALUES).toBe(0);
    expect(UpdateType.MOVEMENT).toBe(1);
    expect(UpdateType.CREATE_OBJECT).toBe(2);
    expect(UpdateType.CREATE_OBJECT2).toBe(3);
    expect(UpdateType.OUT_OF_RANGE).toBe(4);
    expect(UpdateType.NEAR_OBJECTS).toBe(5);
  });
});

describe("UpdateFlag", () => {
  test("has correct bitmask values", () => {
    expect(UpdateFlag.SELF).toBe(0x00_01);
    expect(UpdateFlag.LIVING).toBe(0x00_20);
    expect(UpdateFlag.HAS_POSITION).toBe(0x00_40);
    expect(UpdateFlag.ROTATION).toBe(0x02_00);
  });
});

describe("MovementFlag", () => {
  test("has correct bitmask values", () => {
    expect(MovementFlag.FORWARD).toBe(0x00_00_00_01);
    expect(MovementFlag.FALLING).toBe(0x00_00_10_00);
    expect(MovementFlag.FLYING).toBe(0x02_00_00_00);
    expect(MovementFlag.HOVER).toBe(0x40_00_00_00);
  });
});

describe("end constants", () => {
  test("OBJECT_END is 0x0006", () => {
    expect(OBJECT_END).toBe(0x00_06);
  });

  test("UNIT_END is 0x0094", () => {
    expect(UNIT_END).toBe(0x00_94);
  });

  test("GAMEOBJECT_END is 0x0012", () => {
    expect(GAMEOBJECT_END).toBe(0x00_12);
  });

  test("DYNAMICOBJECT_END is 0x000C", () => {
    expect(DYNAMICOBJECT_END).toBe(0x00_0c);
  });

  test("CORPSE_END is 0x0024", () => {
    expect(CORPSE_END).toBe(0x00_24);
  });
});

describe("OBJECT_FIELDS", () => {
  test("GUID at offset 0 with size 2 and type u64", () => {
    expect(OBJECT_FIELDS.GUID).toEqual({
      offset: 0x00_00,
      size: 2,
      type: "u64",
    });
  });

  test("ENTRY at offset 3 with size 1 and type u32", () => {
    expect(OBJECT_FIELDS.ENTRY).toEqual({
      offset: 0x00_03,
      size: 1,
      type: "u32",
    });
  });

  test("TYPE at offset 2", () => {
    expect(OBJECT_FIELDS.TYPE.offset).toBe(0x00_02);
  });

  test("SCALE_X at offset 4 with type f32", () => {
    expect(OBJECT_FIELDS.SCALE_X).toEqual({
      offset: 0x00_04,
      size: 1,
      type: "f32",
    });
  });
});

describe("UNIT_FIELDS", () => {
  test("HEALTH offset is OBJECT_END + 0x0012", () => {
    expect(UNIT_FIELDS.HEALTH.offset).toBe(OBJECT_END + 0x00_12);
    expect(UNIT_FIELDS.HEALTH.size).toBe(1);
    expect(UNIT_FIELDS.HEALTH.type).toBe("u32");
  });

  test("MAXHEALTH offset is OBJECT_END + 0x001A", () => {
    expect(UNIT_FIELDS.MAXHEALTH.offset).toBe(OBJECT_END + 0x00_1a);
  });

  test("LEVEL offset is OBJECT_END + 0x0030", () => {
    expect(UNIT_FIELDS.LEVEL.offset).toBe(OBJECT_END + 0x00_30);
    expect(UNIT_FIELDS.LEVEL.type).toBe("u32");
  });

  test("TARGET offset is OBJECT_END + 0x000C with size 2", () => {
    expect(UNIT_FIELDS.TARGET.offset).toBe(OBJECT_END + 0x00_0c);
    expect(UNIT_FIELDS.TARGET.size).toBe(2);
    expect(UNIT_FIELDS.TARGET.type).toBe("u64");
  });

  test("power fields are sequential", () => {
    expect(UNIT_FIELDS.POWER1.offset).toBe(OBJECT_END + 0x00_13);
    expect(UNIT_FIELDS.POWER2.offset).toBe(OBJECT_END + 0x00_14);
    expect(UNIT_FIELDS.POWER7.offset).toBe(OBJECT_END + 0x00_19);
  });

  test("FLAGS and FLAGS_2 are adjacent", () => {
    expect(UNIT_FIELDS.FLAGS.offset).toBe(OBJECT_END + 0x00_35);
    expect(UNIT_FIELDS.FLAGS_2.offset).toBe(OBJECT_END + 0x00_36);
  });

  test("NPC_FLAGS offset", () => {
    expect(UNIT_FIELDS.NPC_FLAGS.offset).toBe(OBJECT_END + 0x00_4c);
  });
});

describe("GAMEOBJECT_FIELDS", () => {
  test("DISPLAYID offset is OBJECT_END + 0x0002", () => {
    expect(GAMEOBJECT_FIELDS.DISPLAYID.offset).toBe(OBJECT_END + 0x00_02);
    expect(GAMEOBJECT_FIELDS.DISPLAYID.type).toBe("u32");
  });

  test("FLAGS offset is OBJECT_END + 0x0003", () => {
    expect(GAMEOBJECT_FIELDS.FLAGS.offset).toBe(OBJECT_END + 0x00_03);
  });

  test("PARENTROTATION has size 4", () => {
    expect(GAMEOBJECT_FIELDS.PARENTROTATION.offset).toBe(OBJECT_END + 0x00_04);
    expect(GAMEOBJECT_FIELDS.PARENTROTATION.size).toBe(4);
  });
});

describe("DYNAMICOBJECT_FIELDS", () => {
  test("CASTER offset is OBJECT_END + 0x0000", () => {
    expect(DYNAMICOBJECT_FIELDS.CASTER.offset).toBe(OBJECT_END);
    expect(DYNAMICOBJECT_FIELDS.CASTER.type).toBe("u64");
  });

  test("RADIUS is f32", () => {
    expect(DYNAMICOBJECT_FIELDS.RADIUS.type).toBe("f32");
    expect(DYNAMICOBJECT_FIELDS.RADIUS.offset).toBe(OBJECT_END + 0x00_04);
  });
});

describe("CORPSE_FIELDS", () => {
  test("OWNER offset is OBJECT_END + 0x0000", () => {
    expect(CORPSE_FIELDS.OWNER.offset).toBe(OBJECT_END);
    expect(CORPSE_FIELDS.OWNER.size).toBe(2);
  });

  test("ITEM has size 19", () => {
    expect(CORPSE_FIELDS.ITEM.offset).toBe(OBJECT_END + 0x00_05);
    expect(CORPSE_FIELDS.ITEM.size).toBe(19);
  });

  test("FLAGS offset", () => {
    expect(CORPSE_FIELDS.FLAGS.offset).toBe(OBJECT_END + 0x00_1b);
  });
});

describe("fieldForBit", () => {
  test("finds UNIT_FIELD_HEALTH for correct bit index", () => {
    const result = fieldForBit(ObjectType.UNIT, UNIT_FIELDS.HEALTH.offset);
    expect(result).toBeDefined();
    expect(must(result).name).toBe("health");
    expect(must(result).type).toBe("u32");
  });

  test("finds OBJECT_FIELD_GUID for bit 0 on unit", () => {
    const result = fieldForBit(ObjectType.UNIT, 0);
    expect(result).toBeDefined();
    expect(must(result).name).toBe("guid");
    expect(must(result).type).toBe("u64");
  });

  test("finds OBJECT_FIELD_ENTRY for bit 3 on unit", () => {
    const result = fieldForBit(ObjectType.UNIT, 3);
    expect(result).toBeDefined();
    expect(must(result).name).toBe("entry");
  });

  test("finds level for unit", () => {
    const result = fieldForBit(ObjectType.UNIT, UNIT_FIELDS.LEVEL.offset);
    expect(result).toBeDefined();
    expect(must(result).name).toBe("level");
  });

  test("finds target for unit", () => {
    const result = fieldForBit(ObjectType.UNIT, UNIT_FIELDS.TARGET.offset);
    expect(result).toBeDefined();
    expect(must(result).name).toBe("target");
  });

  test("finds displayId for unit", () => {
    const result = fieldForBit(ObjectType.UNIT, UNIT_FIELDS.DISPLAYID.offset);
    expect(result).toBeDefined();
    expect(must(result).name).toBe("displayId");
  });

  test("finds npcFlags for unit", () => {
    const result = fieldForBit(ObjectType.UNIT, UNIT_FIELDS.NPC_FLAGS.offset);
    expect(result).toBeDefined();
    expect(must(result).name).toBe("npcFlags");
  });

  test("finds gameobject displayId", () => {
    const result = fieldForBit(
      ObjectType.GAMEOBJECT,
      GAMEOBJECT_FIELDS.DISPLAYID.offset,
    );
    expect(result).toBeDefined();
    expect(must(result).name).toBe("displayId");
  });

  test("finds gameobject flags", () => {
    const result = fieldForBit(
      ObjectType.GAMEOBJECT,
      GAMEOBJECT_FIELDS.FLAGS.offset,
    );
    expect(result).toBeDefined();
    expect(must(result).name).toBe("flags");
  });

  test("returns undefined for unknown offset", () => {
    expect(fieldForBit(ObjectType.UNIT, 0x05_00)).toBeUndefined();
  });

  test("returns undefined for gap offset in unit fields", () => {
    expect(fieldForBit(ObjectType.UNIT, OBJECT_END + 0x00_10)).toBeUndefined();
  });

  test("finds maxHealth for unit", () => {
    const result = fieldForBit(ObjectType.UNIT, UNIT_FIELDS.MAXHEALTH.offset);
    expect(result).toBeDefined();
    expect(must(result).name).toBe("maxHealth");
  });

  test("finds corpse owner", () => {
    const result = fieldForBit(ObjectType.CORPSE, CORPSE_FIELDS.OWNER.offset);
    expect(result).toBeDefined();
    expect(must(result).name).toBe("owner");
  });

  test("finds dynamicobject spellId", () => {
    const result = fieldForBit(
      ObjectType.DYNAMICOBJECT,
      DYNAMICOBJECT_FIELDS.SPELLID.offset,
    );
    expect(result).toBeDefined();
    expect(must(result).name).toBe("spellId");
  });
});

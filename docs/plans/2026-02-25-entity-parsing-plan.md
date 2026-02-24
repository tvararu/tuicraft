# Entity Parsing (v0.4) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Parse SMSG_UPDATE_OBJECT to build an in-memory entity store of nearby NPCs, players, game objects, and other entities, with TUI display and daemon IPC access.

**Architecture:** Three-layer approach — wire parser (`update-object.ts`) reads bytes, field definitions (`entity-fields.ts`) map offsets to named properties, entity store (`entity-store.ts`) manages lifecycle. Name resolution via eager creature/gameobject queries. Exposed through WorldHandle callbacks and snapshot methods.

**Tech Stack:** TypeScript/Bun, colocated bun:test tests, PacketReader/PacketWriter for wire format.

---

### Task 1: PacketReader Extensions

Add `uint64LE()` returning `bigint` for 8-byte GUID and rotation fields.

**Files:**

- Modify: `src/wow/protocol/packet.ts:1-86`
- Test: `src/wow/protocol/packet.test.ts` (create)

**Step 1: Write the failing test**

```typescript
import { test, expect, describe } from "bun:test";
import { PacketReader } from "./packet";

describe("PacketReader.uint64LE", () => {
  test("reads 8-byte little-endian bigint", () => {
    const buf = new Uint8Array([0x08, 0, 0, 0, 0, 0, 0, 0]);
    const r = new PacketReader(buf);
    expect(r.uint64LE()).toBe(8n);
  });

  test("reads large values", () => {
    const buf = new Uint8Array([
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f,
    ]);
    const r = new PacketReader(buf);
    expect(r.uint64LE()).toBe(0x7fffffffffffffffn);
  });

  test("advances position by 8", () => {
    const buf = new Uint8Array(16);
    const r = new PacketReader(buf);
    r.uint64LE();
    expect(r.offset).toBe(8);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/packet.test.ts`
Expected: FAIL — `uint64LE is not a function`

**Step 3: Write minimal implementation**

Add to `PacketReader` class in `packet.ts`:

```typescript
uint64LE(): bigint {
  const v = this.view.getBigUint64(this.pos, true);
  this.pos += 8;
  return v;
}
```

Also add `uint64LE(v: bigint)` to `PacketWriter`:

```typescript
uint64LE(v: bigint) {
  this.grow(8);
  this.view.setBigUint64(this.pos, v, true);
  this.pos += 8;
}
```

**Step 4: Run test to verify it passes**

Run: `mise test src/wow/protocol/packet.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add uint64LE to PacketReader and PacketWriter
```

---

### Task 2: Entity Types and Field Definitions

Define the ObjectType enum, entity type hierarchy, update constants, and field
offset tables.

**Files:**

- Create: `src/wow/protocol/entity-fields.ts`
- Create: `src/wow/protocol/entity-fields.test.ts`

**Step 1: Write the failing test**

```typescript
import { test, expect, describe } from "bun:test";
import {
  ObjectType,
  UpdateType,
  UpdateFlag,
  MovementFlag,
  OBJECT_FIELDS,
  UNIT_FIELDS,
  GAMEOBJECT_FIELDS,
  OBJECT_END,
  UNIT_END,
  fieldForBit,
} from "./entity-fields";

describe("entity field definitions", () => {
  test("ObjectType enum values match protocol", () => {
    expect(ObjectType.OBJECT).toBe(0);
    expect(ObjectType.UNIT).toBe(3);
    expect(ObjectType.PLAYER).toBe(4);
    expect(ObjectType.GAMEOBJECT).toBe(5);
    expect(ObjectType.CORPSE).toBe(7);
  });

  test("UpdateType enum values match protocol", () => {
    expect(UpdateType.VALUES).toBe(0);
    expect(UpdateType.MOVEMENT).toBe(1);
    expect(UpdateType.CREATE_OBJECT).toBe(2);
    expect(UpdateType.CREATE_OBJECT2).toBe(3);
    expect(UpdateType.OUT_OF_RANGE).toBe(4);
    expect(UpdateType.NEAR_OBJECTS).toBe(5);
  });

  test("UpdateFlag values match protocol", () => {
    expect(UpdateFlag.SELF).toBe(0x0001);
    expect(UpdateFlag.LIVING).toBe(0x0020);
    expect(UpdateFlag.HAS_POSITION).toBe(0x0040);
    expect(UpdateFlag.ROTATION).toBe(0x0200);
  });

  test("OBJECT_END is 0x0006", () => {
    expect(OBJECT_END).toBe(0x0006);
  });

  test("UNIT_END is 0x0094", () => {
    expect(UNIT_END).toBe(0x0094);
  });

  test("OBJECT_FIELDS has GUID at absolute offset 0", () => {
    expect(OBJECT_FIELDS.GUID).toEqual({
      offset: 0x0000,
      size: 2,
      type: "u64",
    });
  });

  test("OBJECT_FIELDS has ENTRY at absolute offset 3", () => {
    expect(OBJECT_FIELDS.ENTRY).toEqual({
      offset: 0x0003,
      size: 1,
      type: "u32",
    });
  });

  test("UNIT_FIELDS offsets are relative to OBJECT_END", () => {
    expect(UNIT_FIELDS.HEALTH.offset).toBe(OBJECT_END + 0x0012);
    expect(UNIT_FIELDS.MAXHEALTH.offset).toBe(OBJECT_END + 0x001a);
    expect(UNIT_FIELDS.LEVEL.offset).toBe(OBJECT_END + 0x0030);
    expect(UNIT_FIELDS.TARGET.offset).toBe(OBJECT_END + 0x000c);
  });

  test("GAMEOBJECT_FIELDS offsets are relative to OBJECT_END", () => {
    expect(GAMEOBJECT_FIELDS.DISPLAYID.offset).toBe(OBJECT_END + 0x0002);
    expect(GAMEOBJECT_FIELDS.FLAGS.offset).toBe(OBJECT_END + 0x0003);
  });

  test("fieldForBit finds UNIT_FIELD_HEALTH for unit at correct bit", () => {
    const result = fieldForBit(ObjectType.UNIT, UNIT_FIELDS.HEALTH.offset);
    expect(result).toEqual({ name: "health", type: "u32" });
  });

  test("fieldForBit returns undefined for unknown offsets", () => {
    expect(fieldForBit(ObjectType.UNIT, 999)).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/entity-fields.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/wow/protocol/entity-fields.ts` with:

- `ObjectType` enum (OBJECT=0 through CORPSE=7)
- `UpdateType` enum (VALUES=0 through NEAR_OBJECTS=5)
- `UpdateFlag` as const object (SELF=0x0001, TRANSPORT=0x0002, HAS_ATTACKING_TARGET=0x0004, LOW_GUID=0x0008, HIGH_GUID=0x0010, LIVING=0x0020, HAS_POSITION=0x0040, VEHICLE=0x0080, POSITION=0x0100, ROTATION=0x0200)
- `MovementFlag` as const object for u32 movement flags (FORWARD=0x1, ON_TRANSPORT=0x200, FALLING=0x1000, SWIMMING=0x200000, FLYING=0x2000000, SPLINE_ELEVATION=0x4000000, SPLINE_ENABLED=0x8000000, etc.)
- `MovementFlagExtra` as const object for u16 extra flags (ALWAYS_ALLOW_PITCHING=0x0020, ON_TRANSPORT_AND_INTERPOLATED=0x0004, INTERPOLATED_MOVEMENT=0x0040)
- `OBJECT_END = 0x0006`, `UNIT_END = 0x0094`, `GAMEOBJECT_END = OBJECT_END + 0x000C`, `DYNAMICOBJECT_END = OBJECT_END + 0x0006`, `CORPSE_END = OBJECT_END + 0x001E`
- `FieldDef = { offset: number; size: number; type: "u32" | "u64" | "f32" | "bytes4" }`
- `OBJECT_FIELDS`: GUID (0x0000, 2, u64), TYPE (0x0002, 1, u32), ENTRY (0x0003, 1, u32), SCALE_X (0x0004, 1, f32)
- `UNIT_FIELDS` (all offsets = OBJECT_END + raw offset from UpdateFields.h):
  - CHARM (0x0000, 2, u64), SUMMON (0x0002, 2, u64), CHARMEDBY (0x0004, 2, u64)
  - TARGET (0x000c, 2, u64)
  - BYTES_0 (0x0011, 1, bytes4)
  - HEALTH (0x0012, 1, u32), POWER1..7 (0x0013–0x0019), MAXHEALTH (0x001a, 1, u32), MAXPOWER1..7 (0x001b–0x0021)
  - LEVEL (0x0030, 1, u32), FACTIONTEMPLATE (0x0031, 1, u32)
  - FLAGS (0x0035, 1, u32), FLAGS_2 (0x0036, 1, u32)
  - DISPLAYID (0x003d, 1, u32), NATIVEDISPLAYID (0x003e, 1, u32)
  - MOD_CAST_SPEED (0x004a, 1, f32)
  - NPC_FLAGS (0x004c, 1, u32)
  - DYNAMIC_FLAGS (0x0049, 1, u32)
- `GAMEOBJECT_FIELDS` (offsets = OBJECT_END + raw):
  - CREATED_BY (0x0000, 2, u64), STATE (0x0001 — note: this doesn't exist as standalone, it's part of BYTES_1), DISPLAYID (0x0002, 1, u32), FLAGS (0x0003, 1, u32), PARENTROTATION (0x0004, 4, f32), DYNAMIC (0x0008, 1, u32), FACTION (0x0009, 1, u32), LEVEL (0x000a, 1, u32), BYTES_1 (0x000b, 1, bytes4)
- `fieldForBit(objectType, bitIndex)` — looks up the named field for a given bit index and object type, returns `{ name: string; type: string } | undefined`

The field-for-bit lookup uses a prebuilt Map per object type, built at module load from the field definition objects.

**Step 4: Run test to verify it passes**

Run: `mise test src/wow/protocol/entity-fields.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add entity type definitions and field offset tables
```

---

### Task 3: Update Mask Parser

Parse the variable-length bitmask and extract field values.

**Files:**

- Create: `src/wow/protocol/update-mask.ts`
- Create: `src/wow/protocol/update-mask.test.ts`

**Step 1: Write the failing test**

```typescript
import { test, expect, describe } from "bun:test";
import { PacketReader } from "./packet";
import { parseUpdateMask } from "./update-mask";

describe("parseUpdateMask", () => {
  test("empty mask (0 blocks)", () => {
    const buf = new Uint8Array([0x00]);
    const r = new PacketReader(buf);
    const result = parseUpdateMask(r);
    expect(result.size).toBe(0);
  });

  test("single field set in first block", () => {
    // 1 block, bit 3 set (OBJECT_ENTRY), value = 42
    const buf = new Uint8Array([
      0x01, // 1 block
      0x08,
      0x00,
      0x00,
      0x00, // bit 3 set
      0x2a,
      0x00,
      0x00,
      0x00, // value 42
    ]);
    const r = new PacketReader(buf);
    const result = parseUpdateMask(r);
    expect(result.get(3)).toBe(42);
  });

  test("multiple fields across multiple blocks", () => {
    // 3 blocks from wowm test: bits 0,1,2 in block 0, bit 55 in block 1, bits 67,68 in block 2
    const buf = new Uint8Array([
      0x03,
      0x07,
      0x00,
      0x00,
      0x00, // block 0: bits 0,1,2
      0x00,
      0x00,
      0x80,
      0x00, // block 1: bit 55
      0x18,
      0x00,
      0x00,
      0x00, // block 2: bits 67,68
      // values for bits 0,1 (GUID is size 2), bit 2, bit 55, bit 67, bit 68
      0x08,
      0x00,
      0x00,
      0x00, // bit 0
      0x00,
      0x00,
      0x00,
      0x00, // bit 1
      0x19,
      0x00,
      0x00,
      0x00, // bit 2
      0x01,
      0x00,
      0x00,
      0x00, // bit 55
      0x0c,
      0x4d,
      0x00,
      0x00, // bit 67
      0x0c,
      0x4d,
      0x00,
      0x00, // bit 68
    ]);
    const r = new PacketReader(buf);
    const result = parseUpdateMask(r);
    expect(result.size).toBe(6);
    expect(result.get(0)).toBe(8); // GUID low
    expect(result.get(1)).toBe(0); // GUID high
    expect(result.get(2)).toBe(0x19); // OBJECT_TYPE
    expect(result.get(55)).toBe(1); // UNIT_FACTIONTEMPLATE
    expect(result.get(67)).toBe(0x4d0c); // UNIT_DISPLAYID
    expect(result.get(68)).toBe(0x4d0c); // UNIT_NATIVEDISPLAYID
  });

  test("all 32 bits set in one block", () => {
    const mask = new Uint8Array(4);
    new DataView(mask.buffer).setUint32(0, 0xffffffff, true);
    const values = new Uint8Array(32 * 4);
    for (let i = 0; i < 32; i++) {
      new DataView(values.buffer).setUint32(i * 4, i, true);
    }
    const buf = new Uint8Array([0x01, ...mask, ...values]);
    const r = new PacketReader(buf);
    const result = parseUpdateMask(r);
    expect(result.size).toBe(32);
    for (let i = 0; i < 32; i++) {
      expect(result.get(i)).toBe(i);
    }
  });

  test("reader position advances past all mask and value bytes", () => {
    const buf = new Uint8Array([
      0x01,
      0x01,
      0x00,
      0x00,
      0x00,
      0xff,
      0x00,
      0x00,
      0x00,
      0xaa, // trailing byte after mask data
    ]);
    const r = new PacketReader(buf);
    parseUpdateMask(r);
    expect(r.remaining).toBe(1);
    expect(r.uint8()).toBe(0xaa);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/update-mask.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

`src/wow/protocol/update-mask.ts`:

```typescript
import type { PacketReader } from "./packet";

export function parseUpdateMask(r: PacketReader): Map<number, number> {
  const blockCount = r.uint8();
  const masks: number[] = [];
  for (let i = 0; i < blockCount; i++) {
    masks.push(r.uint32LE());
  }
  const fields = new Map<number, number>();
  for (let block = 0; block < blockCount; block++) {
    const mask = masks[block]!;
    if (mask === 0) continue;
    for (let bit = 0; bit < 32; bit++) {
      if (mask & (1 << bit)) {
        fields.set(block * 32 + bit, r.uint32LE());
      }
    }
  }
  return fields;
}
```

**Step 4: Run test to verify it passes**

Run: `mise test src/wow/protocol/update-mask.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add update mask parser for SMSG_UPDATE_OBJECT
```

---

### Task 4: Movement Block Parser

Parse the complex conditional movement block structure.

**Files:**

- Create: `src/wow/protocol/movement-block.ts`
- Create: `src/wow/protocol/movement-block.test.ts`

**Step 1: Write failing tests**

Test the three major branches: LIVING, HAS_POSITION, and POSITION. Plus
conditional sub-branches (transport, falling, spline).

```typescript
import { test, expect, describe } from "bun:test";
import { PacketWriter } from "./packet";
import { parseMovementBlock, type MovementData } from "./movement-block";

function buildLivingBlock(opts: {
  movementFlags?: number;
  movementFlagsExtra?: number;
  x?: number;
  y?: number;
  z?: number;
  orientation?: number;
  walkSpeed?: number;
  runSpeed?: number;
}): Uint8Array {
  const w = new PacketWriter();
  w.uint16LE(0x0020); // UpdateFlag.LIVING
  w.uint32LE(opts.movementFlags ?? 0);
  w.uint16LE(opts.movementFlagsExtra ?? 0);
  w.uint32LE(0); // timestamp
  w.floatLE(opts.x ?? 0);
  w.floatLE(opts.y ?? 0);
  w.floatLE(opts.z ?? 0);
  w.floatLE(opts.orientation ?? 0);
  w.floatLE(0); // fall time
  // 9 speeds
  w.floatLE(opts.walkSpeed ?? 1.0);
  w.floatLE(opts.runSpeed ?? 7.0);
  w.floatLE(4.5); // backward run
  w.floatLE(4.72); // swim
  w.floatLE(2.5); // backward swim
  w.floatLE(7.0); // flight
  w.floatLE(4.5); // backward flight
  w.floatLE(3.14); // turn
  w.floatLE(0); // pitch
  return w.finish();
}

describe("parseMovementBlock", () => {
  test("LIVING flag extracts position and speeds", () => {
    const buf = buildLivingBlock({
      x: -8949.95,
      y: -132.49,
      z: 83.53,
      orientation: 1.5,
    });
    const r = new (await import("./packet")).PacketReader(buf);
    const result = parseMovementBlock(r);
    expect(result.x).toBeCloseTo(-8949.95, 1);
    expect(result.y).toBeCloseTo(-132.49, 1);
    expect(result.z).toBeCloseTo(83.53, 1);
    expect(result.orientation).toBeCloseTo(1.5, 1);
    expect(result.walkSpeed).toBeCloseTo(1.0);
    expect(result.runSpeed).toBeCloseTo(7.0);
  });

  test("HAS_POSITION flag extracts position", () => {
    const w = new PacketWriter();
    w.uint16LE(0x0040); // HAS_POSITION only
    w.floatLE(100.5);
    w.floatLE(200.5);
    w.floatLE(50.0);
    w.floatLE(3.14);
    const r = new (await import("./packet")).PacketReader(w.finish());
    const result = parseMovementBlock(r);
    expect(result.x).toBeCloseTo(100.5);
    expect(result.y).toBeCloseTo(200.5);
    expect(result.z).toBeCloseTo(50.0);
  });

  test("LIVING with FALLING reads extra fall data", () => {
    const w = new PacketWriter();
    w.uint16LE(0x0020); // LIVING
    w.uint32LE(0x1000); // FALLING flag
    w.uint16LE(0);
    w.uint32LE(0); // timestamp
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0); // pos
    w.floatLE(1.5); // fall time
    // fall data: z_speed, cos_angle, sin_angle, xy_speed
    w.floatLE(-9.8);
    w.floatLE(0.7);
    w.floatLE(0.7);
    w.floatLE(5.0);
    // 9 speeds
    for (let i = 0; i < 9; i++) w.floatLE(0);
    const r = new (await import("./packet")).PacketReader(w.finish());
    const result = parseMovementBlock(r);
    expect(result).toBeDefined();
    expect(r.remaining).toBe(0);
  });

  test("reader consumes all bytes for complex LIVING block", () => {
    // Use exact bytes from wowm test: LIVING|SELF, no transport, no fall, no spline
    const w = new PacketWriter();
    w.uint16LE(0x0021); // LIVING | SELF
    w.uint32LE(0);
    w.uint16LE(0); // movement flags
    w.uint32LE(0); // timestamp
    w.floatLE(-8949.95);
    w.floatLE(-132.49);
    w.floatLE(83.53);
    w.floatLE(0);
    w.floatLE(0); // fall time
    w.floatLE(1.0);
    w.floatLE(70.0);
    w.floatLE(4.5); // walk, run, backward
    w.floatLE(0);
    w.floatLE(0); // swim, backward swim
    w.floatLE(0);
    w.floatLE(0); // flight, backward flight
    w.floatLE(3.14159);
    w.floatLE(0); // turn, pitch
    const r = new (await import("./packet")).PacketReader(w.finish());
    parseMovementBlock(r);
    expect(r.remaining).toBe(0);
  });

  // More tests: POSITION flag, HAS_ATTACKING_TARGET, LOW_GUID, HIGH_GUID,
  // TRANSPORT, VEHICLE, ROTATION, SPLINE_ENABLED, ON_TRANSPORT, SPLINE_ELEVATION
});
```

Note: The actual test file should have exhaustive tests for every conditional
branch in the movement block. Each flag combination that adds bytes must have a
test proving the reader advances correctly. Use `PacketWriter` to build test
buffers — no raw hex arrays.

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/movement-block.test.ts`
Expected: FAIL

**Step 3: Write implementation**

`src/wow/protocol/movement-block.ts`:

The parser is a single `parseMovementBlock(r: PacketReader): MovementData`
function. It reads `updateFlags` (u16), then branches:

1. If `LIVING`: read movementFlags (u32), movementFlagsExtra (u16), timestamp
   (u32), position (4 floats). Then conditionally:
   - If `ON_TRANSPORT` and extra flag `INTERPOLATED_MOVEMENT`: read
     TransportInfo + u32 transport time
   - Else if `ON_TRANSPORT`: read TransportInfo (packed guid, 3 floats, float,
     u32, u8)
   - If `SWIMMING` or `FLYING` or extra `ALWAYS_ALLOW_PITCHING`: read f32 pitch
   - Read f32 fall time
   - If `FALLING`: read 4 floats (z_speed, cos, sin, xy_speed)
   - If `SPLINE_ELEVATION`: read f32
   - Read 9 speed floats
   - If `SPLINE_ENABLED`: read full spline block (flags, conditional final
     point/angle/target, time_passed, duration, id, duration_mod,
     duration_mod_next, vertical_accel, effect_start, node count, nodes array,
     mode byte, final node)
2. Else if `POSITION`: read packed guid, 3 floats position, 3 floats transport
   offset, float orientation, float corpse orientation
3. Else if `HAS_POSITION`: read 3 floats + orientation

Then the trailing conditionals regardless of branch:

- If `HIGH_GUID`: skip u32
- If `LOW_GUID`: skip u32
- If `HAS_ATTACKING_TARGET`: read packed guid (store as attackTarget)
- If `TRANSPORT`: skip u32 (transport progress)
- If `VEHICLE`: skip u32 + f32
- If `ROTATION`: skip u64

Return type `MovementData`:

```typescript
export type MovementData = {
  updateFlags: number;
  x: number;
  y: number;
  z: number;
  orientation: number;
  walkSpeed?: number;
  runSpeed?: number;
};
```

We only extract position and speeds for the entity store. The parser must still
read every conditional byte to advance the reader correctly, even for data we
discard.

**Step 4: Run tests**

Run: `mise test src/wow/protocol/movement-block.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add movement block parser for SMSG_UPDATE_OBJECT
```

---

### Task 5: Entity Store

In-memory entity storage with typed discriminated union and secondary indexes.

**Files:**

- Create: `src/wow/entity-store.ts`
- Create: `src/wow/entity-store.test.ts`

**Step 1: Write failing tests**

```typescript
import { test, expect, describe } from "bun:test";
import { EntityStore, type Entity, type EntityEvent } from "./entity-store";
import { ObjectType } from "wow/protocol/entity-fields";

describe("EntityStore", () => {
  test("create adds entity and fires appear event", () => {
    const store = new EntityStore();
    const events: EntityEvent[] = [];
    store.onEvent((e) => events.push(e));

    store.create(1n, ObjectType.UNIT, {
      health: 100,
      maxHealth: 100,
      level: 55,
    });

    expect(store.get(1n)).toBeDefined();
    expect(store.get(1n)!.objectType).toBe(ObjectType.UNIT);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("appear");
  });

  test("update merges fields and fires update event with changed list", () => {
    const store = new EntityStore();
    store.create(1n, ObjectType.UNIT, { health: 100, maxHealth: 100 });

    const events: EntityEvent[] = [];
    store.onEvent((e) => events.push(e));
    store.update(1n, { health: 50 });

    const entity = store.get(1n)!;
    expect((entity as any).health).toBe(50);
    expect(events[0]!.type).toBe("update");
    expect((events[0] as any).changed).toContain("health");
  });

  test("destroy removes entity and fires disappear event", () => {
    const store = new EntityStore();
    store.create(1n, ObjectType.UNIT, { health: 100, name: "Thrall" });

    const events: EntityEvent[] = [];
    store.onEvent((e) => events.push(e));
    store.destroy(1n);

    expect(store.get(1n)).toBeUndefined();
    expect(events[0]!.type).toBe("disappear");
    expect((events[0] as any).name).toBe("Thrall");
  });

  test("getByType returns entities of specified type", () => {
    const store = new EntityStore();
    store.create(1n, ObjectType.UNIT, {});
    store.create(2n, ObjectType.GAMEOBJECT, {});
    store.create(3n, ObjectType.UNIT, {});

    const units = [...store.getByType(ObjectType.UNIT)];
    expect(units).toHaveLength(2);
  });

  test("clear removes all entities and fires disappear for each", () => {
    const store = new EntityStore();
    store.create(1n, ObjectType.UNIT, {});
    store.create(2n, ObjectType.GAMEOBJECT, {});

    const events: EntityEvent[] = [];
    store.onEvent((e) => events.push(e));
    store.clear();

    expect(store.all()).toHaveLength(0);
    expect(events.filter((e) => e.type === "disappear")).toHaveLength(2);
  });

  test("update on nonexistent guid is a no-op", () => {
    const store = new EntityStore();
    const events: EntityEvent[] = [];
    store.onEvent((e) => events.push(e));
    store.update(999n, { health: 1 });
    expect(events).toHaveLength(0);
  });

  test("setName updates name and fires update event", () => {
    const store = new EntityStore();
    store.create(1n, ObjectType.UNIT, { entry: 1234 });
    const events: EntityEvent[] = [];
    store.onEvent((e) => events.push(e));
    store.setName(1n, "Innkeeper Palla");
    expect((store.get(1n) as any).name).toBe("Innkeeper Palla");
    expect(events[0]!.type).toBe("update");
  });

  test("setPosition updates position", () => {
    const store = new EntityStore();
    store.create(1n, ObjectType.UNIT, {});
    store.setPosition(1n, { mapId: 0, x: 1, y: 2, z: 3, orientation: 0 });
    expect(store.get(1n)!.position).toEqual({
      mapId: 0,
      x: 1,
      y: 2,
      z: 3,
      orientation: 0,
    });
  });

  test("destroy updates secondary index", () => {
    const store = new EntityStore();
    store.create(1n, ObjectType.UNIT, {});
    store.destroy(1n);
    expect([...store.getByType(ObjectType.UNIT)]).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/entity-store.test.ts`
Expected: FAIL

**Step 3: Write implementation**

`src/wow/entity-store.ts`:

Entity types as a discriminated union on `objectType`. Base type has `guid`,
`objectType`, `entry`, `scale`, `position`, `rawFields`, `name`. Unit extends
with health/maxHealth/level/factionTemplate/displayId/npcFlags/unitFlags/target/
race/class\_/gender/power/maxPower. GameObject extends with gameObjectType/
displayId/flags/bytes1. Player extends Unit. Corpse/DynamicObject use base only.

`EntityStore` class:

- Private `entities: Map<bigint, Entity>` and `byType: Map<number, Set<bigint>>`
- Private `listener?: (event: EntityEvent) => void`
- `onEvent(cb)`, `create(guid, objectType, fields, position?)`,
  `update(guid, fields)`, `destroy(guid)`, `clear()`,
  `get(guid)`, `getByType(type)`, `all()`,
  `setName(guid, name)`, `setPosition(guid, pos)`

`EntityEvent` discriminated union:

```typescript
export type EntityEvent =
  | { type: "appear"; entity: Entity }
  | { type: "disappear"; guid: bigint; name?: string }
  | { type: "update"; entity: Entity; changed: string[] };
```

**Step 4: Run tests**

Run: `mise test src/wow/entity-store.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add entity store with typed entities and event callbacks
```

---

### Task 6: Update Object Packet Parser

Top-level parser that dispatches by update type and wires mask + movement +
field extraction together.

**Files:**

- Create: `src/wow/protocol/update-object.ts`
- Create: `src/wow/protocol/update-object.test.ts`

**Step 1: Write failing tests**

Tests use `PacketWriter` to construct full SMSG_UPDATE_OBJECT payloads. Key test
cases:

- **CREATE_OBJECT2 for a player** — use the exact byte sequence from the wowm
  test (LIVING|SELF, position, speeds, 3-block update mask with GUID, TYPE,
  FACTIONTEMPLATE, DISPLAYID, NATIVEDISPLAYID). Verify all parsed fields.
- **VALUES update** — packed GUID + mask with one changed field (health). Verify
  the returned update contains only the changed field.
- **OUT_OF_RANGE** — 2 packed GUIDs. Verify both GUIDs returned.
- **NEAR_OBJECTS** — same format as OUT_OF_RANGE.
- **Multiple objects in one packet** — one CREATE + one VALUES in same packet.
- **CREATE_OBJECT for a game object** — HAS_POSITION flag (not LIVING), game
  object fields in mask.
- **MOVEMENT update type** — packed GUID + movement block only, no fields.

The parser returns an array of `UpdateEntry` discriminated union:

```typescript
export type UpdateEntry =
  | {
      type: "create";
      guid: bigint;
      objectType: number;
      position?: Position;
      fields: Map<number, number>;
    }
  | { type: "values"; guid: bigint; fields: Map<number, number> }
  | { type: "movement"; guid: bigint; position: Position }
  | { type: "outOfRange"; guids: bigint[] }
  | { type: "nearObjects"; guids: bigint[] };
```

Where `guid` is composed from packed GUID low/high into a single bigint
`(BigInt(high) << 32n) | BigInt(low >>> 0)`.

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/update-object.test.ts`
Expected: FAIL

**Step 3: Write implementation**

`src/wow/protocol/update-object.ts`:

```typescript
export function parseUpdateObject(r: PacketReader): UpdateEntry[] {
  const count = r.uint32LE();
  const entries: UpdateEntry[] = [];
  for (let i = 0; i < count; i++) {
    const updateType = r.uint8();
    switch (updateType) {
      case UpdateType.VALUES: {
        const guid = readGuidBigint(r);
        const fields = parseUpdateMask(r);
        entries.push({ type: "values", guid, fields });
        break;
      }
      case UpdateType.MOVEMENT: {
        const guid = readGuidBigint(r);
        const movement = parseMovementBlock(r);
        entries.push({
          type: "movement",
          guid,
          position: {
            mapId: 0,
            x: movement.x,
            y: movement.y,
            z: movement.z,
            orientation: movement.orientation,
          },
        });
        break;
      }
      case UpdateType.CREATE_OBJECT:
      case UpdateType.CREATE_OBJECT2: {
        const guid = readGuidBigint(r);
        const objectType = r.uint8();
        const movement = parseMovementBlock(r);
        const fields = parseUpdateMask(r);
        entries.push({
          type: "create",
          guid,
          objectType,
          position: {
            mapId: 0,
            x: movement.x,
            y: movement.y,
            z: movement.z,
            orientation: movement.orientation,
          },
          fields,
        });
        break;
      }
      case UpdateType.OUT_OF_RANGE: {
        const n = r.uint32LE();
        const guids: bigint[] = [];
        for (let j = 0; j < n; j++) guids.push(readGuidBigint(r));
        entries.push({ type: "outOfRange", guids });
        break;
      }
      case UpdateType.NEAR_OBJECTS: {
        const n = r.uint32LE();
        const guids: bigint[] = [];
        for (let j = 0; j < n; j++) guids.push(readGuidBigint(r));
        entries.push({ type: "nearObjects", guids });
        break;
      }
    }
  }
  return entries;
}

function readGuidBigint(r: PacketReader): bigint {
  const { low, high } = r.packedGuid();
  return (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
}
```

**Step 4: Run tests**

Run: `mise test src/wow/protocol/update-object.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add SMSG_UPDATE_OBJECT top-level packet parser
```

---

### Task 7: Field Extraction Logic

Bridge between raw update mask values and typed entity properties. Reads the
raw `Map<number, number>` from the mask parser and produces named fields for
entity creation and updates.

**Files:**

- Create: `src/wow/protocol/extract-fields.ts`
- Create: `src/wow/protocol/extract-fields.test.ts`

**Step 1: Write failing tests**

```typescript
import { test, expect, describe } from "bun:test";
import {
  extractUnitFields,
  extractGameObjectFields,
  extractObjectFields,
} from "./extract-fields";
import { OBJECT_FIELDS, UNIT_FIELDS, GAMEOBJECT_FIELDS } from "./entity-fields";

describe("extractObjectFields", () => {
  test("extracts entry from raw mask", () => {
    const raw = new Map([[OBJECT_FIELDS.ENTRY.offset, 12345]]);
    const result = extractObjectFields(raw);
    expect(result.entry).toBe(12345);
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
  });

  test("unpacks BYTES_0 into race/class/gender", () => {
    // race=2 (Orc), class=1 (Warrior), gender=0 (Male), powerType=1
    const packed = 2 | (1 << 8) | (0 << 16) | (1 << 24);
    const raw = new Map([[UNIT_FIELDS.BYTES_0.offset, packed]]);
    const result = extractUnitFields(raw);
    expect(result.race).toBe(2);
    expect(result.class_).toBe(1);
    expect(result.gender).toBe(0);
  });

  test("extracts target as bigint from two consecutive fields", () => {
    const raw = new Map([
      [UNIT_FIELDS.TARGET.offset, 42],
      [UNIT_FIELDS.TARGET.offset + 1, 0],
    ]);
    const result = extractUnitFields(raw);
    expect(result.target).toBe(42n);
  });

  test("returns changed field names", () => {
    const raw = new Map([[UNIT_FIELDS.HEALTH.offset, 100]]);
    const result = extractUnitFields(raw);
    expect(result._changed).toContain("health");
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

  test("unpacks BYTES_1 for state", () => {
    const packed = 1 | (0 << 8) | (0xff << 16) | (0 << 24);
    const raw = new Map([[GAMEOBJECT_FIELDS.BYTES_1.offset, packed]]);
    const result = extractGameObjectFields(raw);
    expect(result.state).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/extract-fields.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Functions that take `Map<number, number>` (raw mask output) and return partial
typed objects. Each function checks for the presence of known field offsets and
extracts/converts values. Size-2 fields (u64) are composed from two consecutive
uint32s. Bytes4 fields are unpacked into individual bytes. Returns a `_changed`
array listing which named fields were present.

**Step 4: Run tests**

Run: `mise test src/wow/protocol/extract-fields.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add field extraction from update mask to typed entities
```

---

### Task 8: Name Query Builders and Parsers

Creature and game object query packets (player name queries already exist).

**Files:**

- Create: `src/wow/protocol/entity-queries.ts`
- Create: `src/wow/protocol/entity-queries.test.ts`

**Step 1: Write failing tests**

```typescript
import { test, expect, describe } from "bun:test";
import { PacketReader } from "./packet";
import {
  buildCreatureQuery,
  parseCreatureQueryResponse,
  buildGameObjectQuery,
  parseGameObjectQueryResponse,
} from "./entity-queries";

describe("creature query", () => {
  test("buildCreatureQuery produces correct bytes", () => {
    const buf = buildCreatureQuery(1234, 5n);
    const r = new PacketReader(buf);
    expect(r.uint32LE()).toBe(1234); // entry
    expect(r.uint64LE()).toBe(5n); // guid
  });

  test("parseCreatureQueryResponse extracts name", () => {
    // Build a mock response: u32 entry, cstring name, 3x empty cstring, ...
    const w = new (await import("./packet")).PacketWriter();
    w.uint32LE(1234);
    w.cString("Innkeeper Palla");
    w.cString("");
    w.cString("");
    w.cString(""); // alt names
    w.cString("Innkeeper"); // subname
    // We only care about entry and name
    const r = new PacketReader(w.finish());
    const result = parseCreatureQueryResponse(r);
    expect(result.entry).toBe(1234);
    expect(result.name).toBe("Innkeeper Palla");
  });

  test("parseCreatureQueryResponse handles unknown entry (0x80000000 mask)", () => {
    const w = new (await import("./packet")).PacketWriter();
    w.uint32LE(1234 | 0x80000000);
    const r = new PacketReader(w.finish());
    const result = parseCreatureQueryResponse(r);
    expect(result.entry).toBe(1234);
    expect(result.name).toBeUndefined();
  });
});

describe("game object query", () => {
  test("buildGameObjectQuery produces correct bytes", () => {
    const buf = buildGameObjectQuery(5678, 10n);
    const r = new PacketReader(buf);
    expect(r.uint32LE()).toBe(5678);
    expect(r.uint64LE()).toBe(10n);
  });

  test("parseGameObjectQueryResponse extracts name", () => {
    const w = new (await import("./packet")).PacketWriter();
    w.uint32LE(5678);
    w.uint32LE(19); // type (mailbox)
    w.uint32LE(1234); // displayId
    w.cString("Mailbox");
    // rest doesn't matter for us
    const r = new PacketReader(w.finish());
    const result = parseGameObjectQueryResponse(r);
    expect(result.entry).toBe(5678);
    expect(result.name).toBe("Mailbox");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/entity-queries.test.ts`
Expected: FAIL

**Step 3: Write implementation**

`src/wow/protocol/entity-queries.ts`:

- `buildCreatureQuery(entry, guid)` — PacketWriter: u32 entry + u64 guid
- `parseCreatureQueryResponse(r)` — Read u32 (if high bit set, entry is unknown,
  return early). Read entry, cstring name, skip 3 alt names. Return `{ entry, name }`.
- `buildGameObjectQuery(entry, guid)` — PacketWriter: u32 entry + u64 guid
- `parseGameObjectQueryResponse(r)` — Read u32 entry (check high bit), u32 type,
  u32 displayId, cstring name. Return `{ entry, name, gameObjectType }`.

Wire format reference from AzerothCore handler code: creature query response is
entry + name + 3 alt names + subname + icon + type_flags + creature_type + family

- rank + ... We only read through name.

**Step 4: Run tests**

Run: `mise test src/wow/protocol/entity-queries.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add creature and game object query builders and parsers
```

---

### Task 9: Client Integration

Wire up the SMSG_UPDATE_OBJECT handler, name query response handlers, entity
store, and WorldHandle extensions in `client.ts`.

**Files:**

- Modify: `src/wow/client.ts`
- Modify: `src/wow/protocol/opcodes.ts` (add missing query opcodes if needed)
- Modify: `src/wow/protocol/stubs.ts` (remove UPDATE_OBJECT stub)
- Modify: `src/test/mock-handle.ts` (add entity methods)

**Step 1: Write failing test**

Create `src/wow/protocol/update-object-integration.test.ts` that tests the full
pipeline: construct a mock WorldConn-like object, feed it a raw UPDATE_OBJECT
packet buffer, verify entities land in the store with correct fields and names.

Key test cases:

- CREATE_OBJECT2 for unit → entity in store with health, level, position
- VALUES update → entity fields updated, EntityEvent fired with changed list
- OUT_OF_RANGE → entity removed, disappear event
- CREATE_OBJECT for player → CMSG_NAME_QUERY sent (verify via spy on sendPacket)
- CREATE_OBJECT for NPC → CMSG_CREATURE_QUERY sent
- CREATE_OBJECT for game object → CMSG_GAMEOBJECT_QUERY sent
- Name query response received → entity.name updated

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/update-object-integration.test.ts`
Expected: FAIL

**Step 3: Write implementation**

In `client.ts`:

1. Import EntityStore and parser functions
2. Add `entityStore: EntityStore` to WorldConn
3. Add `nameCache` maps for creatures and game objects (separate from player
   nameCache which already exists) — or unify into one cache keyed by
   `"creature:${entry}"`, `"gameobject:${entry}"`, `"player:${guidLow}"`
4. Register `SMSG_UPDATE_OBJECT` handler that calls `parseUpdateObject(r)`,
   loops over entries, and for each:
   - `create` → extract fields by objectType, call `entityStore.create()`,
     send name query if not cached
   - `values` → extract changed fields, call `entityStore.update()`
   - `movement` → call `entityStore.setPosition()`
   - `outOfRange` → call `entityStore.destroy()` for each guid
   - `nearObjects` → no action (entities arrive via CREATE_OBJECT)
5. Register `SMSG_CREATURE_QUERY_RESPONSE` handler: parse, cache name, backfill
   all entities with matching entry via `entityStore.setName()`
6. Register `SMSG_GAMEOBJECT_QUERY_RESPONSE` handler: same pattern
7. Remove SMSG_UPDATE_OBJECT from stubs (it now has a real handler)
8. Extend WorldHandle with `onEntityEvent(cb)` and `getNearbyEntities()`
9. Add `entityStore.clear()` call in the close/disconnect path

Update `mock-handle.ts`:

- Add `onEntityEvent`, `getNearbyEntities`, `triggerEntityEvent` to the mock

**Step 4: Run tests**

Run: `mise test src/wow/protocol/update-object-integration.test.ts`
Run: `mise test` (full suite to check nothing broke)
Expected: PASS

**Step 5: Commit**

```
feat: Wire SMSG_UPDATE_OBJECT handler into world session
```

---

### Task 10: TUI Integration

Add `/tuicraft entities on|off` toggle and entity event display.

**Files:**

- Modify: `src/ui/tui.ts`
- Modify: `src/ui/tui.test.ts` (or create if it doesn't exist)

**Step 1: Write failing tests**

Test `parseCommand("/tuicraft entities on")` returns a new command type.
Test `formatEntityEvent()` for appear/disappear events.

```typescript
test("parseCommand handles /tuicraft entities on", () => {
  const cmd = parseCommand("/tuicraft entities on");
  expect(cmd).toEqual({
    type: "tuicraft",
    subcommand: "entities",
    value: "on",
  });
});

test("parseCommand handles /tuicraft entities off", () => {
  const cmd = parseCommand("/tuicraft entities off");
  expect(cmd).toEqual({
    type: "tuicraft",
    subcommand: "entities",
    value: "off",
  });
});

test("formatEntityEvent for unit appear", () => {
  const result = formatEntityEvent({
    type: "appear",
    entity: { objectType: 3, name: "Innkeeper Palla", level: 55 } as any,
  });
  expect(result).toContain("Innkeeper Palla");
  expect(result).toContain("level 55");
});

test("formatEntityEvent for disappear", () => {
  const result = formatEntityEvent({
    type: "disappear",
    guid: 1n,
    name: "Silvermoon Guardian",
  });
  expect(result).toContain("left range");
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL

**Step 3: Write implementation**

1. Add `tuicraft` command type to `Command` union:
   `| { type: "tuicraft"; subcommand: string; value: string }`
2. Add `/tuicraft` case in `parseCommand` — parse subcommand and value from rest
3. Add `formatEntityEvent(event: EntityEvent): string` function:
   - appear: `[world] Name appeared (type, level N)` or `[world] Name appeared (GameObject)`
   - disappear: `[world] Name left range` (or `Unknown entity left range` if no name)
   - update: return undefined (not displayed)
4. Add `showEntityEvents: boolean` to `TuiState`, default false
5. In `executeCommand`, handle `tuicraft` command: toggle `showEntityEvents`
6. In `startTui`, register `handle.onEntityEvent` callback that formats and
   displays when `state.showEntityEvents` is true

**Step 4: Run tests**

Run: `mise test src/ui/tui.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add /tuicraft entities toggle and entity event display
```

---

### Task 11: Daemon Integration

Add `NEARBY` verb and entity events in ring buffer.

**Files:**

- Modify: `src/daemon/commands.ts`
- Modify: `src/daemon/commands.test.ts`
- Modify: `src/daemon/server.ts` (wire onEntityEvent to ring buffer)

**Step 1: Write failing tests**

```typescript
test("parseIpcCommand parses NEARBY", () => {
  expect(parseIpcCommand("NEARBY")).toEqual({ type: "nearby" });
});

test("parseIpcCommand parses NEARBY_JSON", () => {
  expect(parseIpcCommand("NEARBY_JSON")).toEqual({ type: "nearby_json" });
});

test("dispatchCommand NEARBY returns entity list", async () => {
  const handle = createMockHandle();
  // Mock getNearbyEntities to return test data
  handle.getNearbyEntities = () => [
    {
      guid: 1n,
      objectType: 3,
      name: "Thrall",
      level: 80,
      health: 5000,
      maxHealth: 5000,
      position: { mapId: 1, x: 1, y: 2, z: 3, orientation: 0 },
    } as any,
  ];
  const lines: string[] = [];
  const socket = {
    write: (s: string) => {
      lines.push(s);
      return s.length;
    },
    end() {},
  };
  await dispatchCommand({ type: "nearby" }, handle, events, socket, () => {});
  expect(lines.join("")).toContain("Thrall");
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL

**Step 3: Write implementation**

1. Add `nearby` and `nearby_json` to `IpcCommand` union
2. Add `NEARBY` and `NEARBY_JSON` verb parsing in `parseIpcCommand`
3. Add dispatch case for `nearby`:
   - Call `handle.getNearbyEntities()`
   - Format each entity as a readable line: `Name (type, level N) at x,y,z`
   - Write lines + terminator
4. Add dispatch case for `nearby_json`:
   - Same but `JSON.stringify` each entity
5. In `server.ts` (or wherever `onEntityEvent` is wired), push entity events
   into the ring buffer alongside chat/group events using the same
   `EventEntry` pattern:

   ```typescript
   handle.onEntityEvent((event) => {
     const text = formatEntityEvent(event);
     const json = JSON.stringify(formatEntityEventObj(event));
     events.push({ text: text ?? undefined, json });
   });
   ```

6. Add `formatEntityEventObj(event: EntityEvent)` to commands.ts matching the
   pattern of `formatGroupEventObj`

**Step 4: Run tests**

Run: `mise test src/daemon/commands.test.ts`
Run: `mise test` (full suite)
Expected: PASS

**Step 5: Commit**

```
feat: Add NEARBY verb and entity events to daemon IPC
```

---

### Task 12: Live Server Tests

Two-character test: Xia sees Yia appear and disappear.

**Files:**

- Modify: `src/test/live.ts`

**Step 1: Write the test**

```typescript
describe("entity tracking", () => {
  test("character sees another character appear", async () => {
    const auth1 = await authHandshake(config1);
    const auth2 = await authHandshake(config2);

    const handle1 = await worldSession(config1, auth1);

    await Bun.sleep(2000);

    const events: EntityEvent[] = [];
    handle1.onEntityEvent((e) => events.push(e));

    const handle2 = await worldSession(config2, auth2);

    await Bun.sleep(5000);

    handle2.close();
    await Bun.sleep(3000);

    handle1.close();
    await Promise.all([handle1.closed, handle2.closed]);

    const appeared = events.find(
      (e) =>
        e.type === "appear" && (e.entity as any).name === config2.character,
    );
    expect(appeared).toBeDefined();

    const disappeared = events.find(
      (e) => e.type === "disappear" && e.name === config2.character,
    );
    expect(disappeared).toBeDefined();
  }, 30_000);

  test("getNearbyEntities returns entities with positions", async () => {
    const auth1 = await authHandshake(config1);
    const handle1 = await worldSession(config1, auth1);

    await Bun.sleep(3000);

    const entities = handle1.getNearbyEntities();
    expect(entities.length).toBeGreaterThan(0);

    const withPosition = entities.filter((e) => e.position);
    expect(withPosition.length).toBeGreaterThan(0);

    for (const e of withPosition) {
      expect(e.position!.x).not.toBeNaN();
      expect(e.position!.y).not.toBeNaN();
      expect(e.position!.z).not.toBeNaN();
    }

    handle1.close();
    await handle1.closed;
  }, 15_000);
});
```

**Step 2: Run against live server**

Run: `mise test:live`
Expected: PASS — Xia's entity store sees Yia appear with name, then disappear
when Yia disconnects. Nearby entities have real coordinates.

**Step 3: Fix any protocol issues discovered**

Live testing often reveals edge cases not covered by mock tests. Common issues:

- Movement block flag combinations we didn't test
- Name query response format differences
- Entity types we didn't expect (pets, totems)

Fix issues, add regression tests, re-run.

**Step 4: Commit**

```
test: Add two-character entity tracking live test
```

---

### Task 13: Final Cleanup

Remove UPDATE_OBJECT and related opcodes from stubs. Run full test suite.
Verify typecheck and formatting pass.

**Files:**

- Modify: `src/wow/protocol/stubs.ts`

**Step 1: Remove implemented stubs**

Remove `SMSG_UPDATE_OBJECT`, `SMSG_CREATURE_QUERY_RESPONSE`,
`SMSG_GAMEOBJECT_QUERY_RESPONSE` from the STUBS array (they now have real
handlers).

**Step 2: Run full CI**

Run: `mise ci`
Expected: typecheck PASS, test PASS, format PASS

**Step 3: Run live tests**

Run: `mise test:live`
Expected: PASS

**Step 4: Commit**

```
chore: Remove implemented opcodes from stub registry
```

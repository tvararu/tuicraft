# Entity Parsing Design (v0.4)

**Date**: 2026-02-25
**Status**: Approved design

## What This Is

Parse `SMSG_UPDATE_OBJECT` to build an in-memory model of every nearby entity:
players, NPCs, game objects, corpses, dynamic objects. Surface this as an
awareness feature (events in TUI, JSONL over IPC) and architect the entity store
as the foundation for the v5 healer bot.

## Architecture

Three files, layered by concern:

- `src/wow/protocol/update-object.ts` — Wire-level parsing. Movement blocks,
  update masks, packet dispatch by update type. Pure functions from
  `PacketReader` to parsed structures.
- `src/wow/protocol/entity-fields.ts` — Field offset definitions as typed data
  tables, extracted from AzerothCore `UpdateFields.h`. Maps bit indices to named
  properties per object type.
- `src/wow/entity-store.ts` — In-memory world state. Typed entity map,
  secondary type index, create/update/destroy lifecycle.

## Entity Data Model

Discriminated union keyed by 64-bit GUID.

**ObjectType enum:** OBJECT (0), ITEM (1), CONTAINER (2), UNIT (3), PLAYER (4),
GAMEOBJECT (5), DYNAMICOBJECT (6), CORPSE (7).

**Base fields (all entities):**

- `guid: bigint`
- `objectType: ObjectType`
- `entry: number` (template ID)
- `scale: number`
- `position: { mapId: number; x: number; y: number; z: number; orientation: number } | undefined`
- `rawFields: Map<number, number>` (uninterpreted uint32 values by absolute offset)

**Unit fields (NPCs + players):**

- `health`, `maxHealth`, `level`, `factionTemplate`, `displayId`, `npcFlags`,
  `unitFlags`, `target: bigint`
- `race`, `class_`, `gender` (unpacked from `UNIT_FIELD_BYTES_0`)
- `power: number[]`, `maxPower: number[]` (indexed by power type)
- `name: string | undefined` (async via query)

**Player fields:** Same as unit. Name resolved via `SMSG_NAME_QUERY_RESPONSE`.

**GameObject fields:**

- `gameObjectType`, `displayId`, `flags`, `state`
- `name: string | undefined`

**Corpse / DynamicObject:** Base fields + `rawFields` only.

**Store structure:**

- `entities: Map<bigint, Entity>` — primary store
- `byType: Map<ObjectType, Set<bigint>>` — secondary index

No ECS. WoW entities have fixed field sets per type — the protocol defines
the schema, not runtime composition.

## Wire Format

`SMSG_UPDATE_OBJECT` payload:

    u32  objectCount
    [for each]:
      u8  updateType
      ... type-specific data

**Update types:**

| Type           | Value | Payload                                                                   |
| -------------- | ----- | ------------------------------------------------------------------------- |
| VALUES         | 0     | packed GUID + update mask + field values                                  |
| MOVEMENT       | 1     | packed GUID + movement block                                              |
| CREATE_OBJECT  | 2     | packed GUID + u8 objectType + movement block + update mask + field values |
| CREATE_OBJECT2 | 3     | same as CREATE_OBJECT (flags entity as "near")                            |
| OUT_OF_RANGE   | 4     | u32 count + packed GUIDs                                                  |
| NEAR_OBJECTS   | 5     | u32 count + packed GUIDs                                                  |

**Update mask:**

1. Read `u8` block count (number of uint32s in mask)
2. Read N uint32 mask blocks
3. For each set bit, read one uint32 value
4. Map bit index to field offset, look up in entity-fields table

**Movement block:**

    u16  updateFlags
    if LIVING:
      u32  movementFlags
      u16  movementFlagsExtra
      u32  timestamp
      float x, y, z, orientation
      [conditional: transport data]
      [conditional: swimming pitch]
      [conditional: fall data]
      [conditional: spline elevation]
      9x float speeds (walk, run, backward, swim, swimBack,
                       flight, flightBack, turn, pitch)
      [conditional: spline data]
    if HAS_POSITION (not LIVING):
      float x, y, z, orientation

Conditionals branch on flag bits in movementFlags and updateFlags. The parser
reads them in server write order, extracts position and speeds, skips over
transport/spline data (parsed to advance the reader, not stored).

## Field Definitions as Data

Each entry in entity-fields.ts is a `{ offset, size, type }` tuple where type
is one of `u32`, `f32`, `u64`, `bytes4`.

Organized by hierarchy matching `UpdateFields.h`:

- `OBJECT_FIELDS`: offsets 0x0000–0x0005 (GUID, TYPE, ENTRY, SCALE_X)
- `UNIT_FIELDS`: offsets relative to OBJECT_END (0x0006). HEALTH at 0x0012,
  MAXHEALTH at 0x001A, LEVEL at 0x0030, FACTIONTEMPLATE at 0x0031, TARGET at
  0x000C, BYTES_0 at 0x0011, FLAGS at 0x0035, NPC_FLAGS at 0x004C, DISPLAYID
  at 0x003D, MOD_CAST_SPEED at 0x004A, POWER1..7 at 0x0013–0x0019, MAXPOWER1..7
  at 0x001B–0x0021
- `GAMEOBJECT_FIELDS`: offsets relative to OBJECT_END. CREATED_BY at 0x0000,
  STATE at 0x0001, DISPLAYID at 0x0002, FLAGS at 0x0006, TYPE_ID at 0x0008

Adding a new interpreted field = adding one row to the table + one property to
the entity type. Fields not in the table land in `rawFields`.

## Name Resolution

Three query/response pairs, all eager on entity create:

| Entity type | Query                            | Response                                  |
| ----------- | -------------------------------- | ----------------------------------------- |
| Player      | `CMSG_NAME_QUERY` (0x0050)       | `SMSG_NAME_QUERY_RESPONSE` (0x0051)       |
| Creature    | `CMSG_CREATURE_QUERY` (0x0060)   | `SMSG_CREATURE_QUERY_RESPONSE` (0x0061)   |
| Game Object | `CMSG_GAMEOBJECT_QUERY` (0x005E) | `SMSG_GAMEOBJECT_QUERY_RESPONSE` (0x005F) |

Creature and game object names are cached by entry ID (many entities share the
same template). Player names cached by GUID low part — absorbs the existing
`nameCache`. Queries skipped if cached. Responses backfill `entity.name` for
all entities sharing that entry.

## Entity Store Lifecycle

Lives on `WorldConn`. Exposes through `WorldHandle`:

**WorldHandle additions:**

- `onEntityEvent(cb: (event: EntityEvent) => void)` — appear/disappear/update
- `getNearbyEntities(): Entity[]` — snapshot for daemon

**EntityEvent union:**

    | { type: "appear"; entity: Entity }
    | { type: "disappear"; guid: bigint; name?: string }
    | { type: "update"; entity: Entity; changed: string[] }

The `changed` array lists which named fields changed (e.g. `["health",
"target"]`), so consumers decide relevance.

Store clears on disconnect. No persistence across sessions.

## TUI Integration

Entity events render in the chat log behind a toggle:

    /tuicraft entities on
    /tuicraft entities off

Default off. When enabled:

    [world] Innkeeper Palla appeared (NPC, level 55)
    [world] Eitrigg appeared (Player, level 80, Orc Warrior)
    [world] Mailbox appeared (GameObject)
    [world] Silvermoon Guardian left range

Only appear/disappear events. No field-update events (health changes, target
switches) — too noisy.

## Daemon Integration

New `NEARBY` verb. Returns JSONL, one entity per line:

    {"guid":"0x...","type":"unit","name":"Innkeeper Palla","level":55,"health":4200,"maxHealth":4200,"x":1.23,"y":4.56,"z":7.89}
    {"guid":"0x...","type":"gameobject","name":"Mailbox","gameObjectType":19,"x":1.50,"y":4.60,"z":7.89}

Entity events flow into the ring buffer so `TAIL` and `READ` consumers see them
alongside chat and group events.

## Testing Strategy

**Unit tests (hand-crafted byte buffers):**

- Update mask parser: empty mask, single field, multiple blocks, all bits set,
  block boundaries, size-2 fields spanning uint32s
- Movement block: LIVING with speeds, HAS_POSITION only, transport, spline,
  all conditional flag combinations
- Field extraction: unit fields from mask output, game object fields, unknown
  fields in rawFields, float decoding, BYTES_0 unpacking
- Entity store: create, partial update, destroy, type index, getByType,
  destroyAll
- Full packets: VALUES, CREATE_OBJECT with movement + fields, OUT_OF_RANGE,
  multiple objects per packet

**Integration tests:**

- Entity create → name query → response → name populated
- Entity create → field update → store updated → EntityEvent with changed list
- Entity create → OUT_OF_RANGE → store empty, disappear event
- Multiple entity types in one packet

**Live server tests (`mise test:live`):**

- Two-character test: log in Xia, log in Yia, verify Xia sees Yia appear with
  correct name/race/class. Disconnect Yia, verify disappear event.
- Verify entity positions have reasonable coordinates (not zero/NaN)

**Coverage target:** 100% of new code.

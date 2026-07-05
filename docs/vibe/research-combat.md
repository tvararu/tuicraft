# Combat / Loot / Death — implementation reference

Merged research for adding COMBAT, LOOT, and DEATH handling to tuicraft.
Sources: wow_messages wowm definitions (`~/code/wow_messages/wow_message_parser/wowm/world/`,
WRATH 3.3.5a build 12340), AzerothCore playerbots fork source
(`~/code/azerothcore-wotlk-playerbots/src/server/game/`), tuicraft branch `vibe`,
and AzerothCore world DB SQL. **Where wow_messages and AzerothCore disagree,
AzerothCore wins — it is the target server.** All conflicts are listed
explicitly in §5.

Conventions: little-endian unless noted. `Guid` = 8-byte LE u64. `PackedGuid` =
1 mask byte + one byte per set mask bit (LSB-first, only non-zero bytes;
`0x00` alone = guid 0). `Spell`/`Item`/`Map`/`Milliseconds`/`Seconds` = u32.
`Bool` = u8. `CString` = NUL-terminated. CMSG header: u16be size + u32le
opcode. SMSG header: u16be size + u16le opcode.

---

## 1. Wire reference

### 1.1 Opcode table

| Opcode                          | Hex    | Dir  | Body                                                                                                                                                                                     |
| ------------------------------- | ------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CMSG_SET_SELECTION              | 0x013D | C→S  | Guid target (0 = clear)                                                                                                                                                                  |
| CMSG_ATTACKSWING                | 0x0141 | C→S  | Guid target                                                                                                                                                                              |
| CMSG_ATTACKSTOP                 | 0x0142 | C→S  | empty                                                                                                                                                                                    |
| SMSG_ATTACKSTART                | 0x0143 | S→C  | Guid attacker; Guid victim                                                                                                                                                               |
| SMSG_ATTACKSTOP                 | 0x0144 | S→C  | PackedGuid attacker; PackedGuid victim; u32 dead                                                                                                                                         |
| SMSG_ATTACKSWING_NOTINRANGE     | 0x0145 | S→C  | empty                                                                                                                                                                                    |
| SMSG_ATTACKSWING_BADFACING      | 0x0146 | S→C  | empty                                                                                                                                                                                    |
| SMSG_ATTACKSWING_DEADTARGET     | 0x0148 | S→C  | empty                                                                                                                                                                                    |
| SMSG_ATTACKSWING_CANT_ATTACK    | 0x0149 | S→C  | empty                                                                                                                                                                                    |
| SMSG_ATTACKERSTATEUPDATE        | 0x014A | S→C  | see §1.3                                                                                                                                                                                 |
| SMSG_CANCEL_COMBAT              | 0x014E | S→C  | empty                                                                                                                                                                                    |
| SMSG_AI_REACTION                | 0x013C | S→C  | Guid unit; u32 reaction (2 = hostile/aggro)                                                                                                                                              |
| CMSG_CAST_SPELL                 | 0x012E | C→S  | see §1.4                                                                                                                                                                                 |
| CMSG_CANCEL_CAST                | 0x012F | C→S  | u8 cast_count; Spell id                                                                                                                                                                  |
| SMSG_CAST_FAILED                | 0x0130 | S→C  | see §1.6                                                                                                                                                                                 |
| SMSG_SPELL_START                | 0x0131 | S→C  | see §1.5                                                                                                                                                                                 |
| SMSG_SPELL_GO                   | 0x0132 | S→C  | see §1.5                                                                                                                                                                                 |
| SMSG_SPELL_FAILURE              | 0x0133 | S→C  | PackedGuid caster; u8 cast_count; u32 spell; u8 result (AC layout, §5)                                                                                                                   |
| SMSG_SPELL_COOLDOWN             | 0x0134 | S→C  | Guid; u8 flags; {u32 spell; u32 ms}[to end]                                                                                                                                              |
| SMSG_COOLDOWN_EVENT             | 0x0135 | S→C  | Spell id; Guid caster                                                                                                                                                                    |
| CMSG_CANCEL_AURA                | 0x0136 | C→S  | u32 spell                                                                                                                                                                                |
| CMSG_CANCEL_CHANNELLING         | 0x013B | C→S  | u32 spell                                                                                                                                                                                |
| SMSG_CLEAR_COOLDOWN             | 0x01DE | S→C  | Spell id; Guid target                                                                                                                                                                    |
| SMSG_SPELL_DELAYED              | 0x01E2 | S→C  | PackedGuid caster; u32 delay_ms                                                                                                                                                          |
| CMSG_CANCEL_AUTO_REPEAT_SPELL   | 0x026D | C→S  | empty                                                                                                                                                                                    |
| SMSG_SPELL_FAILED_OTHER         | 0x02A6 | S→C  | PackedGuid caster; u8 cast_count; u32 spell; u8 result (AC layout, §5)                                                                                                                   |
| SMSG_INITIAL_SPELLS             | 0x012A | S→C  | see §1.7                                                                                                                                                                                 |
| SMSG_LEARNED_SPELL              | 0x012B | S→C  | u32 spell; u16 0                                                                                                                                                                         |
| SMSG_SUPERCEDED_SPELL           | 0x012C | S→C  | u32 old_spell; u32 new_spell                                                                                                                                                             |
| SMSG_REMOVED_SPELL              | 0x0203 | S→C  | u32 spell                                                                                                                                                                                |
| SMSG_AURA_UPDATE_ALL            | 0x0495 | S→C  | PackedGuid unit; AuraUpdate[to end] (§1.8)                                                                                                                                               |
| SMSG_AURA_UPDATE                | 0x0496 | S→C  | PackedGuid unit; AuraUpdate (§1.8)                                                                                                                                                       |
| SMSG_SPELLHEALLOG               | 0x0150 | S→C  | PackedGuid target; PackedGuid caster; u32 spell; u32 amount; u32 overheal; u32 absorbed; u8 crit                                                                                         |
| SMSG_SPELLENERGIZELOG           | 0x0151 | S→C  | PackedGuid target; PackedGuid caster; u32 spell; u32 power_type; u32 amount                                                                                                              |
| SMSG_PERIODICAURALOG            | 0x024E | S→C  | PackedGuid target; PackedGuid caster; u32 spell; u32 count; per-tick aura-type-keyed block                                                                                               |
| SMSG_SPELLNONMELEEDAMAGELOG     | 0x0250 | S→C  | PackedGuid target; PackedGuid caster; u32 spell; u32 damage; u32 overkill; u8 school_mask; u32 absorbed; u32 resisted; u8 periodic; u8 unused; u32 blocked; u32 hit_info; u8 extend_flag |
| CMSG_LOOT                       | 0x015D | C→S  | Guid corpse                                                                                                                                                                              |
| CMSG_LOOT_MONEY                 | 0x015E | C→S  | empty                                                                                                                                                                                    |
| CMSG_LOOT_RELEASE               | 0x015F | C→S  | Guid corpse                                                                                                                                                                              |
| SMSG_LOOT_RESPONSE              | 0x0160 | S→C  | see §1.9                                                                                                                                                                                 |
| SMSG_LOOT_RELEASE_RESPONSE      | 0x0161 | S→C  | Guid; u8 1                                                                                                                                                                               |
| SMSG_LOOT_REMOVED               | 0x0162 | S→C  | u8 slot                                                                                                                                                                                  |
| SMSG_LOOT_MONEY_NOTIFY          | 0x0163 | S→C  | u32 copper; Bool alone                                                                                                                                                                   |
| SMSG_LOOT_CLEAR_MONEY           | 0x0165 | S→C  | empty                                                                                                                                                                                    |
| CMSG_AUTOSTORE_LOOT_ITEM        | 0x0108 | C→S  | u8 loot_slot                                                                                                                                                                             |
| SMSG_ITEM_PUSH_RESULT           | 0x0166 | S→C  | see §1.10                                                                                                                                                                                |
| SMSG_INVENTORY_CHANGE_FAILURE   | 0x0112 | S→C  | u8 result; [Guid item1; Guid item2; u8 bag_type_subclass; extras keyed on result]                                                                                                        |
| CMSG_ITEM_QUERY_SINGLE          | 0x0056 | C→S  | u32 entry                                                                                                                                                                                |
| SMSG_ITEM_QUERY_SINGLE_RESPONSE | 0x0058 | S→C  | see §1.11                                                                                                                                                                                |
| CMSG_REPOP_REQUEST              | 0x015A | C→S  | u8 0 (AC reads one byte, §5)                                                                                                                                                             |
| SMSG_RESURRECT_REQUEST          | 0x015B | S→C  | see §1.12                                                                                                                                                                                |
| CMSG_RESURRECT_RESPONSE         | 0x015C | C→S  | Guid resurrector; u8 status (0 decline, 1 accept)                                                                                                                                        |
| CMSG_RECLAIM_CORPSE             | 0x01D2 | C→S  | Guid corpse                                                                                                                                                                              |
| MSG_CORPSE_QUERY                | 0x0216 | both | C→S empty; S→C u8 found; [i32 map; f32 x,y,z; i32 corpse_map]                                                                                                                            |
| CMSG_SPIRIT_HEALER_ACTIVATE     | 0x021C | C→S  | Guid spirit_healer                                                                                                                                                                       |
| SMSG_SPIRIT_HEALER_CONFIRM      | 0x0222 | S→C  | Guid spirit_healer                                                                                                                                                                       |
| SMSG_CORPSE_RECLAIM_DELAY       | 0x0269 | S→C  | u32 delay_ms (AC sends milliseconds, §5)                                                                                                                                                 |
| SMSG_DEATH_RELEASE_LOC          | 0x0378 | S→C  | u32 map; f32 x, y, z                                                                                                                                                                     |
| SMSG_PRE_RESURRECT              | 0x0494 | S→C  | PackedGuid player                                                                                                                                                                        |
| SMSG_DURABILITY_DAMAGE_DEATH    | 0x02BD | S→C  | empty (3.3.5: u32 percent on some cores; treat body as optional)                                                                                                                         |
| SMSG_LOG_XPGAIN                 | 0x01D0 | S→C  | see §1.13                                                                                                                                                                                |
| SMSG_LEVELUP_INFO               | 0x01D4 | S→C  | see §1.13                                                                                                                                                                                |
| SMSG_PARTYKILLLOG               | 0x01F5 | S→C  | Guid killer; Guid victim                                                                                                                                                                 |
| SMSG_HEALTH_UPDATE              | 0x047F | S→C  | PackedGuid unit; u32 health                                                                                                                                                              |
| SMSG_POWER_UPDATE               | 0x0480 | S→C  | PackedGuid unit; u8 power_type; u32 amount                                                                                                                                               |
| CMSG_STANDSTATECHANGE           | 0x0101 | C→S  | u32 stand_state (0 stand, 1 sit)                                                                                                                                                         |
| SMSG_STANDSTATE_UPDATE          | 0x029D | S→C  | u8 stand_state                                                                                                                                                                           |
| CMSG_SET_SHEATHED               | 0x01E0 | C→S  | u32 sheathed                                                                                                                                                                             |
| CMSG_GAMEOBJ_USE                | 0x00B1 | C→S  | Guid gameobject                                                                                                                                                                          |
| CMSG_GAMEOBJ_REPORT_USE         | 0x0481 | C→S  | Guid gameobject                                                                                                                                                                          |

### 1.2 Targeting / melee

- **CMSG_SET_SELECTION 0x13D** — `{ Guid target }`. Target 0 clears selection.
  Test vector: size 0x000C, opcode `3D 01 00 00`, then 8-byte guid. Also
  retargets a running wand/autoshoot rotation (AC `MiscHandler.cpp:534`,
  retarget at `:541+`). **Always set selection before ATTACKSWING or CAST.**
- **CMSG_ATTACKSWING 0x141** — `{ Guid target }` (raw 8-byte guid). Server
  replies SMSG_ATTACKSTART on success, SMSG_ATTACKSTOP on invalid target.
- **CMSG_ATTACKSTOP 0x142** — empty body.
- **SMSG_ATTACKSTART 0x143** — `{ Guid attacker; Guid victim }` (16 bytes, full guids).
- **SMSG_ATTACKSTOP 0x144** — `{ PackedGuid attacker; PackedGuid victim; u32 dead }`.
  `dead` is 0 or 1 (1 = victim died). Test vector: `01 17` = packed guid 23,
  `01 64` = packed guid 100, then 4 bytes.
- **Swing errors 0x145/0x146/0x148/0x149** — all empty bodies. Sent **once per
  error streak** (server dedupes via `m_swingErrorMsg`); server keeps retrying
  the swing every 100 ms, so on receipt fix position/facing — do NOT resend
  ATTACKSWING. (0x0147 NOTSTANDING is vanilla/TBC-only, not sent on 3.3.5.)

### 1.3 SMSG_ATTACKERSTATEUPDATE 0x014A (3.3.5 layout)

```
u32 hit_info;                 // HitInfo flags
PackedGuid attacker;
PackedGuid target;
u32 total_damage;
u32 overkill;
u8  amount_of_damages;
DamageInfo[amount_of_damages];        // { u32 school_mask; f32 damage_f; u32 damage_u }
if (hit_info & 0x60  /* ALL_ABSORB */)  u32 absorb;
if (hit_info & 0x180 /* ALL_RESIST */)  u32 resist;
u8  victim_state;             // VictimState
u32 unknown1;                 // 0, 1000 or -1
u32 unknown2;
if (hit_info & 0x2000  /* BLOCK */)   u32 blocked_amount;
if (hit_info & 0x80000 /* UNK19 */)   u32 unknown3;
if (hit_info & 0x1     /* UNK1  */)   { u32; f32 x10; u32; }   // 48-byte debug block
```

DamageInfo sends the same value in both damage fields. School mask: 1 physical,
2 holy, 4 fire, 8 nature, 16 frost, 32 shadow, 64 arcane.

**HitInfo (u32):** NORMALSWING=0x0, UNK1=0x1 (adds debug block),
AFFECTS_VICTIM=0x2, OFFHAND=0x4, UNK2=0x8, MISS=0x10, FULL_ABSORB=0x20,
PARTIAL_ABSORB=0x40, ALL_ABSORB=0x60, FULL_RESIST=0x80, PARTIAL_RESIST=0x100,
ALL_RESIST=0x180, CRITICALHIT=0x200, UNK10=0x400, UNK11=0x800, UNK12=0x1000,
BLOCK=0x2000, UNK14=0x4000, UNK15=0x8000, GLANCING=0x10000, CRUSHING=0x20000,
NO_ANIMATION=0x40000, UNK19=0x80000, UNK20=0x100000, SWINGNOHITSOUND=0x200000,
UNK22=0x400000, RAGE_GAIN=0x800000, FAKE_DAMAGE=0x1000000.

**VictimState (u8):** 0 INTACT (attacker missed), 1 HIT (clean or blocked
hit), 2 DODGE, 3 PARRY, 4 INTERRUPT, 5 BLOCKS (unused — real blocks come as
HIT + BLOCK flag), 6 EVADES, 7 IS_IMMUNE, 8 DEFLECTS.

### 1.4 CMSG_CAST_SPELL 0x012E + SpellCastTargets

```
u8  cast_count;               // echo counter, 0 is fine; echoed in START/GO/CAST_FAILED
u32 spell_id;
u8  cast_flags;               // 0 = NONE, 2 = EXTRA (trajectory/movement data — never needed here)
SpellCastTargets targets;
```

Note the flags byte position: AC handler reads `castCount, spellId, castFlags`
then targets (`Handlers/SpellHandler.cpp:384`).

**SpellCastTargetFlags (u32):** SELF=0x0, UNIT=0x2 (pguid), UNIT_RAID=0x4,
UNIT_PARTY=0x8, ITEM=0x10 (pguid), SOURCE_LOCATION=0x20, DEST_LOCATION=0x40,
UNIT_ENEMY=0x80, UNIT_ALLY=0x100, CORPSE_ENEMY=0x200 (pguid), UNIT_DEAD=0x400,
GAMEOBJECT=0x800 (pguid), TRADE_ITEM=0x1000 (pguid), STRING=0x2000,
LOCKED=0x4000, CORPSE_ALLY=0x8000 (pguid), UNIT_MINIPET=0x10000 (pguid),
GLYPH_SLOT=0x20000, DEST_TARGET=0x40000, UNIT_PASSENGER=0x100000.

**SpellCastTargets wire (AC `Spells/Spell.cpp:126-200`, Read and Write):**

```
u32 target_flags;
if (flags & (UNIT|UNIT_MINIPET|GAMEOBJECT|CORPSE_ENEMY|CORPSE_ALLY))  PackedGuid object_target;
if (flags & (ITEM|TRADE_ITEM))                                       PackedGuid item_target;
if (flags & SOURCE_LOCATION)  { PackedGuid transport; f32 x; f32 y; f32 z; }
if (flags & DEST_LOCATION)    { PackedGuid transport; f32 x; f32 y; f32 z; }
if (flags & STRING)           CString target_string;
```

The PackedGuid transport before each xyz is an AC-ism wow_messages omits (§5.1)
— send `00` for no transport. Flags UNIT_ENEMY/UNIT_ALLY/UNIT_RAID/UNIT_PARTY/
UNIT_DEAD/LOCKED/GLYPH_SLOT/DEST_TARGET/UNIT_PASSENGER carry **no payload** on
AC's read path.

Practical encodings:

- Self-cast (Renew, PW:S, Fortitude on self, Lesser Heal on self): `flags = 0` (SELF), nothing else.
- Hostile single target (Smite, SW:P, Mind Blast, Shoot): `flags = 0x2` (UNIT) + PackedGuid of the mob. **UNIT, not UNIT_ENEMY** — attackable targets still use UNIT in CMSG.
- Cancel: **CMSG_CANCEL_CAST 0x12F** = `{ u8 cast_count(0); u32 spell }` (AC reads counter then spell). **CMSG_CANCEL_AUTO_REPEAT_SPELL 0x26D** = empty.

### 1.5 SMSG_SPELL_START 0x0131 / SMSG_SPELL_GO 0x0132

**SPELL_START:**

```
PackedGuid cast_item;         // == caster guid when no item
PackedGuid caster;
u8  cast_count;
u32 spell_id;
u32 cast_flags;               // CastFlags
u32 timer;                    // cast time in ms
SpellCastTargets targets;     // same encoding as §1.4
if (flags & 0x800    /* POWER_LEFT_SELF */)  u32 power;
if (flags & 0x20     /* AMMO */)             { u32 ammo_display_id; u32 ammo_inventory_type; }
if (flags & 0x400000 /* UNKNOWN_23 */)       { u32; u32; }
```

CastFlags (u32): NONE=0x0, PENDING=0x1, HAS_TRAJECTORY=0x2, AMMO=0x20,
POWER_LEFT_SELF=0x800, ADJUST_MISSILE=0x20000, NO_GCD=0x40000,
VISUAL_CHAIN=0x80000, RUNE_LIST=0x200000, UNKNOWN_23=0x400000,
IMMUNITY=0x4000000.

**SPELL_GO:**

```
PackedGuid cast_item;
PackedGuid caster;
u8  cast_count;
u32 spell_id;
u32 flags;                    // GameobjectCastFlags — different set from START
u32 timestamp;
u8  hit_count;    Guid[hit_count] hits;           // FULL 8-byte guids
u8  miss_count;   SpellMiss[miss_count] misses;
SpellCastTargets targets;
if (flags & 0x800    /* POWER_UPDATE */)   u32 power;
if (flags & 0x200000 /* RUNE_UPDATE */)    { u8 mask_before; u8 mask_after; u8[6] cooldowns; }
if (flags & 0x20000  /* ADJUST_MISSILE */) { f32 elevation; u32 delay; }
if (flags & 0x20     /* AMMO */)           { u32 ammo_display_id; u32 ammo_inventory_type; }
if (flags & 0x80000  /* VISUAL_CHAIN */)   { u32; u32; }
if (flags & 0x40     /* DEST_LOCATION */)  u8 unknown;
```

`SpellMiss = { Guid target; u8 miss_info; if (miss_info == 11 /*REFLECT*/) u8 reflect_result; }`
SpellMissInfo: 0 NONE, 1 MISS, 2 RESIST, 3 DODGE, 4 PARRY, 5 BLOCK, 6 EVADE,
7 IMMUNE, 8 IMMUNE2, 9 DEFLECT, 10 ABSORB, 11 REFLECT.

GameobjectCastFlags (u32): LOCK_PLAYER_CAST_ANIM=0x01, AMMO=0x20,
DEST_LOCATION=0x40, ITEM_CASTER=0x100, EXTRA_MESSAGE=0x400, POWER_UPDATE=0x800,
UNK8000=0x8000, ADJUST_MISSILE=0x20000, UNK40000=0x40000, VISUAL_CHAIN=0x80000,
RUNE_UPDATE=0x200000, UNK400000=0x400000.

Kill-confirmation heuristic: your SPELL_GO with the mob in `hits` +
UNIT_FIELD_HEALTH→0 update + SMSG_LOG_XPGAIN addressed to you.

### 1.6 SMSG_CAST_FAILED 0x0130 + SpellCastResult

```
u8  cast_count;
u32 spell_id;
u8  result;                   // SpellCastResult
u8  multiple_casts;           // Bool
// trailing extras keyed on result:
//   REQUIRES_SPELL_FOCUS(0x66) → u32 focus; REQUIRES_AREA(0x65) → u32 area;
//   TOTEMS → u32[2]; TOTEM_CATEGORY → u32[2];
//   EQUIPPED_ITEM_CLASS(/MAINHAND/OFFHAND) → u32 class + u32 subclass;
//   TOO_MANY_OF_ITEM → u32 limit_category; CUSTOM_ERROR(0xAC) → u32;
//   REAGENTS(0x64) → u32 missing_item; PREVENTED_BY_MECHANIC → u32 mechanic;
//   NEED_MORE_ITEMS → u32 item + u32 count; MIN_SKILL → u32 skill + u32 required;
//   NEED_EXOTIC_AMMO → u32; FISHING_TOO_LOW → u32
```

**SpellCastResult values the bot must map** (full enum 0x00–0xBB in wowm
`common.wowm:610-800`):

| Value     | Name                               | Bot reaction                  |
| --------- | ---------------------------------- | ----------------------------- |
| 0x00      | SUCCESS                            | —                             |
| 0x01      | AFFECTING_COMBAT                   | wait                          |
| 0x02/0x03 | ALREADY_AT_FULL_HEALTH / _MANA     | skip heal                     |
| 0x0B/0x0C | BAD_IMPLICIT_TARGETS / BAD_TARGETS | reselect target               |
| 0x17      | CASTER_DEAD                        | enter death flow              |
| 0x1B      | DONT_REPORT                        | ignore                        |
| 0x20      | ERROR                              | log                           |
| 0x28/0x29 | INTERRUPTED / INTERRUPTED_COMBAT   | recast                        |
| 0x2D      | ITEM_NOT_READY                     | wait                          |
| 0x2F      | LINE_OF_SIGHT                      | reposition                    |
| 0x33      | MOVING                             | stop, recast                  |
| 0x3F      | NOT_KNOWN                          | remove from rotation          |
| 0x43      | NOT_READY                          | cooldown/GCD — wait and retry |
| 0x45      | NOT_STANDING                       | send stand, recast            |
| 0x49      | NOT_WHILE_GHOST                    | reclaim corpse first          |
| 0x55      | NO_POWER                           | oom — wand only / drink       |
| 0x61      | OUT_OF_RANGE                       | move closer                   |
| 0x68      | SILENCED                           | wand only                     |
| 0x69      | SPELL_IN_PROGRESS                  | wait for current cast         |
| 0x6C      | STUNNED                            | wait                          |
| 0x6D      | TARGETS_DEAD                       | next target / loot            |
| 0x73      | TARGET_FRIENDLY                    | reselect                      |
| 0x80      | TOO_CLOSE                          | back up (wand min range)      |
| 0x84      | TRY_AGAIN                          | retry once                    |
| 0x86      | UNIT_NOT_INFRONT                   | face target, recast           |
| 0xAC      | CUSTOM_ERROR                       | log u32 extra                 |
| 0xBB      | UNKNOWN                            | log                           |

Others seen in wowm: FIZZLE=0x21, FLEEING=0x22, LOWLEVEL=0x30, NOT_BEHIND=0x39,
NOT_HERE=0x3C, NOT_INFRONT=0x3D, NO_COMBO_POINTS=0x4E, NOTHING_TO_DISPEL=0x56,
PACIFIED=0x62, REAGENTS=0x64, REQUIRES_AREA=0x65, REQUIRES_SPELL_FOCUS=0x66,
ROOTED=0x67, TARGET_AURASTATE=0x6F, TARGET_NOT_DEAD=0x77.

### 1.7 Cooldowns + SMSG_INITIAL_SPELLS 0x012A

- **SMSG_SPELL_COOLDOWN 0x134** — `{ Guid unit; u8 flags; { u32 spell; u32 cooldown_ms }[repeat to end of packet] }`.
  Flags (AC `Unit.h:630`): 0x0 NONE, 0x1 INCLUDE_GCD, 0x2 INCLUDE_EVENT_COOLDOWNS.
- **SMSG_COOLDOWN_EVENT 0x135** — `{ u32 spell; Guid caster }` (spell first). Cooldown starts now.
- **SMSG_CLEAR_COOLDOWN 0x1DE** — `{ u32 spell; Guid target }`.

**SMSG_INITIAL_SPELLS (AC `Player.cpp:2748` SendInitialSpells — use this, not wowm, §5.3):**

```
u8  unknown;                  // 0
u16 spell_count;
{ u32 spell_id; u16 zero }[spell_count]           // 6 bytes each
u16 cooldown_count;
{ u32 spell_id; u16 item_id; u16 category;        // 16 bytes each (AC uses u32 spell id)
  u32 cooldown_ms; u32 category_cooldown_ms }[cooldown_count]
```

If `category != 0` the remaining time is in category_cooldown and cooldown=0,
else vice versa. Infinite cooldown = cooldown 1 + category_cooldown 0x80000000.
Parse this to seed the bot's spellbook (which ranks are actually trained — see §4).

### 1.8 Auras

- **SMSG_AURA_UPDATE 0x496** — `{ PackedGuid unit; AuraUpdate }` (one entry).
- **SMSG_AURA_UPDATE_ALL 0x495** — `{ PackedGuid unit; AuraUpdate[repeat to end] }`.

```
struct AuraUpdate {
    u8  visual_slot;
    u32 spell_id;             // 0 = aura removed from this slot (packet ends here)
    u8  flags;                // AuraFlag
    u8  caster_level;
    u8  stack_count;          // stacks or charges
    if (flags & 0x08 /* NOT_CASTER */)  PackedGuid caster;
    if (flags & 0x20 /* DURATION */)    { u32 duration_ms; u32 time_left_ms; }
}
```

AuraFlag: EFFECT_1=0x1, EFFECT_2=0x2, EFFECT_3=0x4, NOT_CASTER=0x8, SET=0x9,
CANCELLABLE=0x10, DURATION=0x20, HIDE=0x40 (treat as removed), NEGATIVE=0x80.

Track on self and current target by (unit, slot) → (spell, time_left). Needed
for: SW:P uptime on target, Renew/PW:S on self, **Weakened Soul 6788** on self
(blocks re-shield for 15 s).

### 1.9 Loot family

Sequence: `CMSG_LOOT(guid)` → `SMSG_LOOT_RESPONSE` → per item
`CMSG_AUTOSTORE_LOOT_ITEM(slot)` → `SMSG_LOOT_REMOVED(slot)` +
`SMSG_ITEM_PUSH_RESULT` → `CMSG_LOOT_MONEY` (if gold > 0) →
`SMSG_LOOT_CLEAR_MONEY` + `SMSG_LOOT_MONEY_NOTIFY` → `CMSG_LOOT_RELEASE(guid)`
→ `SMSG_LOOT_RELEASE_RESPONSE`.

**SMSG_LOOT_RESPONSE 0x160 (3.3.5 layout from AC `Loot/LootMgr.cpp:963-1075`; wowm only models vanilla — §5.5):**

```
Guid lootee;
u8  loot_type;                // 0 ERROR, 1 CORPSE, 2 PICKPOCKETING, 3 FISHING, 4 DISENCHANTING
                              // (SKINNING sent as 2, FISHINGHOLE/FISHING_FAIL as 3, INSIGNIA as 1)
if (loot_type == 0)  u8 loot_error;
u32 gold_copper;
u8  item_count;
per item (22 bytes):
    u8  index;                // slot for CMSG_AUTOSTORE_LOOT_ITEM
    u32 item_id;
    u32 count;
    u32 display_info_id;
    u32 random_suffix;
    u32 random_property_id;
    u8  slot_type;            // 0 ALLOW_LOOT, 1 ROLL_ONGOING, 2 MASTER, 3 LOCKED, 4 OWNER
```

Only auto-store slots with slot_type 0 (or 4). LootMethodError (u8):
0 DIDNT_KILL, 4 TOO_FAR, 5 BAD_FACING, 6 LOCKED, 8 NOTSTANDING, 9 STUNNED,
10 PLAYER_NOT_FOUND, 11 PLAY_TIME_EXCEEDED, 12 MASTER_INV_FULL,
13 MASTER_UNIQUE_ITEM, 14 MASTER_OTHER, 15 ALREADY_PICKPOCKETED,
16 NOT_WHILE_SHAPESHIFTED.

Other loot SMSGs: **LOOT_MONEY_NOTIFY 0x163** `{ u32 copper; Bool alone }`
(alone=1 → "You loot…", 0 → "Your share is…"); **LOOT_RELEASE_RESPONSE 0x161**
`{ Guid; u8 always_1 }`; **LOOT_REMOVED 0x162** `{ u8 slot }`.

### 1.10 SMSG_ITEM_PUSH_RESULT 0x0166 (45 bytes)

```
Guid player;                  // receiver
u32 source;                   // 0 looted, 1 from NPC
u32 creation_type;            // 0 received, 1 created
u32 alert_chat;               // 0 don't show, 1 show
u8  bag_slot;                 // 0xFF when stacked/equipped
u32 item_slot;                // 0xFFFFFFFF when added to existing stack
u32 item_entry;
u32 suffix_factor;
u32 random_property_id;
u32 count;                    // in this push
u32 count_in_inventory;       // total held after push
```

### 1.11 Item name query

- **CMSG_ITEM_QUERY_SINGLE 0x056** — `{ u32 entry }` (3.3.5 dropped vanilla's trailing guid).
- **SMSG_ITEM_QUERY_SINGLE_RESPONSE 0x058** — if unknown: 4 bytes only,
  `entry | 0x80000000`. If found: `u32 entry` then the full template. Prefix
  needed for name/quality:

```
u32 class; u32 sub_class;
u32 sound_override_sub_class;    // usually 0xFFFFFFFF
CString name1;                   // the item name
CString name2; CString name3; CString name4;   // usually "\0"
u32 display_id;
u32 quality;                     // 0 poor .. 7 heirloom
u32 flags; u32 flags2;
u32 buy_price; u32 sell_price;
u32 inventory_type; u32 allowed_class; u32 allowed_race;
u32 item_level; u32 required_level;
... (long fixed tail, ~530+ bytes typical)
```

Tail order (only if full parse is wanted): required_skill,
required_skill_rank, required_spell, required_honor_rank, required_city_rank,
required_faction, required_faction_rank, max_count, stackable, container_slots,
`u32 stat_count` + `{u32 type; i32 value}[stat_count]`, scaling_stats_entry,
scaling_stats_flag, `{f32 min; f32 max; u32 school}[2]` damages, armor,
i32 resist ×6 (holy/fire/nature/frost/shadow/arcane), delay, ammo_type,
f32 ranged_range_mod, 5× `{u32 spell; u32 trigger; i32 charges; i32 cooldown;
u32 category; i32 category_cooldown}`, bonding, CString description, page_text,
language, page_text_material, start_quest, lock_id, material, sheathe_type,
random_property, random_suffix, block, item_set, max_durability, area, map,
bag_family, totem_category, 3× `{u32 color; u32 content}` sockets,
socket_bonus, gem_properties, required_disenchant_skill,
f32 armor_damage_modifier, duration, item_limit_category, holiday_id.

**Recommended:** parse class/subclass, skip 1 u32, read name1, skip 3 CStrings,
read display_id + quality, discard the rest of the packet (it is delimited only
by packet size). Cache by entry, mirroring the existing name-query pattern.

### 1.12 Death family

- **CMSG_REPOP_REQUEST 0x15A** — `{ u8 0 }`. AC `HandleRepopRequestOpcode`
  reads one byte (wowm says empty — §5.6).
- **SMSG_DEATH_RELEASE_LOC 0x378** — `{ u32 map; f32 x; f32 y; f32 z }` — ghost
  spawn (spirit healer) location. Also sent with -1/cleared values after resurrect.
- **MSG_CORPSE_QUERY 0x216** — request empty; response `u8 found;` then if
  found `{ i32 map; f32 x; f32 y; f32 z; i32 corpse_map }` — use to navigate
  the ghost back to the corpse.
- **CMSG_RECLAIM_CORPSE 0x1D2** — `{ Guid corpse }`.
- **SMSG_CORPSE_RECLAIM_DELAY 0x269** — `{ u32 delay }` in **milliseconds**
  against AC (wowm says seconds — §5.7).
- **SMSG_RESURRECT_REQUEST 0x15B** — AC wire (`Spell.cpp:5208`):
  `Guid caster; u32 name_len_including_nul; char[] name; u8 nul;
u8 sickness_flag (0 = player resurrector, 1 = creature/spirit healer);
[u32 0 present only for instant-res spells]`.
- **CMSG_RESURRECT_RESPONSE 0x15C** — `{ Guid resurrector; u8 status }` (0 decline, 1 accept).
- **CMSG_SPIRIT_HEALER_ACTIVATE 0x21C** — `{ Guid spirit_healer }`;
  **SMSG_SPIRIT_HEALER_CONFIRM 0x222** — `{ Guid spirit_healer }`.

### 1.13 XP / level

**SMSG_LOG_XPGAIN 0x1D0 (AC `Player.cpp:2337-2354`; wowm's condition is inverted — §5.4):**

```
Guid victim;                  // 0 for non-kill XP
u32 total_exp;                // raw + bonus (incl. rested)
u8  exp_type;                 // 0 = kill, 1 = non-kill (quest/explore)
if (exp_type == 0)  { u32 exp_without_rested; f32 group_bonus /* AC sends 1.0f */; }
u8  raf_bonus;                // recruit-a-friend flag
```

**SMSG_LEVELUP_INFO 0x1D4** (56 bytes) — all values after new_level are
**deltas** gained at this level:

```
u32 new_level; u32 health;
u32 mana; u32 rage; u32 focus; u32 energy; u32 happiness; u32 rune; u32 runic_power;
u32 strength; u32 agility; u32 stamina; u32 intellect; u32 spirit;
```

---

## 2. Server rules (AzerothCore, playerbots fork)

Paths relative to `src/server/game/`.

### 2.1 Cast validation order

Handler (`Handlers/SpellHandler.cpp:376` HandleCastSpellOpcode):

1. Read castCount/spellId/castFlags (`:384`); mover check (`:392`).
2. Unknown spell id → silently dropped (`:400-407`).
3. **Spell queue** (this fork has retail-style queueing): a cast sent during
   GCD/short cooldown is **queued**, not rejected, if remaining time ≤ queue
   window (`CONFIG_SPELL_QUEUE_WINDOW`, default 400 ms) —
   `Player::CanExecutePendingSpellCastRequest` (PlayerUpdates.cpp:2309),
   `CanRequestSpellCast` (:2335), replay in `ProcessSpellQueue` (:2374).
   Outside the window it falls through to CheckCast and fails NOT_READY (0x43).
4. `targets.Read` (`:441`; `Spell.cpp:126`) — for hostile single-target,
   `TARGET_FLAG_UNIT (0x2)` + PackedGuid is exactly right and sufficient.
5. Spell must be known and non-passive (`HasActiveSpell`, `:449`) → else silently dropped.
6. `spell->prepare(&targets)` (`:544-549`).

`Spell::CheckCast` order (`Spells/Spell.cpp:5630`): caster alive (`:5633`);
spell + category cooldown → NOT_READY (`:5658-5667`); **GCD → NOT_READY**
(`:5680-5681`); indoor/outdoor (`:5691-5699`); moving pre-check for auto-repeat
spells → MOVING (`:5788-5794`); explicit-target check (`:5856`); CheckTarget
(`:5865`); **LoS** (`:5901`, vmap-based `IsWithinLOSInMap`, M2 flags,
LINEOFSIGHT_ALL_CHECKS → SPELL_FAILED_LINE_OF_SIGHT — **server-side, cannot be
faked**); `CheckRange(strict)` (`:6013`); CheckPower; CheckItems.

**Range** (`Spell::CheckRange`, `Spell.cpp:7050`): instant spells skip the
check when strict=false (`:7053`). Melee spells get −4 yd tolerance (−2 when
both moving, `:7089-7097`). Non-melee non-strict re-check adds +10% up to
+3 yd (`:7080-7081`). Ranged (wand) min range = spell min + melee range →
TOO_CLOSE (`:7108-7113`) — **don't wand from inside ~5 yd... actually wand min
range applies; back up if TOO_CLOSE arrives.**

**Facing** — checked inside CheckRange (`:7102-7103`): player caster with
`SPELL_FACING_FLAG_INFRONT` needs `HasInArc(π, target)` — **180° arc** for
spells. **The server never auto-faces a player** (`Spell::prepare` only calls
FocusTarget for creatures, `:3647-3656`). Set orientation via a movement
heartbeat (MSG_MOVE_SET_FACING or any MSG_MOVE with correct `o`) before
casting. The movement engine's `face()` covers this.

**Movement interrupts** (`Spell::prepare` `:3537-3545`, `Spell::update`
`:4383-4392`): starting or continuing a cast with
`SPELL_INTERRUPT_FLAG_MOVEMENT (0x1)` while `isMoving()` fails/cancels with
SPELL_FAILED_MOVING. isMoving is driven by the movement flags in your own
MSG_MOVE packets. Instants (timer 0), melee, triggered, and the auto-repeat
slot are exempt. Rule: **stop before hard-casting Smite/Mind Blast/Lesser
Heal; instants and wand are safe.**

**GCD** (`TriggerGlobalCooldown`, `Spell.cpp:8898`): StartRecoveryTime clamped
1000–1500 ms; haste applies to spells. Enforced at CheckCast `:5680`. Bot rule:
keep a local 1.5 s GCD timer, or lean on the 400 ms queue window.

Feedback: failure → SMSG_CAST_FAILED (only to the caster); success →
SMSG_SPELL_START then SMSG_SPELL_GO (instants may emit GO only... AC still
sends START with timer 0 — observe live; treat GO as the authoritative
"cast happened").

### 2.2 Auto-attack swings

- CMSG_ATTACKSWING (`Handlers/CombatHandler.cpp:28`): missing target →
  SendAttackStop(nullptr) (`:36-42`); `!IsValidAttackTarget` → SendAttackStop
  (`:44-49`); else `Attack(pEnemy, true)` (`:66`). SendAttackStop wire =
  packed attacker + packed victim + u32 isDead (`:85-97`).
- `Unit::Attack` (`Entities/Unit/Unit.cpp:7313`): sets UNIT_STATE_MELEE_ATTACKING,
  SetTarget, sends SMSG_ATTACKSTART. **Does not face you.**
- Swing loop in `Player::Update` (`Entities/Player/PlayerUpdates.cpp:159-225`),
  runs while not casting; when `isAttackReady`:
  - out of melee range → retry every 100 ms, SMSG_ATTACKSWING_NOTINRANGE sent
    **once** per streak (`:168-177`);
  - facing needs `HasInArc(2π/3)` — **120° arc for melee** — else
    SMSG_ATTACKSWING_BADFACING once (`:179-187`);
  - else `AttackerStateUpdate` (`Unit.cpp:2763`) → SMSG_ATTACKERSTATEUPDATE, timer reset.
- Melee range = `attacker reach + target reach + 4/3`, min 5.0 yd
  (NOMINAL_MELEE_RANGE), + leeway when both moving (`Unit.cpp:783-805`;
  constants `Entities/Object/ObjectDefines.h:46-47`: MIN_MELEE_REACH 2.0).

### 2.3 Wand auto-repeat (Shoot 5019)

Auto-repeat spells go to the CURRENT_AUTOREPEAT_SPELL slot
(`Spell::GetCurrentContainer`, `Spell.cpp:7954-7955`). Client casts **once**
(CMSG_CAST_SPELL 5019, UNIT flags + pguid); the server refires in
`Unit::_UpdateAutoRepeatSpell` (`Unit.cpp:4081`):

- First wand shot delayed ≥500 ms (`m_AutoRepeatFirstCast`, `:4106-4110`).
- Every ranged-timer tick re-runs CheckCast(true) — range/LoS/facing; failure
  stops the rotation (`:4115-4126`). Success → triggered shot, timer reset to
  weapon speed (`:4128-4138`).
- **Moving cancels wand** (`isMoving()` check `:4097-4104`; hunter Auto Shot 75
  exempt). Starting any generic/channeled cast cancels/pauses it
  (`SetCurrentCastedSpell`, `:4187-4192`, `:4217-4219`).
- The real client re-sends CMSG_CAST_SPELL(5019) after casting another spell;
  the handler dedupes a redundant re-send (`SpellHandler.cpp:512-518`).
  **Bot must mimic: re-issue 5019 after every hard cast.**
- Stop: CMSG_CANCEL_AUTO_REPEAT_SPELL (`SpellHandler.cpp:644`). Retarget:
  just CMSG_SET_SELECTION (`MiscHandler.cpp:534`).

### 2.4 Loot rights, distance, sequence

- CMSG_LOOT (`Handlers/LootHandler.cpp:238`): requires IsAlive + creature guid
  (`:245-247`); interrupts your current cast (`:250-251`); →
  `Player::SendLoot(guid, LOOT_CORPSE)` (`Player.cpp:7831`).
- SendLoot checks: dead creature + **`IsWithinDistInMap(INTERACTION_DISTANCE = 5.5f)`**
  (`ObjectDefines.h:24`; error path `Player.cpp:8082-8091` →
  LOOT_ERROR_TOO_FAR / DIDNT_KILL); corpse must carry **UNIT_DYNFLAG_LOOTABLE**
  (`:8088-8091`); tap rights via GetLootRecipient — solo, recipient==you →
  ALL_PERMISSION. Success sets your UNIT_FLAG_LOOTING and sends LOOT_RESPONSE
  (`:8203-8219`).
- **Tap** = first player damage (`Creature::SetLootRecipient`,
  `Creature.cpp:1307`). Per-viewer dynamic-flag rewrite
  (`Unit.cpp:17012-17028`): you see UNIT_DYNFLAG_LOOTABLE (0x0001) **iff you
  may loot**; TAPPED (0x4) shows someone tapped it, TAPPED_BY_PLAYER (0x8) you
  did. Client rule: **corpse lootable for you ⇔ dynamicFlags & 0x1**.
- Per-item CMSG_AUTOSTORE_LOOT_ITEM re-checks 5.5 yd (`LootHandler.cpp:87-90`);
  success → SMSG_LOOT_REMOVED + SMSG_ITEM_PUSH_RESULT; full bags →
  SMSG_INVENTORY_CHANGE_FAILURE and the item stays.
- CMSG_LOOT_MONEY re-checks distance (`:164-167`) → SMSG_LOOT_CLEAR_MONEY +
  SMSG_LOOT_MONEY_NOTIFY.
- CMSG_LOOT_RELEASE → `DoLootRelease` (`:270`): RELEASE_RESPONSE, clears
  UNIT_FLAG_LOOTING; fully looted → LOOTABLE flag removed (`:390-397`);
  **partial loot keeps the corpse flagged** and re-openable (`:410`).
- **XP is granted at kill time, not loot time**: `Unit::Kill` →
  `RewardPlayerAndGroupAtKill` (`Player.cpp:12847`) → `KillRewarder::_RewardXP`
  (`KillRewarder.cpp:149`) → `GiveXP` (`Player.cpp:2356`), which requires the
  creature `hasLootRecipient()` (you tapped it, `:2373`). `Unit::Kill` sets
  LOOTABLE right after death when loot is non-empty (`Unit.cpp:14232-14244`).
- Kill-credited signal pair: target UNIT_FIELD_HEALTH → 0 **and**
  SMSG_LOG_XPGAIN arrives. Also SMSG_ATTACKSTOP with dead=1 and
  dynamicFlags gaining 0x1.

### 2.5 Death → alive state machine

```
ALIVE ──death──> DEAD_NOT_RELEASED ──CMSG_REPOP_REQUEST──> GHOST ──walk to corpse──>
  ──CMSG_RECLAIM_CORPSE (≤39yd, delay elapsed)──> ALIVE (50% hp/mana)
                                   └─CMSG_SPIRIT_HEALER_ACTIVATE─> ALIVE (50%, sickness 11+, 25% dura)
                                   └─SMSG_RESURRECT_REQUEST → CMSG_RESURRECT_RESPONSE(1)─> ALIVE
```

1. Death: server sets deathState; `Player::KillPlayer` (`Player.cpp:4475`)
   starts a **6-minute auto-release timer** (`:4491`) and sends
   SMSG_CORPSE_RECLAIM_DELAY.
2. Release (CMSG_REPOP_REQUEST, one pad byte — `MiscHandler.cpp:59-63`; must
   be dead + not already ghost `:65-66`): `BuildPlayerRepop` (`Player.cpp:4344`)
   — SMSG_PRE_RESURRECT, ghost aura 8326, corpse created at death spot,
   health 1, second SMSG_CORPSE_RECLAIM_DELAY (`:4382-4386`); then
   `RepopAtGraveyard` (`:4843`) **teleports you** to the closest graveyard
   (near: MSG_MOVE_TELEPORT_ACK to ack; far: SMSG_TRANSFER_PENDING/NEW_WORLD +
   MSG_MOVE_WORLDPORT_ACK — the existing teleport handling covers this), then
   SMSG_DEATH_RELEASE_LOC (`:4881-4889`).
3. Corpse run: record death position yourself; MSG_CORPSE_QUERY confirms.
   Send CMSG_RECLAIM_CORPSE at the corpse. Checks (`MiscHandler.cpp:633-666`):
   dead (`:638`), ghost (`:646`), corpse exists (`:649`), reclaim delay elapsed
   (`:653-655`), range **CORPSE_RECLAIM_RADIUS = 39 yd** (`Corpse.h:35`,
   check `:658`). Then `ResurrectPlayer(0.5f)` — **50% health/mana** — and
   corpse bones (`:661-666`).
4. Reclaim delay: `copseReclaimDelay[] = {30, 60, 120}` s (`Player.cpp:151`)
   indexed by recent-death count, **but PvE deaths use it only when
   `CONFIG_DEATH_CORPSE_RECLAIM_DELAY_PVE` is enabled — AC default OFF → 0 s**
   (`Player.cpp:13058-13060`). Always read the actual value from
   SMSG_CORPSE_RECLAIM_DELAY (ms, `:13109-13114`). Level is irrelevant;
   death frequency is what indexes the array.
5. Spirit healer: CMSG_SPIRIT_HEALER_ACTIVATE at the NPC
   (`NPCHandler.cpp:239`) → ResurrectPlayer(0.5f, sickness) + **25% durability
   damage** (`:262-268`). Res sickness (15007): **levels 1–10 none**; 11–19
   one minute per level over 10; 20+ full 10 min (`Player.cpp:4448-4470`).
   At level 10 the only spirit-healer cost is durability.
6. After ResurrectPlayer: SMSG_DEATH_RELEASE_LOC cleared, death flags cleared,
   alive at 50% (`Player.cpp:4394-4427`).

### 2.6 Regen

`Player::RegenerateAll` (`Player.cpp:1753`): health on 2 s ticks, mana continuous.

- **Health** (`:1978`): out-of-combat only; `OCTRegenHPPerSpirit × RATE_HEALTH`
  per 2 s; `CONFIG_LOW_LEVEL_REGEN_BOOST` (default on) multiplies by
  `2.066 − 0.066×level` under 15 (~1.4× at 10). **Sitting = ×1.33**
  (`:2001-2004`) — CMSG_STANDSTATECHANGE(1) helps by a third. Sitting does
  **not** affect mana.
- **Mana** (`:1836`): from UNIT_FIELD_POWER_REGEN_FLAT_MODIFIER outside the
  five-second rule, `…_INTERRUPTED_FLAT_MODIFIER` within 5 s of a
  mana-spending cast (`IsUnderLastManaUseEffect`, `Unit.cpp:13688-13691`).
  Low-level boost applies (`:1873-1874`).
- Food/drink are just sit-gated auras (`SPELL_AURA_MOD_POWER_REGEN`/`MOD_REGEN`
  with AURA_INTERRUPT_FLAG_NOT_SEATED, `Player.cpp:1817-1830`) — they break on
  stand/move.
- Verdict: a level-10 priest grinds indefinitely without consumables — wanding
  keeps her out of the FSR most of each fight (~50–70 mana recovered per
  kill); drink only shortens downtime.

### 2.7 Hostility determination

Server: `Unit::GetFactionReactionTo` (`Unit.cpp:7219`) reduces creature-vs-you
to FactionTemplate.dbc pair math (`:7261-7276`): hostile if enemy-group-mask/
enemy-faction overlap, friendly if either direction friendly, else neutral.
Row shape: `{id, faction, flags, factionGroupMask, friendGroupMask,
enemyGroupMask, enemyFactions[4], friendFactions[4]}`. Faction-group bits:
Player=1, Alliance=2, Horde=4.

Client heuristic for tuicraft:

1. From UNIT_FIELD_FACTIONTEMPLATE (already extracted), evaluate against a
   distilled faction table (ship a small map for the zones we grind, or the
   full dbc dump): hostile if our group bit ∈ enemyGroupMask or our template ∈
   enemyFactions; attackable-neutral if neither friend nor enemy.
2. Reject targets with any of these UNIT_FIELD_FLAGS bits (checked in
   `_IsValidAttackTarget`, `Unit.cpp:10812-10819`; values `Unit.h:258-282`):
   `0x2` NON_ATTACKABLE, `0x80` NOT_ATTACKABLE_1, `0x100` IMMUNE_TO_PC,
   `0x10000` NON_ATTACKABLE_2, `0x2000000` NOT_SELECTABLE. Reject dead targets
   (`:10798`).
3. **Trust the server as the final oracle**: send CMSG_ATTACKSWING and treat an
   immediate SMSG_ATTACKSTOP as "invalid target" (`CombatHandler.cpp:44-49`),
   or read the SMSG_CAST_FAILED result for spells.

### 2.8 In-combat state + aggro

- `UNIT_FLAG_IN_COMBAT = 0x00080000` (`Unit.h:276`), set/cleared for you by the
  server (`Combat/CombatManager.cpp:409-435`) — observe your own
  UNIT_FIELD_FLAGS updates; never send anything.
- PvE combat has **no timeout** — ends when the mob dies, evades (leash), or
  you die. (PvP: 5 s, `CombatManager.h:90`.)
- Aggro radius (`Creature::GetAttackDistance`, `Creature.cpp:3601`): base
  20 yd at equal level, ±1 yd per level of difference (mob higher = larger),
  floor 5, cap 45, × RATE_CREATURE_AGGRO; requires server LoS
  (`CanStartAttack`, `:1902-1936`) and a Z-distance limit (`:1921`). Level 10
  vs level 7 mob → ~17 yd. Nearby same-faction mobs assist on attack
  (`CallAssistance`, `Unit.cpp:7444-7446`; ~10 yd default assist radius).

---

## 3. tuicraft gaps

### 3.1 What exists

- **Opcodes** (`src/wow/protocol/opcodes.ts`): nearly everything is already
  defined — melee (0x141–0x14A, 0x14E), spells (0x12A–0x136, 0x1DE, 0x1E2,
  0x203, 0x495/0x496), combat log (0x150, 0x151, 0x24E, 0x250, 0x263, 0x2A6),
  loot (0x108, 0x15D–0x164, 0x29E–0x2A4), items (0x0AB, 0x056/0x058, 0x112,
  0x166), death (0x15A–0x15C, 0x1D2, 0x216, 0x21C, 0x269, 0x494), XP (0x1D0,
  0x1D4, 0x1F5, 0x1F8), misc (0x47F, 0x480, 0x29D, 0x101, 0x1E0).
- **Stubs** (`src/wow/protocol/stubs.ts`): spell area :299-351, combat
  :354-388, loot :391-413, item :416-432, death :706-716, XP :206-216,
  HEALTH/POWER_UPDATE :668-679. `registerStubs` skips any opcode already in
  dispatch (`:742`) — registering a real handler in client.ts before the
  `registerStubs` call (client.ts:624-632) supersedes the stub automatically;
  deleting the stub entry is optional but keeps stubs.test.ts honest.
- **Entity store** (`src/wow/entity-store.ts`): `UnitEntity` (:21-36) has
  health, maxHealth, level, factionTemplate, unitFlags, target (bigint),
  power[]/maxPower[], race/class_/gender. `extractUnitFields`
  (`extract-fields.ts:113-183`) already extracts **dynamicFlags** and
  **unitFlags** and reports `_changed`.
- **Own state**: self PLAYER entity IS in the entity store with full unit
  fields — own HP/mana = `entityStore.get(selfGuid(conn))`. `conn.own` holds
  position/orientation only (client.ts:274-282).
- **Movement engine** (`src/wow/movement-engine.ts`): `moveTo/follow/face/
stop/state/dispose` (:24-31) — `face(orientation)` is the pre-cast facing
  primitive; created in `login()` (client.ts:638-647), disposed in
  `handle.close()`.
- ITEM/CONTAINER update-objects are already stored as BaseEntity without
  crashing (world-handlers.ts:419-460 falls through to createBase).

### 3.2 What to build

**Opcode additions** (missing from GameOpcode):

```
CMSG_SET_SELECTION            = 0x13d   // the single most important gap
SMSG_AI_REACTION              = 0x13c
SMSG_ATTACKSWING_NOTINRANGE   = 0x145
SMSG_ATTACKSWING_BADFACING    = 0x146
SMSG_ATTACKSWING_DEADTARGET   = 0x148
SMSG_ATTACKSWING_CANT_ATTACK  = 0x149
CMSG_CANCEL_CHANNELLING       = 0x13b
SMSG_SUPERCEDED_SPELL         = 0x12c
SMSG_SPELLLOGMISS             = 0x24b
SMSG_SPELLLOGEXECUTE          = 0x24c
SMSG_SPELLDAMAGESHIELD        = 0x24f
SMSG_LOOT_CLEAR_MONEY         = 0x165
CMSG_GAMEOBJ_USE              = 0x0b1
CMSG_GAMEOBJ_REPORT_USE       = 0x481
SMSG_DURABILITY_DAMAGE_DEATH  = 0x2bd
SMSG_DEATH_RELEASE_LOC        = 0x484   // NOTE: 0x378 per wowm — see §5.8; verify live
CMSG_SELF_RES                 = 0x2b3   // optional (soulstone)
SMSG_SELF_RES                 = 0x2b4   // optional
```

**Entity model:** add `dynamicFlags: number` to `UnitEntity` and initialize in
`createUnit` (entity-store.ts:65-86) — extractUnitFields already produces it;
the type just drops it. Needed for lootable detection (0x1). Extract BYTES_0
byte 3 (power type) in extract-fields.ts:142-148 alongside race/class_/gender.
Later (optional): PLAYER_XP / PLAYER_NEXT_LEVEL_XP field names in
entity-fields.ts (PLAYER block 0x0094+ currently entirely unnamed).

**New handlers in client.ts** (dispatch registrations at :482-622, before the
registerStubs call at :624):

- Combat: ATTACKSTART/ATTACKSTOP/ATTACKERSTATEUPDATE/swing errors/AI_REACTION
  → CombatEvent.
- Spells: SPELL_START/SPELL_GO/CAST_FAILED/SPELL_FAILURE/SPELL_COOLDOWN/
  COOLDOWN_EVENT/CLEAR_COOLDOWN/INITIAL_SPELLS/LEARNED_SPELL/AURA_UPDATE(_ALL)
  → SpellEvent + spellbook/cooldown/aura state on conn.
- Loot: LOOT_RESPONSE/LOOT_REMOVED/LOOT_MONEY_NOTIFY/LOOT_RELEASE_RESPONSE/
  ITEM_PUSH_RESULT/INVENTORY_CHANGE_FAILURE → LootEvent; ITEM_QUERY_SINGLE
  response for item names (extend queryEntityName's ITEM branch,
  world-handlers.ts:547-583, which currently marks pending but never sends).
- Death: RESURRECT_REQUEST/CORPSE_RECLAIM_DELAY/DEATH_RELEASE_LOC/PRE_RESURRECT
  → DeathEvent.
- Progress: LOG_XPGAIN/LEVELUP_INFO/PARTYKILLLOG → XpEvent.
- Vitals: HEALTH_UPDATE/POWER_UPDATE → update entity store (fixes stale
  own-HP between UPDATE_OBJECT deltas).

**Event plumbing** (copy the MoveEvent pattern):

1. client.ts: event union + `onXEvent` on WorldHandle (:266-271) + WorldConn
   callback (:319).
2. daemon/server.ts:113-121: `handle.onXEvent((e) => onXEvent(e, events, log))`.
3. daemon/commands.ts: `formatXEvent`/`formatXEventObj` + exported bridge
   following `onMoveEvent` (:1024-1033) — push to ring buffer AND
   `log.append()`, per AGENTS.md.

**New verbs** (files per the checklist in AGENTS.md / tuicraft state §6):
`IpcCommand` union + `parseIpcCommand` + `dispatchCommand`
(daemon/commands.ts:49-103/:105-333/:358-636), `ui/commands.ts` slash parsing,
`cli/args.ts` CliAction + SUBCOMMANDS + parseSubcommand, `main.ts` mode switch,
`src/test/mock-handle.ts` + inline mock in `src/daemon/start.test.ts` (both, in
lockstep), docs ×4 (`src/cli/help.ts`, `docs/manual.md`,
`.claude/skills/tuicraft/SKILL.md`, `README.md`).

Suggested verb surface: `target <name>`, `attack [name]`, `stopattack`,
`cast <spellId> [name|self]`, `wand [name]`, `loot [all]`, `release`,
`reclaim`, `spells`, `auras`, `vitals`.

**Combat engine** (`src/wow/combat-engine.ts`, sibling of movement-engine):
created in `login()` after `selectCharacter` in the same scope, holds refs to
`conn` + the movement engine (reuse moveTo/face/stop for approach/positioning),
disposed in `handle.close()` before conn callbacks are unset. State: current
target guid, cast-in-flight (cast_count correlation), GCD timer, cooldown map,
aura maps (self + target), loot queue. The grind loop itself (§4) can start as
daemon-side scripting over the verbs before being promoted into the engine.

**Live tests** (`src/test/live.ts`): pattern-match the entity-tracking
describe block (:272-344) — worldSession, event array + poll helper
(:243-270), teardown in `finally { handle.close(); await handle.closed; }`.
Cases: set selection + attack a training dummy/mob → expect ATTACKSTART +
ATTACKERSTATEUPDATE events; cast a known spell → SPELL_GO; cast unknown →
verify silent drop; loot flow after a kill; REPOP after dying (hard to arrange
— may need a mob to kill the character; keep optional/skipped by default).

### 3.3 Known warts to keep in mind

- SMSG_HEALTH_UPDATE/POWER_UPDATE are currently stubbed under area "login" —
  replace with real handlers or own-vitals go stale between UPDATE_OBJECT deltas.
- `queryEntityName` adds `"1:<entry>"` to pendingNameQueries for ITEM types but
  never sends a query — implement the CMSG_ITEM_QUERY_SINGLE branch or the set
  grows (harmless but wrong).
- `drainWorldPackets` must catch handler errors (AGENTS.md) — new parsers for
  flag-gated layouts (ATTACKERSTATEUPDATE, SPELL_GO) are the top crash risk;
  fuzz them with truncated buffers in unit tests.

---

## 4. Priest-at-10 grind kit (Blood Elf, Fairbreeze Village)

### 4.1 Spellbook

Mana costs are **% of base mana** (3.0.2+); base mana at level 10 priest =
**212** (`player_class_stats.sql` row (5,10,137,212)). Spell IDs/learn levels
from `trainer_spell.sql` (template 11). Costs/cast times are from 3.3.5
Spell.dbc knowledge — **verify live** (see §5 open questions).

| Spell            | ID    | Learned | Cost     | Cast       | Effect                                              |
| ---------------- | ----- | ------- | -------- | ---------- | --------------------------------------------------- |
| Attack (melee)   | 6603  | start   | —        | —          | auto-attack toggle                                  |
| Shoot (wand)     | 5019  | start   | 0        | wand speed | auto-repeat; wand's magic school, ignores armor     |
| Smite r1         | 585   | start   | 15% ≈ 31 | 2.5 s      | 15–20 Holy                                          |
| Smite r2         | 591   | 6       | 15% ≈ 31 | 2.5 s      | ~28–34 Holy                                         |
| Lesser Heal r1   | 2050  | start   | 15% ≈ 31 | 1.5 s      | ~47–58                                              |
| Lesser Heal r2   | 2052  | 4       | 15% ≈ 31 | 2.0 s      | ~76–91                                              |
| Lesser Heal r3   | 2053  | 10*     | 15% ≈ 31 | 2.5 s      | ~135–157                                            |
| SW: Pain r1      | 589   | 4       | 22% ≈ 46 | instant    | 30 Shadow over 18 s                                 |
| SW: Pain r2      | 594   | 10*     | 22% ≈ 46 | instant    | 66 Shadow over 18 s (6×11)                          |
| Renew r1         | 139   | 8       | 17% ≈ 36 | instant    | 45 over 15 s (5×9)                                  |
| PW: Shield r1    | 17    | 6       | 23% ≈ 48 | instant    | absorbs 44, 30 s; applies Weakened Soul 6788 (15 s) |
| PW: Fortitude r1 | 1243  | 1       | ~60 flat | instant    | +3 Sta, 30 min                                      |
| Fade r1          | 586   | 8       | small    | instant    | threat drop — useless solo                          |
| Mind Blast r1    | 8092  | 10*     | 17% ≈ 36 | 1.5 s      | 42–46 Shadow, 8 s CD                                |
| Resurrection r1  | 2006  | 10*     | —        | 10 s       | out-of-combat rez                                   |
| Arcane Torrent   | 28730 | racial  | free     | instant    | +6% max mana, 2 min CD                              |

\* Level-10 spells require a trainer visit (Silvermoon — Fairbreeze has no
priest trainer). **Parse SMSG_INITIAL_SPELLS on login to see what's actually
trained before assuming r2/r3 ranks.** Talent point at 10: **Spirit Tap r1**
(Shadow tier 1) is the grind pick.

Engine rules: GCD 1.5 s on everything except Shoot. Shoot is cast-once
auto-repeat; re-issue after every hard cast; canceled by movement.
Track Weakened Soul (6788) before re-shielding.

### 4.2 Rotation + mana budget

Per-kill loop vs level 6–7 mobs (spell miss ~1%, wand miss ~3% — treat as hits):

1. Pick target (§4.4 selection rules), face it, pull at ~28 yd with **SW:P**
   (46 mana). Mob run speed ≈ 6 yd/s → ~4 s of run-in.
2. Start **Shoot** immediately. Optional one Smite (31) during run-in for
   faster kills at higher mana burn.
3. When the mob reaches melee: keep wanding (wand outdamages level-10 priest
   melee and can't be dodged/parried). SW:P r2 + wand kills a 137 hp stalker
   in ~10–15 s.
4. **Mind Blast** (36, 8 s CD) as execute when taking damage.
5. Healing: **Renew** (36) while wanding under ~70% hp; hard-cast **Lesser
   Heal r3** (31, 2.5 s) only out of combat or behind a shield; **PW:S** (48)
   only when a fight goes wrong.
6. Loot (≤5.5 yd), then next pull.

Mana: pool ≈ 472. Budget ~46–80/kill (SW:P always, Renew every other kill,
occasional MB). Wanding keeps you out of the five-second rule ~80% of each
fight → recover ~50–70/kill; SW:P-only kills are mana-neutral. Healing is the
real drain. **Drink below ~25% mana (~120)**; sit (CMSG_STANDSTATECHANGE 1) to
drink/eat; full regen from empty without drink ≈ 80–100 s sitting. Arcane
Torrent on cooldown mid-fight (free ~28 mana).

### 4.3 Targets near Fairbreeze Village (~8700, −6640, Eversong Woods)

| Mob                   | Entry       | Lvl | HP      | Faction                          | Behavior                                                 | Distance                          | Notes                                                                                      |
| --------------------- | ----------- | --- | ------- | -------------------------------- | -------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| **Springpaw Stalker** | 15651       | 6–7 | 120/137 | 38 (hostile: EnemyGroup=players) | aggressive, pure melee, 1.6 s swing                      | 28 spawns ≤400 yd, nearest ~95 yd | **primary target**; respawn 300 s; responds to call-for-help — pairs chain if pulled close |
| Elder Springpaw       | 15652       | 8–9 | 156/176 | 38                               | aggressive melee                                         | nearest ~610 yd S                 | upgrade once stalkers trivial; 57–76 XP/kill                                               |
| Wretched Hooligan     | 16162       | 6–7 | 115–148 | 16 (hostile)                     | SmartAI: Bitter Withdrawal 29098 + Sinister Strike 14873 | ~450–540 yd NW (West Sanctum)     | drops coin 5–13c; spikier damage                                                           |
| Wretched Thug         | 15645       | 7–8 | ″       | 16                               | SmartAI: Bitter Withdrawal                               | ″                                 | aggro yell = pull warning                                                                  |
| Springpaw Lynx/Cub    | 15372/15366 | 1–3 | —       | 189 (**neutral**)                | won't aggro                                              | around village                    | gray at 10 — skip                                                                          |
| Mana Wyrm             | 15274       | 1   | —       | 7 (neutral)                      | —                                                        | Sunstrider Isle only              | skip                                                                                       |

Stalker loot (lootid 15651): Springpaw Pelt 45% (20772 — quest "Pelt
Collection" at Fairbreeze, free bonus XP), Lynx Meat 62%, Discolored Fang 37%
(gray), Small Leather Collar 12% (gray), world greens, skinnable. **No coin.**

Aggro geometry vs level 10: stalker lvl 7 → 17 yd, lvl 6 → 16 yd. Pull from
≥20 yd; before engaging, clear-check a 17 yd bubble around the fighting spot;
expect assists from same-faction mobs within ~10 yd of the target.

XP (`player_xp_for_level.sql`: 7600 for 10→11; formula `Formulas.cpp:27`,
base 45+5×lvl): lvl 6 = 19, lvl 7 = 38, lvl 8 = 57, lvl 9 = 76 per kill at 1×
rates → ~250–400 stalker kills/level. Elders nearly halve it. Rest bonus
doubles kill XP while rested (capped at 100% of kill XP, `Player.cpp:8931`).
Check server XP rate — playerbots realms often run >1×.

Target-selection heuristics worth copying from mod-playerbots (design
reference, module not vendored): (1) **attackers first** — if something is
hitting you, fight it before picking a new grind target; (2) scan ~60 yd for
alive, attackable, non-tapped, XP-giving, non-elite targets and **prefer the
candidate with the fewest same-faction neighbors** (anti-chain-pull), ties by
distance; (3) loot corpses within ~15–20 yd after each kill; (4) eat/drink
below ~50% resources before the next pull.

### 4.4 Her stats + safety thresholds

Pools (reconciled from `player_class_stats.sql` + `player_race_stats.sql`,
assuming no stat gear): **HP 187** (base 137 + 23 sta → 20×1 + 3×10),
**mana ≈ 472** (212 base + 36 int → 20 + 16×15). Verify live.

Stalker (lvl 7) offense (`Creature::CalculateMinMaxDamage`,
`StatSystem.cpp:1117`; damage_base 2.7669, AP 24, 1.6 s): ~7.2–9.4/swing →
~5.2 raw DPS, **~4.2 effective DPS** after cloth armor + miss/dodge
(~7 avg/landed hit). Lvl 6 ~15% less. Expected damage taken/kill: ~35–50
(~20–27% of 187). One Renew covers two kills.

Engine thresholds:

| Condition                                 | Action                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| HP < 65 (35%)                             | stop DPS; PW:S + Renew; wand only until shield expires                                                            |
| HP < 45 (25%)                             | shield + hard-cast Lesser Heal r3 behind it; if shield broken and mob >30% hp, disengage toward Fairbreeze guards |
| 2 adds (~8.4 DPS, ~22 s to die from full) | shield now, SW:P both, wand lower-hp one, Renew rolling; stop pulling                                             |
| 3+ adds                                   | run — mobs leash; village <150 yd from nearest spawns                                                             |
| Mana < 130 before a pull                  | don't pull (reserve = shield 48 + heal 31 + SW:P 46)                                                              |
| Mana < 25% between fights                 | sit + drink                                                                                                       |
| Watchdog                                  | time-to-die from full: 1 mob ~45 s, 2 mobs ~22 s — react well inside 10 s                                         |

---

## 5. Contradictions resolved + open questions

### 5.1–5.8 wow_messages vs AzerothCore — **AC wins, it is the target server**

1. **SpellCastTargets SOURCE/DEST_LOCATION**: AC reads/writes a PackedGuid
   transport guid before each xyz triple (`Spell.cpp:139-165`); wow_messages
   has bare Vector3d (`spell_cast_targets.rs:210`). → **Include the packed
   transport guid (send `00`).** Moot for our casts (UNIT/SELF only), but the
   SPELL_START/GO parser must handle it for other casters' AoE.
2. **SMSG_SPELL_FAILURE 0x133 / SMSG_SPELL_FAILED_OTHER 0x2A6**: AC sends both
   as `PackedGuid caster; u8 cast_count; u32 spell; u8 result`
   (`Spell.cpp:5146` SendInterrupted); wowm says full Guid + no
   cast_count/result for 0x2A6. → **Parse PackedGuid + 4-field layout for both.**
3. **SMSG_INITIAL_SPELLS cooldown entries**: AC writes u32 spell id → 16-byte
   entries (`Player.cpp:2748`, size calc `4+2+2+4+4`); wowm CooldownSpell has
   u16 spell → 12-byte. → **16-byte entries, u32 spell id.**
4. **SMSG_LOG_XPGAIN extra block**: AC includes `u32 rawXP + f32 groupRate` on
   **KILL (type 0)** (`Player.cpp:2339`); wowm claims NON_KILL. → **Extra block
   on type 0.**
5. **SMSG_LOOT_RESPONSE**: 3.3.5 per-item layout is 22 bytes (index, id,
   count, display, suffix, prop, slot_type) per AC `LootMgr.cpp:963-1075`;
   wowm only models vanilla's short form (no wrath Rust generated). → **Use
   the AC layout.**
6. **CMSG_REPOP_REQUEST**: AC handler reads `u8 checkInstance`; wowm says
   empty. → **Send one zero byte.**
7. **SMSG_CORPSE_RECLAIM_DELAY**: wowm says seconds; AC sends
   `delay * IN_MILLISECONDS` (`Player.cpp:13109-13114`). → **Treat as
   milliseconds.**
8. **SMSG_DEATH_RELEASE_LOC opcode number**: the wire research (wowm) gives
   **0x378**; the tuicraft-state report suggested adding it as 0x484. These
   can't both be right — 3.3.5 Opcodes.h has SMSG_DEATH_RELEASE_LOC = 0x378
   and 0x484 is in the 0x47F/0x480/0x481 (HEALTH_UPDATE/POWER_UPDATE/
   GAMEOBJ_REPORT_USE) neighborhood. → **Define as 0x378**, confirm against
   AC `Opcodes.h` before merging, and stub-log whatever arrives on release to
   verify.

### Open questions needing live probing (against t1:3724)

1. **Spell.dbc values**: exact mana costs (validate the %-of-212 model), cast
   times, wand min range, Smite/MB damage ranges — read from SMSG_SPELL_GO
   POWER_LEFT_SELF / mana deltas and cast timings. The repo has no client DBCs.
2. **Which ranks are trained**: does the character have Mind Blast, SW:P r2,
   Lesser Heal r3 (level-10 trainer spells)? Parse SMSG_INITIAL_SPELLS on
   login; a Silvermoon trainer run may be a prerequisite.
3. **Wand equipped + its DPS**: charstartoutfit is DBC-only, not in the SQL
   dump. No wand → melee-only ~2–4 DPS and the whole §4 plan degrades. Check
   inventory live (or just observe Shoot cast results).
4. **Actual max mana / int from gear** (naked math says 472) and **server XP
   rate** (playerbots realms often >1×) — calibrate kills-per-level.
5. **Corpse reclaim delay on this realm**: AC default = 0 s for PvE, but read
   the actual SMSG_CORPSE_RECLAIM_DELAY value.
6. **Spell queue window**: is `CONFIG_SPELL_QUEUE_ENABLED` on (fork default)?
   Determines whether the bot can fire the next cast up to 400 ms before GCD
   ends or must wait for exact GCD expiry.
7. **SMSG_SPELL_START on instants**: confirm whether AC emits START (timer 0)
   before GO for instants, so the cast-tracking state machine keys on the
   right packet.
8. **SMSG_DEATH_RELEASE_LOC opcode** (see 5.8) and the release teleport ack
   flow (near-teleport MSG_MOVE_TELEPORT_ACK vs worldport) — verify the
   existing teleport handling survives a graveyard repop.
9. **AURA_UPDATE stack-vs-charges semantics** at this level are untested —
   confirm Renew/SW:P/Weakened Soul appear with DURATION flag and sane
   time_left values.
10. **Assist radius chaining**: verify the ~10 yd assist behavior on Springpaw
    Stalkers live (faction 38 has respond-to-call-for-help) to tune the
    clear-bubble check.

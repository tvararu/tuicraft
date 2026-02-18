# v5 Design Exploration: Client-Side Priest Healer Bot

**Date**: 2026-02-18
**Status**: Early exploration — captures research and directional thinking

## What This Is

v5 takes tuicraft from a passive client to an autonomous agent. First target:
a Holy/Disc Priest healer in 5-man dungeons with human players. Humans tank,
DPS, and navigate. The bot heals and follows.

Client-side only. No playerbots, no GM commands, no server mods. A regular
player on vanilla AzerothCore 3.3.5a.

## Assumed Foundation (v2–v4)

By the time v5 starts we have chat (v2), world state via
`SMSG_UPDATE_OBJECT` parsing (v3), and movement via `CMSG_MOVE_*` with
pathfinding (v4).

## Key Decisions

**Pathfinding: namigator via Bun FFI.** Simple "follow the tank's
coordinates" won't work — terrain, walls, and dungeon geometry make naive
movement a non-starter. namigator is a C++ library that reads WoW MPQ files
and generates high-quality navmesh with pathfinding and line-of-sight
checking. We'd compile it as a shared library and call it from TypeScript via
`bun:ffi`. One-time build step extracts navmesh from client data. Rust
bindings exist (namigator-rs) proving the C API is stable. The API is exactly
what a healer needs: `find_path(start, stop)`, `line_of_sight(a, b)`,
`find_height(x, y)`.

Alternatives considered: AmeisenNavigation (TCP sidecar over TrinityCore
mmaps, Windows-only), custom Detour wrapper (simpler but no LoS), naive
follow (broken indoors).

**Architecture: state machine + utility scoring hybrid.** Top-level state
machine (idle/combat/drinking/dead) prevents nonsensical behavior. Within
combat, utility scoring picks the best action each tick by scoring all
possible spells against world state. Easy to debug (log scores), easy to
tune (adjust weight curves).

Alternative considered: behavior tree (brittle thresholds, poor at competing
priorities like "tank at 60% vs 3 DPS at 50%").

**Use case: dungeon healer following a human group.** Minimizes independent
navigation — the bot pathfinds to stay in range of the group, not to explore
independently. Humans handle route decisions.

## Hard Problems (Ranked by Effort)

### 1. SMSG_UPDATE_OBJECT Parser (v3 scope, v5 depends on it)

The most complex packet in the protocol. Variable-length bitmask encoding,
multiple update types (partial, create, movement, destroy), and ~150 unit
fields. AzerothCore's UpdateFields.h defines the complete field table — the
fields we care about for healing:

- `UNIT_FIELD_HEALTH` (offset 0x12), `UNIT_FIELD_MAXHEALTH` (0x1A)
- `UNIT_FIELD_POWER1..7` (0x13–0x19), `UNIT_FIELD_MAXPOWER1..7` (0x1B–0x21)
- `UNIT_FIELD_LEVEL` (0x30), `UNIT_FIELD_FACTIONTEMPLATE` (0x31)
- `UNIT_FIELD_BYTES_0` (0x11) — race/class/gender/power type packed as 4 bytes
- `UNIT_FIELD_TARGET` (0x0C) — who this unit is targeting
- `UNIT_FIELD_FLAGS` (0x35) — combat state, stunned, etc.
- `UNIT_MOD_CAST_SPEED` (0x4A) — haste for GCD calculation

All offsets relative to OBJECT_END (0x06). Player fields extend further with
UNIT_END at 0x94 (so 0x9A absolute). The bitmask compression means only
changed fields are sent — we read N uint32 mask blocks, check which bits are
set, and read that many uint32 values.

Wrath-specific format differences from Vanilla: no `hasTransport` byte in
header, movement flags split into uint32 + uint16, extra speed fields (flight,
flight reverse, pitch rate), update flags as uint16 not uint8.

This is the single largest protocol implementation task. Easily 2–3x the
complexity of all v1 combined. But it's well-documented in AzerothCore source
and the wowdev wiki, and the wow_world_messages Rust crate has complete
auto-generated definitions we can cross-reference.

### 2. namigator FFI Integration

The API is clean but the build pipeline has real complexity: compile C++ with
CMake (depends on StormLib + RecastNavigation), write thin C ABI wrapper, call
via `bun:ffi` dlopen. One-time navmesh extraction from WoW MPQ files. ADT
loading strategy (all at startup = GB of RAM, or load on demand as character
moves). Cross-platform shared library (.dylib/.so).

### 3. Spell Casting Protocol

`CMSG_CAST_SPELL` with packed GUID target, cast counter, spell ID. Response
chain: `SMSG_SPELL_START` → `SMSG_SPELL_GO` or `SMSG_CAST_FAILED`. Need
cooldown tracking, GCD tracking, cast bar simulation. For a healer: also parse
`SMSG_PARTY_MEMBER_STATS` (server-pushed raid frame data), `SMSG_AURA_UPDATE`
(buff/debuff tracking for dispel decisions), and threat packets for Fade
timing.

### 4. Movement Packet Generation

Converting namigator waypoints into believable `CMSG_MOVE_*` heartbeats:
~200ms intervals, correct speed for buffs, facing updates, stop/start
transitions, rubberbanding detection and recovery. The server validates
movement speed but AzerothCore's anticheat is lenient by default.

### 5. Decision Engine

The actual AI — scoring heal targets, picking spells, managing mana — is
the easiest part. Pure TypeScript, fully unit-testable with mock world state.

## Risks and Gotchas

**Line of sight**: namigator provides LoS checking, solving the "can I heal
this target?" problem predictively rather than reactively.

**Spell IDs and talents**: need `SMSG_TALENTS_INFO` to know spec (Disc vs
Holy), or `SMSG_INITIAL_SPELLS` to discover available spells.

**Server-side validation**: every cast can fail. Treat nothing as successful
until `SMSG_SPELL_GO` confirms it.

**Update frequency**: server pushes at ~10-15 Hz. Decision loop at ~200ms
ticks. Faster wastes CPU, slower risks late heals.

**Mana management**: utility scorer must weight mana efficiency heavily.
Flash Heal spam = OOM in 30 seconds.

## Prior Art and References

- mod-playerbots Strategy–Trigger–Action architecture: ~88 base strategies,
  281 actions, 34 trigger types, 10 class packages, 13 raid packages. Their
  encounter knowledge (trigger conditions, target priorities, phase detection)
  is portable as data even though the C++ execution isn't.
- namigator: github.com/namreeb/namigator (C++ pathfinding, WotLK support)
- namigator-rs: github.com/gtker/namigator-rs (Rust bindings, proves API)
- AmeisenNavigation: github.com/Jnnshschl/AmeisenNavigation (TCP nav server)
- AzerothCore UpdateFields.h: complete field index for 3.3.5a build 12340
- wow_world_messages: Rust crate with auto-generated packet definitions
- wowdev.wiki: SMSG_UPDATE_OBJECT format documentation

# Movement Support — Implementation Research Notes

Merged reference for adding player movement to tuicraft (WoW 3.3.5a build 12340,
AzerothCore playerbots target). Sources: `../wow_messages` (.wowm WRATH specs +
generated Rust), `../azerothcore-wotlk-playerbots` (server source, file:line
cites), tuicraft's own code, `../wowser` / `../wow-chat-client` (client refs),
`../namigator` @ 54eae69 + `../namigator-rs`.

All integers/floats little-endian. `Guid` = u64. `PackedGuid` = 1 mask byte +
one byte per set bit of the u64 (LSB-first, only non-zero bytes written).
`Vector3d` = 3×f32 (x, y, z).

---

## 1. Wire format reference

### 1.1 MovementInfo (3.3.5)

Wire layout is the classic `u32 flags; u16 extraFlags;` (wow_messages models it
as a u48; generated Rust confirms u32 LE then u16 LE, 6 bytes total). Exact
field order:

```
struct TransportInfo {
    PackedGuid guid;
    Vector3d   position;        // 3 x f32
    f32        orientation;
    u32        timestamp;       // transport time
    u8         seat;
}

struct MovementInfo {
    u32  flags;                 // MovementFlags (low 32)
    u16  extraFlags;            // MovementFlagsExtra (high 16)
    u32  timestamp;             // client ms tick (GetTickCount-style)
    f32  x, y, z;
    f32  orientation;
    if (flags & ON_TRANSPORT && extraFlags & INTERPOLATED_MOVEMENT) {
        TransportInfo transport;
        u32 transport_time2;
    } else if (flags & ON_TRANSPORT) {          // 0x00000200
        TransportInfo transport;
    }
    if (flags & SWIMMING)                       // 0x00200000
        f32 pitch;
    else if (flags & FLYING)                    // 0x02000000
        f32 pitch;
    else if (extraFlags & ALWAYS_ALLOW_PITCHING)// 0x0020
        f32 pitch;
    u32  fall_time;                             // ALWAYS present, ms (see note)
    if (flags & FALLING) {                      // 0x00001000
        f32 z_speed;                            // negative going down; jump ≈ -7.9555473
        f32 cos_angle;                          // facing unit vector
        f32 sin_angle;
        f32 xy_speed;                           // horizontal speed, run = 7.0
    }
    if (flags & SPLINE_ELEVATION)               // 0x04000000
        f32 spline_elevation;
}
```

Order is exactly: flags → extraFlags → timestamp → pos → orientation →
[transport] → [pitch] → fall_time → [fall block] → [spline elevation].

**fall_time type — contradiction resolved.** wow_messages models it as `f32`;
AzerothCore `ReadMovementInfo` reads `uint32` milliseconds. AzerothCore wins
(it is the target server and the consumer of what we send). Write it as u32 ms;
`0` is byte-identical under both interpretations, so tuicraft's existing
4-byte skip on the read path stays correct either way.

**MovementFlags (u32):**

| Name            | Value      | Name                 | Value      |
| --------------- | ---------- | -------------------- | ---------- |
| NONE            | 0x00000000 | PENDING_FORWARD      | 0x00010000 |
| FORWARD         | 0x00000001 | PENDING_BACKWARD     | 0x00020000 |
| BACKWARD        | 0x00000002 | PENDING_STRAFE_LEFT  | 0x00040000 |
| STRAFE_LEFT     | 0x00000004 | PENDING_STRAFE_RIGHT | 0x00080000 |
| STRAFE_RIGHT    | 0x00000008 | PENDING_ROOT         | 0x00100000 |
| LEFT (turn)     | 0x00000010 | SWIMMING             | 0x00200000 |
| RIGHT (turn)    | 0x00000020 | ASCENDING            | 0x00400000 |
| PITCH_UP        | 0x00000040 | DESCENDING           | 0x00800000 |
| PITCH_DOWN      | 0x00000080 | CAN_FLY              | 0x01000000 |
| WALKING         | 0x00000100 | FLYING               | 0x02000000 |
| ON_TRANSPORT    | 0x00000200 | SPLINE_ELEVATION     | 0x04000000 |
| DISABLE_GRAVITY | 0x00000400 | SPLINE_ENABLED       | 0x08000000 |
| ROOT            | 0x00000800 | WATERWALKING         | 0x10000000 |
| FALLING         | 0x00001000 | FALLING_SLOW         | 0x20000000 |
| FALLING_FAR     | 0x00002000 | HOVER                | 0x40000000 |
| PENDING_STOP    | 0x00004000 | PENDING_STRAFE_STOP  | 0x00008000 |

**MovementFlagsExtra (u16):**

| Name                  | Value  | Name                  | Value  |
| --------------------- | ------ | --------------------- | ------ |
| NO_STRAFE             | 0x0001 | UNK9                  | 0x0100 |
| NO_JUMPING            | 0x0002 | UNK10                 | 0x0200 |
| UNK3                  | 0x0004 | INTERPOLATED_MOVEMENT | 0x0400 |
| FULL_SPEED_TURNING    | 0x0008 | INTERPOLATED_TURNING  | 0x0800 |
| FULL_SPEED_PITCHING   | 0x0010 | INTERPOLATED_PITCHING | 0x1000 |
| ALWAYS_ALLOW_PITCHING | 0x0020 | UNK14                 | 0x2000 |
| UNK7                  | 0x0040 | UNK15                 | 0x4000 |
| UNK8                  | 0x0080 | UNK16                 | 0x8000 |

Simple ground bot walking forward: `flags = 0x00000001`, `extraFlags = 0`,
timestamp, x, y, z, o, `fall_time = 0`. Stop: `flags = 0`.

### 1.2 Client→server movement opcodes (MSG_MOVE_*)

**3.3.5 body for ALL of these, both directions: `PackedGuid guid; MovementInfo
info;` — the packed mover guid comes FIRST, even client→server.** (1.12/2.4.3
omitted the guid client-side; 3.3.5 does not. AzerothCore
`HandleMovementOpcodes` reads the packed guid first and drops the packet if it
doesn't match the active mover.)

| Opcode                      | Hex    | Opcode                    | Hex    |
| --------------------------- | ------ | ------------------------- | ------ |
| MSG_MOVE_START_FORWARD      | 0x00B5 | MSG_MOVE_START_PITCH_UP   | 0x00BF |
| MSG_MOVE_START_BACKWARD     | 0x00B6 | MSG_MOVE_START_PITCH_DOWN | 0x00C0 |
| MSG_MOVE_STOP               | 0x00B7 | MSG_MOVE_STOP_PITCH       | 0x00C1 |
| MSG_MOVE_START_STRAFE_LEFT  | 0x00B8 | MSG_MOVE_FALL_LAND        | 0x00C9 |
| MSG_MOVE_START_STRAFE_RIGHT | 0x00B9 | MSG_MOVE_START_SWIM       | 0x00CA |
| MSG_MOVE_STOP_STRAFE        | 0x00BA | MSG_MOVE_STOP_SWIM        | 0x00CB |
| MSG_MOVE_JUMP               | 0x00BB | MSG_MOVE_SET_FACING       | 0x00DA |
| MSG_MOVE_START_TURN_LEFT    | 0x00BC | MSG_MOVE_SET_PITCH        | 0x00DB |
| MSG_MOVE_START_TURN_RIGHT   | 0x00BD | MSG_MOVE_HEARTBEAT        | 0x00EE |
| MSG_MOVE_STOP_TURN          | 0x00BE | MSG_MOVE_START_ASCEND     | 0x0359 |
| MSG_MOVE_STOP_ASCEND        | 0x035A | MSG_MOVE_START_DESCEND    | 0x03A7 |

- `MSG_MOVE_SET_FACING` (0x00DA): new orientation goes inside MovementInfo —
  no separate field.
- `MSG_MOVE_JUMP` (0x00BB): set FALLING (0x1000) + fall block
  (`z_speed ≈ -7.9555473`, cos/sin = facing unit vector, `xy_speed = 7.0` at
  run speed).
- `CMSG_SET_ACTIVE_MOVER = 0x026A { Guid guid; }` — **full 8-byte guid**, sent
  once after entering world (and after far teleport).
- `CMSG_MOVE_TIME_SKIPPED = 0x02CE { PackedGuid guid; u32 lag; }`.
- `CMSG_MOVE_FALL_RESET = 0x02CA` — **contradiction resolved**: wow_messages
  spec has no guid prefix for 3.3.5, but AzerothCore routes it through
  `HandleMovementOpcodes`, which reads a packed guid first. AzerothCore wins:
  send `PackedGuid + MovementInfo` like every other MSG_MOVE.

### 1.3 Time sync

```
SMSG_TIME_SYNC_REQ  = 0x0390 { u32 counter; }   // starts 0, increments per req
CMSG_TIME_SYNC_RESP = 0x0391 {
    u32 counter;        // echo
    u32 client_ticks;   // client ms uptime — SAME clock as MovementInfo.timestamp
}
```

Respond promptly to every request. Use one monotonic ms counter for both
`client_ticks` and every MovementInfo timestamp — the server computes a clock
delta from the pair and uses it to rewrite movement timestamps (§2.2).

### 1.4 Teleport handshakes

**Near teleport (same map)** — `MSG_MOVE_TELEPORT_ACK = 0x00C7`, asymmetric:

```
// server → client:
{ PackedGuid guid; u32 movement_counter; MovementInfo dest; }
// client → server (send immediately on receipt):
{ PackedGuid guid /* own */; u32 movement_counter /* echo */; u32 time /* client ticks */; }
```

Until acked, the server drops all your movement packets (§2.1). After acking,
update local position to `dest`.

**Far teleport (map change):**

```
SMSG_TRANSFER_PENDING = 0x003F { u32 map; optional { u32 transport_entry; u32 transport_map; } }
SMSG_NEW_WORLD        = 0x003E { u32 map; f32 x, y, z, orientation; }
MSG_MOVE_WORLDPORT_ACK = 0x00DC {}              // EMPTY body, client → server
```

Flow: TRANSFER_PENDING → NEW_WORLD → client sends WORLDPORT_ACK (zero-length)
→ server adds player to the new map and sends initial/spawn packets. Update
local map+position from SMSG_NEW_WORLD; re-send CMSG_SET_ACTIVE_MOVER after
landing.

### 1.5 Speed changes + acks

Server→client force packets: `PackedGuid guid; u32 counter; f32 speed;` —
**except SMSG_FORCE_RUN_SPEED_CHANGE (0x00E2), which has an extra u8 between
counter and speed** (`guid, u32, u8, f32`).

| SMSG                                | Hex    | CMSG ack                                | Hex    |
| ----------------------------------- | ------ | --------------------------------------- | ------ |
| SMSG_FORCE_RUN_SPEED_CHANGE         | 0x00E2 | CMSG_FORCE_RUN_SPEED_CHANGE_ACK         | 0x00E3 |
| SMSG_FORCE_RUN_BACK_SPEED_CHANGE    | 0x00E4 | CMSG_FORCE_RUN_BACK_SPEED_CHANGE_ACK    | 0x00E5 |
| SMSG_FORCE_SWIM_SPEED_CHANGE        | 0x00E6 | CMSG_FORCE_SWIM_SPEED_CHANGE_ACK        | 0x00E7 |
| SMSG_FORCE_WALK_SPEED_CHANGE        | 0x02DA | CMSG_FORCE_WALK_SPEED_CHANGE_ACK        | 0x02DB |
| SMSG_FORCE_SWIM_BACK_SPEED_CHANGE   | 0x02DC | CMSG_FORCE_SWIM_BACK_SPEED_CHANGE_ACK   | 0x02DD |
| SMSG_FORCE_TURN_RATE_CHANGE         | 0x02DE | CMSG_FORCE_TURN_RATE_CHANGE_ACK         | 0x02DF |
| SMSG_FORCE_FLIGHT_SPEED_CHANGE      | 0x0381 | CMSG_FORCE_FLIGHT_SPEED_CHANGE_ACK      | 0x0382 |
| SMSG_FORCE_FLIGHT_BACK_SPEED_CHANGE | 0x0383 | CMSG_FORCE_FLIGHT_BACK_SPEED_CHANGE_ACK | 0x0384 |

All ack bodies (3.3.5, one shape for all eight):

```
{ PackedGuid guid; u32 counter /* echo */; MovementInfo info; f32 new_speed /* echo */; }
```

**Flight-ack guid type — contradiction resolved.** wow_messages keeps a full
8-byte Guid for 0x0382/0x0384 (pasted from 2.4.3); AzerothCore
`HandleForceSpeedChangeAck` reads a _packed_ guid for every speed ack,
including flight. AzerothCore wins: PackedGuid everywhere.

Speed changes about _other_ players arrive as SMSG_SPLINE_SET_*_SPEED — never
ack those.

### 1.6 Root/unroot

```
SMSG_FORCE_MOVE_ROOT    = 0x00E8 { PackedGuid guid; u32 counter; }
SMSG_FORCE_MOVE_UNROOT  = 0x00EA { PackedGuid guid; u32 counter; }
CMSG_FORCE_MOVE_ROOT_ACK   = 0x00E9 { PackedGuid guid; u32 counter; MovementInfo info; }
CMSG_FORCE_MOVE_UNROOT_ACK = 0x00EB { PackedGuid guid; u32 counter; MovementInfo info; }
```

On ROOT ack set flag 0x800 in `info.flags`; on UNROOT ack clear it; echo the
counter. Note server-side state gates (§2.6). MSG_MOVE_ROOT/UNROOT
(0x00EC/0x00ED) are broadcast versions about other players — observe only.

### 1.7 Stand state

```
CMSG_STANDSTATECHANGE  = 0x0101 { u32 state; }   // 0 = STAND
SMSG_STANDSTATE_UPDATE = 0x029D { u8 state; }
// UnitStandState: STAND=0 SIT=1 SIT_CHAIR=2 SLEEP=3 SIT_LOW_CHAIR=4
//                 SIT_MEDIUM_CHAIR=5 SIT_HIGH_CHAIR=6 DEAD=7 KNEEL=8 CUSTOM=9
```

Stand before moving if seated. Current state also in UNIT_FIELD_BYTES_1 byte 0.

### 1.8 SMSG_MONSTER_MOVE (read-only, NPC movement)

```
enum MonsterMoveType : u8 { NORMAL=0 STOP=1 FACING_SPOT=2 FACING_TARGET=3 FACING_ANGLE=4 }

SMSG_MONSTER_MOVE = 0x00DD {
    PackedGuid guid;
    u8 unknown;                     // 0
    Vector3d spline_start;
    u32 spline_id;
    u8 move_type;
    if (move_type == FACING_TARGET) Guid target;         // full u64
    else if (move_type == FACING_ANGLE) f32 angle;
    else if (move_type == FACING_SPOT) Vector3d spot;
    // if move_type == STOP the packet ENDS here
    u32 spline_flags;
    if (spline_flags & ENTER_CYCLE /*0x100000*/) { u32 anim_id; u32 anim_start; }
    u32 duration_ms;
    if (spline_flags & PARABOLIC /*0x800*/) { f32 vertical_accel; u32 effect_start; }
    u32 point_count;
    Vector3d first_point;                                // full floats
    // each subsequent point: packed u32
    //   x = (p & 0x7FF) * 0.25; y = ((p >> 11) & 0x7FF) * 0.25; z = ((p >> 22) & 0x3FF) * 0.25
}
```

`SMSG_MONSTER_MOVE_TRANSPORT = 0x02AE` — identical plus a second
`PackedGuid transport` right after `guid`.

SplineFlag (u32): DONE=0x100, FALLING=0x200, NO_SPLINE=0x400, PARABOLIC=0x800,
WALK_MODE=0x1000, FLYING=0x2000, ORIENTATION_FIXED=0x4000, FINAL_POINT=0x8000,
FINAL_TARGET=0x10000, FINAL_ANGLE=0x20000, CATMULLROM=0x40000, CYCLIC=0x80000,
ENTER_CYCLE=0x100000, ANIMATION=0x200000, FROZEN=0x400000,
TRANSPORT_ENTER=0x800000, TRANSPORT_EXIT=0x1000000,
ORIENTATION_INVERSED=0x8000000.

**Packed-point caveat:** the wow_messages crate decodes packed points as
absolute `/4` values, but real clients treat them as offsets from the midpoint
of start/end for non-catmullrom paths. For reliable destination extraction use
the first full point + duration, or only trust packets with `point_count == 1`.
Needs live verification before relying on intermediate waypoints (§5).

### 1.9 Required send sequence for a moving bot

1. Answer every SMSG_TIME_SYNC_REQ immediately (monotonic ms clock).
2. On world enter (and after far teleport): `CMSG_SET_ACTIVE_MOVER(own guid)`.
3. Stand up if needed (CMSG_STANDSTATECHANGE 0).
4. Move: MSG_MOVE_START_FORWARD → MSG_MOVE_HEARTBEAT every ~500ms while
   position changes → MSG_MOVE_STOP. Each with PackedGuid + fresh MovementInfo
   (monotonic timestamp, updated x/y/z/o).
5. Ack every FORCE_*_SPEED_CHANGE, FORCE_MOVE_ROOT/UNROOT and
   MSG_MOVE_TELEPORT_ACK immediately — otherwise the server ignores movement
   or rubber-bands you.

---

## 2. Server-side rules (AzerothCore playerbots branch)

Paths relative to `../azerothcore-wotlk-playerbots`.

### 2.1 HandleMovementOpcodes — what drops, what kicks

`src/server/game/Handlers/MovementHandler.cpp:344-396`:

- Teleport in progress (`IsBeingTeleported()`) → packet silently dropped
  (:354-359). All movement sent between teleport start and ack is discarded.
- Packed-guid mismatch vs active mover → silently dropped (:362-370). Never a
  kick.
- Flag contradictions are **silently stripped**, not punished —
  `ReadMovementInfo` (`src/server/game/Server/WorldSession.cpp:1039-1155`,
  `REMOVE_VIOLATING_FLAGS` macro :1077-1092): client-sent ROOT always removed
  (:1097); HOVER without aura (:1101); ASCENDING+DESCENDING (:1105);
  LEFT+RIGHT (:1109); STRAFE_L+STRAFE_R (:1113); PITCH_UP+PITCH_DOWN (:1117);
  FORWARD+BACKWARD (:1121); WATERWALKING without aura/ghost (:1125);
  FALLING_SLOW without feather fall (:1132); FLYING|CAN_FLY without fly aura
  (:1141); FALLING removed when CAN_FLY|DISABLE_GRAVITY (:1145);
  SPLINE_ENABLED without active spline (:1148).
- `VerifyMovementInfo` (MovementHandler.cpp:518-599), false → drop:
  invalid position (:520-528); server spline not finished (:530-534);
  UNIT_FLAG_DISABLE_MOVE + moving flags (:537-548); ONTRANSPORT with position
  > SIZE_OF_GRIDS away (:568-579) or invalid transport-adjusted coords
  > (:581-590); rooted mover sending movement (:594-596).
- **KickPlayer paths**: `AnticheatHandleDoubleJump` fail on MSG_MOVE_JUMP
  (:551-559) and `AnticheatCheckMovementInfo` fail (:562-566) — both are
  ScriptMgr hooks that **return true (pass) when no anticheat module is
  registered** (`CALL_ENABLED_BOOLEAN_HOOKS`, `ScriptMgrMacros.h:76-80`;
  hook defs `ScriptDefines/PlayerScript.cpp:872-899`). No anticheat module
  exists in this checkout — these never fire.
- On success the MovementInfo is re-serialized and rebroadcast to nearby
  players (:393-395). **No position-vs-speed/physics validation anywhere** —
  position is trusted after flag sanitization. Non-physical jumps between
  packets are accepted.

### 2.2 Timestamps

`SynchronizeMovement` (MovementHandler.cpp:398-410):
`movementTime = info.time + _timeSyncClockDelta`; if delta is 0 or result out
of u32 range, falls back to server `getMSTime()` (logs an error, nothing
else). Timestamps are **never** a drop/kick condition — they're rewritten
before rebroadcast.

### 2.3 Time-sync cadence

`WorldSession::SendTimeSync` (WorldSession.cpp:1472-1483): first request on
world enter (`Player::SendInitialPacketsAfterAddToMap`, Player.cpp:11661-11662),
next after **5s** (counter 0), then every **10s**. `HandleTimeSyncResp`
(:907-939): unknown counter → silently ignored; otherwise RTT/2-based clock
delta into a 6-slot median filter (`ComputeNewClockDelta`, :941-976).
**Never responding has no penalty** — delta stays 0 and the server just uses
its own clock for your movement times. Respond anyway for correct rebroadcast
timing to other clients.

### 2.4 Heartbeats

MSG_MOVE_HEARTBEAT is handled like any movement opcode (`Opcodes.cpp:369`,
STATUS_LOGGEDIN). **No server-side cadence requirement, no timeout, no check
of any kind on heartbeat frequency.** The ~500ms cadence is client convention;
send at whatever tick rate the daemon uses — the server only knows the
position you last reported.

### 2.5 Fall damage

`Player::HandleFall` (`src/server/game/Entities/Player/Player.cpp:14009-14051`),
invoked **only** on MSG_MOVE_FALL_LAND for non-flying players
(MovementHandler.cpp:620-625):

- Damage from `z_diff = m_lastFallZ - landing_Z` (:14012). The client
  `fall_time` and jump block are **not** used for damage (fallTime is only
  logged, :14043).
- `damageperc = 0.018 * (z_diff - safe_fall) - 0.2426`; damage = perc × max
  health × rate, capped at max health (:14022-14036). Skipped if
  `z_diff < 13.48`, dead, GM, hover/feather-fall/fly (:14015-14017).
- `m_lastFallZ` tracks the apex: `UpdateFallInformationIfNeed`
  (PlayerUpdates.cpp:2184-2190) re-seeds it on every movement packet while
  `lastFallTime >= info.fallTime || lastFallZ <= info.pos.Z` or on FALL_LAND.
  Seeded to destination Z on teleport (MovementHandler.cpp:303,
  Player.cpp:1486/1574).
- **Bot strategy**: never send MSG_MOVE_FALL_LAND and keep reported Z at/above
  ground → no fall damage path executes. When implementing real falls later,
  report an accurate apex and landing Z.
- **Void guard (always on)**: reporting Z below the map's `GetMinHeight` in
  `HandleMoverRelocation` (MovementHandler.cpp:488-503) deals full-max-health
  `DAMAGE_FALL_TO_VOID` instakill, independent of fall opcodes. Never report a
  below-world Z.

### 2.6 Teleport state machines

**Near** (`Player::TeleportTo` same-map branch, Player.cpp:1453-1500): server
sets near-semaphore, relocates, sends MSG_MOVE_TELEPORT_ACK with
`GetOrderCounter()` then increments it (Player.cpp:1343-1351). Client ack →
`HandleMoveTeleportAck` (MovementHandler.cpp:274-342): requires
`IsBeingTeleportedNear()` (:288-289) and guid match (:291-292); **the echoed
counter and time are read but never validated** (:281-284). On success clears
the semaphore, `UpdatePosition(dest)`, re-seeds fall info.

**Far** (Player.cpp:1500-1596): snapshots order counter
(`SetMapChangeOrderCounter`, :1568) → SMSG_TRANSFER_PENDING (:1571-1578) →
remove from old map, fall info to dest Z (:1574) → SMSG_NEW_WORLD
(:1581-1590) → far-semaphore (:1594). Client's MSG_MOVE_WORLDPORT_ACK is
registered **STATUS_TRANSFER** (`Opcodes.cpp:351`) — only processed while
`_player && !_player->IsInWorld()` (WorldSession.cpp:476-487).
`HandleMoveWorldportAck` (MovementHandler.cpp:45-272): requires
`IsBeingTeleportedFar()`; **KickPlayer** on invalid destination map coords
(:63-67) or invalid grid coords (:145-147, :190-194) — server-data problems,
not client-triggerable with a sane ack.

While either semaphore is set, all movement opcodes are dropped (§2.1).

### 2.7 Speed-change acks

`HandleForceSpeedChangeAck` (MovementHandler.cpp:665-765). Server sends
force-speed with `counter = GetOrderCounter()` then increments
(`Unit::SendSpeedToController`, Unit.cpp:11382-11397), and increments
`m_forced_speed_changes[mtype]`.

Ack processing: packed guid must equal both mover and player (:685-689);
`counter <= GetMapChangeOrderCounter()` → dropped as stale from before map
change (:692-693); `ProcessMovementInfo` must pass (:695-699); pending-change
counter decremented, only the **last** ack in a batch is fully processed
(:743-748). Speed value check (:750-764), tolerance 0.01:

- acked speed **slower** than server's → server corrects, resends, logs. No
  kick.
- acked speed **faster** than server's → **`KickPlayer("Incorrect speed")`**
  (:758-763). Always echo the exact f32 the server sent.

Missing acks: nothing times out, nothing kicks; the next valid ack is still
accepted.

### 2.8 Root/knockback acks

`HandleMoveRootAck` (MovementHandler.cpp:978-1020): unroot ack requires mover
currently rooted (:996-1000); root ack requires it not rooted (:1002-1005);
stale counter dropped (:1007-1009). No kick path. `HandleMoveKnockBackAck`
(:811-849): stores client MovementInfo verbatim (:833), no magnitude
validation, no kick.

### 2.9 Kick summary

The only realistic kick for a well-formed client is **acking a speed change
with a value above the server's** (§2.7). Everything else either silently
drops the packet or strips flags. A bot that sends flag-consistent,
position-valid packets and correctly acks teleports/speed changes/roots is
never kicked by core movement handling.

---

## 3. tuicraft: current state vs needs

### 3.1 Already present (reuse)

| Piece                                         | Location                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Movement block parser (read)                  | `src/wow/protocol/movement-block.ts:14-120` — full 3.3.5 layout incl. transport/pitch/fall/spline branches                                             |
| MovementFlag/UpdateFlag/Extra enums           | `src/wow/protocol/entity-fields.ts:27-69`                                                                                                              |
| All MSG_MOVE / ack / teleport opcodes defined | `src/wow/protocol/opcodes.ts:221-264` (0x0B5–0x0EE), TELEPORT_ACK :237, WORLDPORT_ACK :249, SET_FACING :247, SET_ACTIVE_MOVER :476, TIME_SYNC :463-464 |
| Encrypted send path                           | `sendPacket` (`src/wow/world-handlers.ts:74-80`) → `buildOutgoingPacket` (`src/wow/protocol/world.ts:214-231`, u16BE size + u32LE opcode, ARC4 header) |
| PacketWriter (u8/u16/u32/u64/f32/cString)     | `src/wow/protocol/packet.ts:94-168`                                                                                                                    |
| PackedGuid **reader**                         | `src/wow/protocol/packet.ts:79-91`                                                                                                                     |
| Time-sync responder                           | `src/wow/world-handlers.ts:82-89`, registered `client.ts:418-420`                                                                                      |
| Own guid (conn-internal)                      | `conn.selfGuidLow/High` (`client.ts:258-259`, set :352-354)                                                                                            |
| Own entity incl. position in store            | `handleUpdateObject` creates self (no SELF-flag filtering); `entityStore.setPosition` (`world-handlers.ts:471`)                                        |
| Interval-loop precedents                      | `startPingLoop` 30s (`client.ts:365-375`), `idleCheck` 60s (`src/daemon/server.ts:196-198`)                                                            |
| Daemon IPC plumbing                           | `IpcCommand` union + `parseIpcCommand` (`src/daemon/commands.ts:~48-98`), `dispatchCommand` (:332), `processLine` (`server.ts:78-106`)                 |

### 3.2 Missing (build list)

1. **PackedGuid writer** — PacketWriter has none; every MSG_MOVE body starts
   with one. Mask byte + non-zero bytes, LSB-first.
2. **MovementInfo serializer** — inverse of `parseMovementBlock`. Ground case:
   packedGuid + u32 flags + u16 extra + u32 ticks + 4×f32 + u32 fallTime(0).
3. **Monotonic client-ticks helper** — current time-sync reply computes
   `Date.now() - conn.startTime` inline (`world-handlers.ts:87`); wall clock,
   not monotonic. Extract one helper (prefer `Bun.nanoseconds()`-based ms) and
   use it for BOTH TIME_SYNC_RESP and every MovementInfo timestamp — the
   server correlates them (§2.2).
4. **SMSG_LOGIN_VERIFY_WORLD parsing** — currently only
   `dispatch.expect(...)` at `client.ts:362`; body (u32 map, f32 x/y/z/o) is
   discarded. Parse it: this is the only source of own **mapId** (needed to
   pick the namigator map) and spawn position. `Position.mapId`
   (`src/wow/entity-store.ts:3-9`) is hardcoded 0 everywhere
   (`update-object.ts:40,56`) — thread real mapId through, update on
   SMSG_NEW_WORLD.
5. **Own-position state + WorldHandle accessor** — self guid/position are
   conn-internal. Movement needs an authoritative own-position record
   (x/y/z/o/flags/mapId) updated by: login verify, our own sends, teleport
   acks, SMSG_NEW_WORLD.
6. **Speed retention + FORCE\_*_SPEED_CHANGE handlers** — parser reads
   walk/run speed on create blocks (`movement-block.ts:59-60`) but
   `update-object.ts:33-64` drops them; other 7 speeds skipped
   (`movement-block.ts:61`). `SMSG_FORCE_RUN_SPEED_CHANGE`,
   `SMSG_MONSTER_MOVE`, `SMSG_COMPRESSED_MOVES` are no-op stubs
   (`src/wow/protocol/stubs.ts:250-296`). Need: store own run speed (movement
   interpolation), handle all 8 force packets with immediate acks echoing
   counter + exact f32 speed (§2.7 kick).
7. **CMSG_SET_ACTIVE_MOVER** — never sent; send full-guid packet after login
   verify and after each far teleport.
8. **Teleport ack handlers** — MSG_MOVE_TELEPORT_ACK (near: echo counter +
   ticks, adopt dest position) and SMSG_TRANSFER_PENDING/SMSG_NEW_WORLD/
   MSG_MOVE_WORLDPORT_ACK (far). Without these the server drops all movement
   after any teleport (§2.6). Also handle SMSG_FORCE_MOVE_ROOT/UNROOT acks.
9. **Movement tick loop** — 100–250ms interval interpolating position along
   heading at run speed, sending HEARTBEAT while moving; structure as a
   `startMoveLoop` sibling to `startPingLoop` in `client.ts` (owns `conn`,
   cleared in `handle.close()`).
10. **IPC verbs + WorldHandle methods** — e.g. `move x y z`, `stop`, `face o`,
    `pos`. Touch: `IpcCommand` union + parser (`commands.ts`),
    `dispatchCommand`, `WorldHandle` type (`client.ts:187-243`), impl object
    in `login()` (`client.ts:~555+`), and **both** mocks
    (`src/test/mock-handle.ts` + inline mock in `src/daemon/start.test.ts`).
11. Ring buffer + `log.append()` for any new user-visible movement events,
    per existing handler conventions.

Reference clients are no help for sending: wowser sends zero movement and
never answers time-sync (`src/lib/game/handler.js:24-26`; `writePackedGUID` is
a commented-out TODO); wow-chat-client only has the time-sync responder
tuicraft already copied (`src/worldserver/handler/time-sync.ts:6-23`).

---

## 4. namigator integration plan

Repo: `../namigator` @ 54eae69 (namreeb, 2024-07-25) with a configured ninja
build already present under `build/`. `../namigator-rs` (gtker) is the
FFI-consumption reference.

### 4.1 Build artifacts

Everything is compiled **static + PIC** (`CMAKE_POSITION_INDEPENDENT_CODE ON`,
top CMakeLists line 9; global `-DDT_POLYREF64` line 42). Existing artifacts:

```
build/pathfind/liblibpathfind.a      # includes pathfind_c_bindings.o (extern "C")
build/MapBuilder/liblibmapbuild.a    # includes MapBuilder_c_bindings.o
build/MapBuilder/MapBuilder          # CLI executable
build/parser/libparser.a  build/utility/libutility.a  build/stormlib/libstorm.a
build/recastnavigation/Recast/libRecast.a  build/recastnavigation/Detour/libDetour.a
```

No target produces a C-ABI shared object (the pybind modules export only
pybind init symbols). namigator-rs writes **no shim** — it compiles namigator's
own `extern "C"` bindings (`pathfind/pathfind_c_bindings.cpp`,
`MapBuilder/MapBuilder_c_bindings.cpp`) via the `cc` crate.

### 4.2 Chosen FFI route: link existing archives into a .so

Zero new native code — one link command over the PIC archives:

```
g++ -shared -o libnamigator.so \
  -Wl,--whole-archive build/pathfind/liblibpathfind.a build/MapBuilder/liblibmapbuild.a -Wl,--no-whole-archive \
  build/parser/libparser.a build/utility/libutility.a \
  build/recastnavigation/Detour/libDetour.a build/recastnavigation/Recast/libRecast.a \
  build/stormlib/libstorm.a -lstdc++ -lz -lbz2 -pthread
```

`--whole-archive` only on the two libs holding the `extern "C"` symbols. If
`libstorm.a` bundled its own zlib/bz2, drop `-lz -lbz2`. Verify:
`nm -D libnamigator.so | grep pathfind_find_path`.

All C functions return `uint8_t` (0 = SUCCESS) and wrap C++ in try/catch —
exceptions never cross the boundary. Error codes (`Common.hpp`):
BUFFER_TOO_SMALL=82, UNKNOWN_PATH=83, UNKNOWN_HEIGHT=84,
UNKNOWN_ZONE_AND_AREA=85, FAILED_TO_LOAD_ADT=86, MAP_DOES_NOT_HAVE_ADT=87,
UNKNOWN_EXCEPTION=0xFF.

**Symbols for `bun:ffi` dlopen** (headers: `pathfind/pathfind_c_bindings.hpp`,
`MapBuilder/mapbuilder_c_bindings.h`; `Vertex` = 3 packed floats, no padding →
`Float32Array(3*N)`):

```c
pathfind::Map* pathfind_new_map(const char* data_path, const char* map_name, uint8_t* result);
    // NULL on error; data_path = MapBuilder OUTPUT dir, NOT the game Data dir
void pathfind_free_map(Map*);
u8 pathfind_load_all_adts(Map*, int32_t* count);
u8 pathfind_load_adt(Map*, int adt_x, int adt_y, float* out_x, float* out_y);
u8 pathfind_load_adt_at(Map*, float world_x, float world_y, float* out_x, float* out_y);
u8 pathfind_unload_adt(Map*, int x, int y);
u8 pathfind_is_adt_loaded(Map*, int x, int y, uint8_t* loaded);
u8 pathfind_has_adts(Map*, bool* has);
u8 pathfind_get_zone_and_area(Map*, float x, float y, float z, unsigned* zone, unsigned* area);
u8 pathfind_find_path(Map*, float sx, sy, sz, float ex, ey, ez,
                      Vertex* buffer, unsigned buffer_len, unsigned* vertex_count);
u8 pathfind_find_heights(Map*, float x, float y, float* buffer, unsigned len, unsigned* count);
u8 pathfind_find_height(Map*, float sx, sy, sz, float stop_x, stop_y, float* stop_z);
u8 pathfind_line_of_sight(Map*, float sx, sy, sz, float ex, ey, ez, uint8_t* los, uint8_t doodads);
u8 pathfind_find_random_point_around_circle(Map*, float x, y, z, float radius, float* rx, ry, rz);
u8 pathfind_find_point_in_between_vectors(Map*, float distance, float x1,y1,z1, x2,y2,z2, Vertex* out);
// build API exists (mapbuild_build_bvh / mapbuild_build_map /
// mapbuild_bvh_files_exist / mapbuild_map_files_exist) but use the CLI instead
```

`pathfind_find_path` buffer protocol: fits → copies + sets count, returns 0;
too small → sets `*vertex_count` to required size, returns 82 — resize and
retry (namigator-rs starts at 10). **Asymmetry:** `pathfind_find_heights`
returns 82 **without** setting the count — just use a generous fixed buffer
(heights per x,y are a handful). No path = code 83, not empty-success.
Internal cap `MaxPathHops = 4096` polys (`pathfind/Map.hpp:40`). `Map` is
"assumed thread-local" (Map.hpp:32) — Send, not Sync; fine for the
single-threaded daemon.

Mesh **generation** runs as a one-shot CLI subprocess (hours-long, prints
progress) — the daemon only dlopens the pathfind surface.

### 4.3 MapBuilder invocation

```
# 1. BVH pass (model geometry for LoS; do first per mapbuilder_c_bindings.h:19)
MapBuilder -d <WoW-3.3.5a-client>/Data -b -o ~/nav -t 16
# 2. Outland (map id 530)
MapBuilder -d <WoW-3.3.5a-client>/Data -m Expansion01 -o ~/nav -t 16 -l 1
```

Map names are MPQ-internal folder names: `Azeroth` (EK, id 0), `Kalimdor`
(id 1), `Expansion01` (Outland, **id 530**), `Northrend` (id 571),
`development` (test). tuicraft must map SMSG mapId → these names.

- `-g` (gameobject CSV): skip — "unlikely to work" per header.
- **Single-ADT builds (`-x`/`-y`) are compiled only in `_DEBUG` builds**
  (main.cpp:39-44, 91-96) — not available in Release. Strategy instead: build
  the full continent once offline; at runtime load only ADTs near the bot via
  `pathfind_load_adt_at(x, y)` — RAM scales with loaded ADTs, so never
  `load_all_adts` on a continent. (If per-ADT builds become necessary, compile
  MapBuilder as Debug or call `mapbuild_build_map` — but full-map is the
  supported path.)
- Smoke tests build maps without a prior standalone BVH pass and still pass
  `bvh_files_exist` (map builds serialize referenced WMOs/doodads); do the
  `-b` pass anyway for correct gameobject LoS.

Output layout: `<out>/<MapName>.map` (index: 'MAP1' magic, 64×64 ADT bitmap,
WMO/doodad tables); `<out>/Nav/<MapName>/XX_YY.nav` per ADT (`%02d_%02d`,
e.g. `Nav/Expansion01/32_48.nav`; WMO-only maps get a single `Map.nav`);
`<out>/BVH/bvh.idx` + `BVH/{Doodad,WMO}_XXXX.bvh`.

Test fixture: `../namigator/test/test_map.mpq` builds map `"development"` from
data dir `test/` (BVH pass fails FAILED_TO_OPEN_DBC on it — tolerated by
namigator-rs's tests). Known-good query values for our own FFI tests
(`namigator-rs/namigator/src/test.rs`): find_heights(16271.025391,
16845.421875) → [46.301346, 35.611702]; find_path (16303.294922,
16789.242188, 45.219631) → (16200.13648, 16834.345703, 37.028622) ≥ 5 hops;
zone/area = 22.

### 4.4 Coordinate conventions

**namigator's public API consumes/returns raw WoW world coordinates (x, y, z)
exactly as they appear in the protocol — no transform on our side.** All
Recast conversion is internal (`utility/MathHelper.cpp`: `VertexToRecast` =
`{-y, z, -x}`, inverse applied on output, Map.cpp:533-586; `WorldToAdt`:
`adtX = (32*533.333 - Y)/533.333; adtY = (32*533.333 - X)/533.333`).
Confirmed by the namigator-rs doc example feeding live server coords
(-8949.95, -132.493, 83.5312 on "Azeroth" → zone 12 Elwynn). Feed SMSG
positions straight in; feed `find_path` output straight into MovementInfo.

### 4.5 RAM/disk/build-time expectations

**Not documented anywhere in either repo** — README has no numbers,
smoke_tests.py only prints elapsed seconds. Community lore says hours × cores
per continent to build and low-single-digit GB of nav data per continent —
treat as unverified; measure on the Expansion01 build (§5). Mesh params
(`Common.hpp` MeshSettings): TileVoxelSize 112, CellHeight 0.25,
WalkableSlope 50°, AdtSize 533.333. RAM at runtime scales with loaded ADTs
(DT_POLYREF64 tiles) — per-ADT loading around the bot keeps it small.

---

## 5. Open questions / risks

Contradictions already resolved above (AzerothCore source wins over
wow_messages spec in all three, since it's the target server):
fall_time u32-vs-f32 (§1.1); flight speed-ack PackedGuid vs full Guid (§1.5);
CMSG_MOVE_FALL_RESET guid prefix (§1.2).

Remaining unknowns — probe against the live server:

1. **Is CMSG_SET_ACTIVE_MOVER required?** The mover-guid check in
   `HandleMovementOpcodes` compares against the session's active mover; verify
   whether the server initializes it to the player at login or whether
   movement is dropped until SET_ACTIVE_MOVER is sent. Send it regardless;
   confirm behavior in `mise test:live`.
2. **Monster-move packed points**: absolute `coord/4` (wow_messages crate) vs
   midpoint-relative offsets (real-client behavior claim) for non-catmullrom
   splines. Until verified live, only trust the first full Vector3d +
   duration; ignore intermediate packed points.
3. **fall_time semantics while walking**: we always send 0; vanilla captures
   show small nonzero values. AzerothCore only consumes fallTime in the
   `UpdateFallInformationIfNeed` comparison (§2.5) — constant 0 keeps
   `m_lastFallTime >= fallTime` true so apex tracking still updates, but
   confirm no rubber-banding on slopes/short drops in live tests.
4. **Movement rebroadcast sanity**: verify other clients render our bot
   walking (not teleport-stuttering) at a 100–250ms heartbeat cadence with
   linear interpolation; adjust cadence/step size empirically. Server imposes
   nothing (§2.4) — this is purely cosmetic tuning.
5. **libstorm.a zlib/bz2 bundling**: check whether the existing build bundled
   them before deciding on `-lz -lbz2` in the .so link (§4.2). Verify all
   `pathfind_*` symbols with `nm -D` after linking.
6. **Expansion01 build cost**: no authoritative disk/RAM/time numbers exist —
   run the build on t1/openhubris and record actuals in this doc.
7. **namigator-rs submodule pin mismatch**: namigator-rs pins namigator
   @ 7a1b98d, local checkout is @ 54eae69. The C API surface matches the local
   headers we read, but diff the bindings if odd behavior appears.
8. **`pathfind_find_heights` BUFFER_TOO_SMALL bug**: does not report required
   size (§4.2) — always call with a generous buffer; never implement the
   resize-retry loop for heights.
9. **Post-teleport re-init order**: after far teleport, exact order of
   SET_ACTIVE_MOVER / time-sync reset (`ResetTimeSync` fires server-side on
   map add) / first heartbeat needs a live trace to confirm nothing is dropped
   by the STATUS_TRANSFER window (§2.6).
10. **Speed-ack f32 echo precision**: kick fires at >0.01 divergence when the
    acked value exceeds the server's (§2.7). Store and echo the exact f32
    bits received — never recompute from a float64 intermediate. Worth one
    live test with a speed aura (e.g. mount) while moving.

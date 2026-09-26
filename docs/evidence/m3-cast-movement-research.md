# Report: how movement and spellcasting interact on the wire

Method: read-only. AzerothCore server source at
`../azerothcore-wotlk-playerbots`, protocol definitions at
`../wow_messages`, client references at `../wowser` and
`../wow-chat-client`, plus the build-12340 client DBC files (the
`spell_data_dir` set, see `tuicraft:docs/manual.md`) read through
tuicraft's own `src/wow/spell-catalog.ts` decoder. No game client run, no
live tests. Paths below are relative to the repo that holds each file,
unless noted as `tuicraft:` for this repo.

## Q1. Does the server interrupt an in-progress cast when it receives a movement start opcode?

No — not in the movement opcode handler. There is no interrupt call on
that path. Enforcement is deferred and happens through two separate
server-side mechanisms after the movement packet is processed.

The movement path is `HandleMovementOpcodes`
(`src/server/game/Handlers/MovementHandler.cpp:344-396`), which calls
`ProcessMovementInfo` (`MovementHandler.cpp:601-663`), which calls
`HandleMoverRelocation` (`MovementHandler.cpp:412-417`). That function
does exactly two things: `mover->UpdatePosition(movementInfo.pos)` and
`mover->m_movementInfo = movementInfo`. A case-insensitive grep for
`interrupt|cancel` in `MovementHandler.cpp` returns only two hits, both
aura removals unrelated to casting: `AURA_INTERRUPT_FLAG_TURNING` for
vehicle passengers that turn (`MovementHandler.cpp:477-478`) and
`AURA_INTERRUPT_FLAG_LANDING` for parachutes on fall-land / swim-start
(`MovementHandler.cpp:627-636`). `InterruptSpell`,
`InterruptNonMeleeSpells` and `Spell::cancel` appear nowhere in the
file.

What actually stops casts:

(a) Cast-time spells (`CURRENT_GENERIC_SPELL` in `SPELL_STATE_PREPARING`)
are cancelled by polling in `Spell::update`
(`src/server/game/Spells/Spell.cpp:4382-4391`): if the caster is a
player, the spell still has timer left, `m_caster->isMoving()` is true,
the spell's `InterruptFlags` contain `SPELL_INTERRUPT_FLAG_MOVEMENT`
(`SpellDefines.h:26`), and the state is `SPELL_STATE_PREPARING`, the
spell is cancelled — unless it is a next-melee-swing spell, autorepeat,
or triggered. The comment at `Spell.cpp:3535-3536` states the intent:
"don't allow channeled spells / spells with cast time to be casted while
moving (even if they are interrupted on moving, spells with almost
immediate effect get to have their effect processed before movement
interrupter kicks in)".

(b) Channeled spells are interrupted through the position update.
`HandleMoverRelocation` calls `Unit::UpdatePosition`
(`src/server/game/Entities/Unit/Unit.cpp:16051-16068`), which derives a
`relocated` flag from the actual position delta and a `turn` flag from
the orientation delta, then calls `RemoveAurasWithInterruptFlags(mask)`
with `AURA_INTERRUPT_FLAG_MOVE` and/or `AURA_INTERRUPT_FLAG_TURNING`.
That function (`Unit.cpp:5468-5501`) interrupts
`CURRENT_CHANNELED_SPELL` when the spell's `ChannelInterruptFlags`
contain the raised flag (`Unit.cpp:5487-5498`). It never touches
`CURRENT_GENERIC_SPELL`, so this path cannot cancel a cast-time spell.

Two inferences, marked as such. First, `isMoving()` is defined as
`m_movementInfo.HasMovementFlag(MOVEMENTFLAG_MASK_MOVING)`
(`src/server/game/Entities/Unit/Unit.h:1711`), and `m_movementInfo` is
overwritten from the incoming packet (`MovementHandler.cpp:417`), so a
cast-time spell is cancelled as soon as a movement-flagged packet
arrives, even before the position visibly changes. Second, the channel
interrupt goes through `UpdatePosition`, which keys off an actual
position/orientation delta (`Unit.cpp:16058-16059`), so a movement
packet that changes flags but not position would trip (a) but not (b).
Both follow directly from the code cited; neither was observed live.

Net for the tactical loop: "moving cancels casting" is true on the
server, but the canceller is not the movement opcode handler — it is
`Spell::update` polling for cast-time spells and
`RemoveAurasWithInterruptFlags` for channels. A client that moves and
keeps quiet still loses its cast.

## Q2. Is the client expected to send anything?

No cancel opcode is required. The protocol has them and the server
honours them, but the movement path neither requires nor waits for one.

Existence and shape (from `../wow_messages`): `CMSG_CANCEL_CAST =
0x012F` carrying a spell id
(`wow_message_parser/wowm/world/spell/cmsg_cancel_cast.wowm`,
`wowm_language/src/docs/cmsg_cancel_cast.md`);
`CMSG_CANCEL_CHANNELLING = 0x013B` carrying a spell id;
`CMSG_CANCEL_AUTO_REPEAT_SPELL = 0x026D` with an empty body. The server
registers `CMSG_CANCEL_CAST` at
`src/server/game/Server/Protocol/Opcodes.h:333` and
`Opcodes.cpp:434`, handled by `HandleCancelCastOpcode`
(`src/server/game/Handlers/SpellHandler.cpp:552-564`), which interrupts
the matching non-melee spell (and any melee spell). `HandleCancelChanneling`
(`SpellHandler.cpp:651-682`) and `HandleCancelAutoRepeatSpellOpcode`
(`SpellHandler.cpp:644-649`) do the same for their slots.

But nothing on the movement path references these opcodes. The server
interrupts purely on its own state (Q1), so a client cancel can only
pre-empt what the server would do a tick later anyway — e.g. stop its
own cast bar promptly. One corroborating detail: the server comment at
`SpellHandler.cpp:510-517` shows the client re-sends the autoshot cast
opcode during shoot rotation and the server silently drops the
duplicate "to prevent 'interrupt' message" — i.e. the server treats
client cast traffic as advisory and protects its own state from it,
consistent with the server being authoritative here.

Client-reference evidence is negative, and I report it as such.
`../wowser`'s `src/lib/game/opcode.js` defines only server-to-client
spell opcodes (`SMSG_INITIAL_SPELLS`, `SMSG_SPELL_START`,
`SMSG_SPELL_GO`, damage log); a case-insensitive grep for `cancel`
across its `src/lib/game/` returns nothing — it has no cast-cancellation
logic at all. `../wow-chat-client` is chat-only; its only "cast"
mention is in `src/worldserver/handler/update-object.ts` with no cancel
logic. Neither reference shows a client sending cancel alongside
movement.

What I could not determine: whether the retail 3.3.5 client
voluntarily sends `CMSG_CANCEL_CAST` when the player starts moving
(e.g. to hide its cast bar a tick early). No sibling source describes
retail client internals. What is established is that the server does
not need it, so the tactical loop must not depend on observing a
client cancel — it may never arrive.

Minor observation, not load-bearing: the server's cancel handler skips
a leading counter byte (`SpellHandler.cpp:556`, "increments with every
CANCEL packet") while the machine-readable spec shows the body as the
spell id alone. The two disagree on one byte; nothing in this brief
turns on it.

## Q3. Which action categories survive movement, and which do not?

The deciding data are per-spell flags, checked at three gates. Start
gates: `Spell::prepare` (`Spell.cpp:3535-3546`) and `Spell::CheckCast`
(`Spell.cpp:5786-5794`). Survival gate: `Spell::update`
(`Spell.cpp:4382-4391`) for cast-time spells, `Unit::UpdatePosition` →
`RemoveAurasWithInterruptFlags` for channels, and
`Unit::_UpdateAutoRepeatSpell` (`Unit.cpp:4081-4139`) for wand/auto-shot.

Cast-time spells: cannot be STARTED while moving, and do not SURVIVE
movement that begins mid-cast — provided they carry
`SPELL_INTERRUPT_FLAG_MOVEMENT` (`SpellDefines.h:26`). The prepare gate
rejects the start with `SPELL_FAILED_MOVING`; the update poll cancels
the in-progress cast with `cancel(true)`. Both gates require the flag,
so a cast-time spell without it would pass both — inference, supported
by the fact that the codebase ships such an exception deliberately
(e.g. spell 69428/69426 "Icicle" has all interrupt flags zeroed,
`SpellInfoCorrections.cpp:2629`). Exemptions from the update cancel:
next-melee-swing, autorepeat, triggered (`Spell.cpp:4389`).

Instant-cast spells: CAN be started while moving and SURVIVE movement,
with one exception class. The prepare gate only fires for channeled
spells or nonzero cast time, and instants execute inline during prepare
(`Spell.cpp:3662-3663`, `if (!m_casttime ... ) cast(true)`), so the
update poll (which requires `m_timer != 0` and `SPELL_STATE_PREPARING`)
never sees them. The exception: `CheckCast` returns
`SPELL_FAILED_MOVING` while the caster moves for autorepeat spells and
for spells whose `AuraInterruptFlags` contain
`AURA_INTERRUPT_FLAG_NOT_SEATED` (`Spell.cpp:5788-5793`), i.e.
standing-required spells. An instant without that flag is fully
movement-safe.

Channelled spells: can be STARTED while moving only if cast time is
zero AND the spell allows action during channel
(`Spell.cpp:3537-3545`, via `IsActionAllowedChannel()`, defined at
`src/server/game/Spells/SpellInfo.cpp:1293-1296` as channeled plus
`SPELL_ATTR5_ALLOW_ACTION_DURING_CHANNEL`). Do NOT survive movement
that begins mid-channel unless their `ChannelInterruptFlags` lack the
`MOVE` bit: the channel registers its flags in the caster's interrupt
mask on cast (`Spell.cpp:4090/4097`,
`Unit::AddInterruptMask`), the mask is consulted by
`RemoveAurasWithInterruptFlags`, and movement raises the flag through
`UpdatePosition`. Per-spell exceptions exist in both directions in
`SpellInfoCorrections.cpp`: MOVE added (e.g. 34156 "Crystal Channel",
52586 "Krik'thir Mind Flay") and MOVE removed (24322 "Blood Siphon",
76221 "Barrier Channel", the latter also TURNING-free). Turning alone
can break channels carrying `AURA_INTERRUPT_FLAG_TURNING`.

Wand / auto-shoot (autorepeat, `CURRENT_AUTOREPEAT_SPELL`): cannot be
STARTED while moving and do not CONTINUE while moving — except hunter
Auto Shot. Manual start hits the `CheckCast` autorepeat clause
(`SPELL_FAILED_MOVING`); an already-running wand is interrupted every
server tick by the "realtime" check in `_UpdateAutoRepeatSpell`
(`Unit.cpp:4096-4104`, comment: "cancel wand shoot"). Both exemptions
name spell id 75 (`HUNTER_AUTOSHOOT`): hunter autoshot is skipped by
the realtime check and its triggered re-fires bypass the `CheckCast`
gate (`IsTriggered()` is true for them, `Unit.cpp:4129`,
`Spell.cpp:5788`). So on this server core, wand fire stops the tick
movement starts; hunter autoshot does not.

Melee auto-attack: unaffected by movement in either direction. The
complete enumeration of `isMoving()` uses in game code (11 hits) shows
no gate on the melee swing path — the spell-side gates explicitly
exempt `IsNextMeleeSwingSpell`, and the one melee-adjacent hit
(`Unit.cpp:2890`) is parry-arc geometry (skipping moving secondary
attackers when computing a block cone), not an interruption. Melee
continues while moving, subject only to range/facing, which is handled
outside any movement gate (inference on the range/facing part; the
absence of a movement gate is directly verified).

## Q4. What is the authoritative signal that a cast was interrupted?

Three server-to-client packets, all server-originated, so observing
them is observing the outcome rather than inferring it:

- `SMSG_CAST_FAILED` (0x130), caster only (`SendDirectMessage`,
  `Spell.cpp:4639-4648`): refusal at cast START carries
  `SPELL_FAILED_MOVING` (51, `SharedDefines.h:988`); a cast-time cast
  cancelled mid-cast carries `SPELL_FAILED_INTERRUPTED` (40,
  `SharedDefines.h:977`) via `Spell::cancel`'s `PREPARING` branch
  (`Spell.cpp:3685-3687`). Packet shape in
  `wow_message_parser/wowm/world/spell/smsg_cast_failed.wowm`.
- `SMSG_SPELL_FAILURE` (0x133) plus `SMSG_SPELL_FAILED_OTHER` (0x2A6),
  both broadcast (`SendMessageToSet`, `Spell.cpp:5144-5159`), sent by
  `SendInterrupted` on every cancel path with the same result code.
  Shapes in `smsg_spell_failure.wowm` / `smsg_spell_failed_other.wowm`
  (the latter carries caster + spell id only in 3.3.5).
- `MSG_CHANNEL_UPDATE` with time 0, broadcast (`Spell.cpp:5161-5174`):
  marks the end of a channel. Caution: it is also sent on normal
  channel completion (`Spell.cpp:4425`), so a time-0 update alone does
  not prove interruption — correlate it with a same-tick
  `SMSG_SPELL_FAILURE`.
- Wand stop: `InterruptSpell(CURRENT_AUTOREPEAT_SPELL)` sends
  `SMSG_CANCEL_AUTO_REPEAT` to the player (`Unit.cpp:4274-4277`);
  shape in `smsg_cancel_auto_repeat.wowm` (0x29C, target guid in
  3.3.5). Note the server comment at `SpellHandler.cpp:646`
  ("may be better send SMSG_CANCEL_AUTO_REPEAT?") means the
  client-requested cancel handler does NOT send it — only the
  server-side interrupt path does.

What distinguishes movement interruption from other causes: at cast
START, everything — the result is `SPELL_FAILED_MOVING`, which no
other gate produces. After the cast begins, nothing: `Spell::cancel`
always reports `SPELL_FAILED_INTERRUPTED` regardless of cause
(`Spell.cpp:3687/3696/3710`), so a movement cancel is wire-identical
to a counterspell, stun, or self-cancel interrupt. Stated plainly as
requested: post-start, the cause is not observable; only the
start-refusal is movement-specific.

## Q5. Level 10 priest abilities: which are movement-compatible?

Cast types below are established from the 3.3.5 client data itself,
not from memory: `Spell.dbc` + `SpellCastTimes.dbc` from the build-12340
client DBC files, decoded with
`tuicraft:src/wow/spell-catalog.ts` (cast-time index is Spell field 28,
InterruptFlags field 31, AuraInterruptFlags 32, ChannelInterruptFlags
33). Ranks shown are those with `spellLevel <= 10`. No sibling source
carries server-side per-spell cast times (spell timing lives in the
client DBCs; the azerothcore repo holds only code plus flag
corrections for dungeon/boss spells), so the DBC is the authoritative
source here and general game knowledge agrees with it in every case —
no disagreements to report.

Result table (InterruptFlags 15 = 0x0F = MOVEMENT|PUSH_BACK|UNK3|
INTERRUPT; 8 = INTERRUPT only, no MOVEMENT bit):

| Ability | Spell id (rank ≤ 10) | Cast | InterruptFlags | While moving |
|---|---|---|---|---|
| Smite | 585 R1 (1500ms), 591 R2 lvl6 (2000ms) | cast-time | 15, has MOVEMENT | Cannot start; cancelled mid-cast |
| Lesser Heal | 2050 R1 (1500ms), 2052 R2 (2000ms), 2053 R3 lvl10 (2500ms) | cast-time | 15, has MOVEMENT | Cannot start; cancelled mid-cast |
| Shadow Word: Pain | 589 R1, 594 R2 lvl10 | instant (0ms) | 8, no MOVEMENT | Startable and survives |
| Power Word: Shield | 17 R1 | instant (0ms) | 8, no MOVEMENT | Startable and survives |
| Renew | 139 R1 | instant (0ms) | 8, no MOVEMENT | Startable and survives |
| Power Word: Fortitude | 1243 R1 | instant (0ms) | 8, no MOVEMENT | Startable and survives |
| Wand (Shoot) | 5019 (autorepeat: attr2 `SPELL_ATTR2_AUTO_REPEAT` = 0x20; attr0 includes `USES_RANGED_SLOT`) | autorepeat | 15 | Cannot start; stopped by the realtime check |
| Melee | n/a (no spell) | — | — | Unaffected |

Notes: none of these spells is channelled (no `SPELL_ATTR1_IS_CHANNELED`
0x04 / `IS_SELF_CHANNELED` 0x40 in any listed rank; all
`ChannelInterruptFlags` are 0) and none carries
`AURA_INTERRUPT_FLAG_NOT_SEATED`, so the instant-cast exception class
from Q3 does not touch this list — every instant above is fully
movement-safe by the source rules. A level 10 priest therefore has no
channelled ability in scope at all (Mind Flay is level 20+ and was not
assessed). The movement-compatible set is: Shadow Word: Pain, Power
Word: Shield, Renew, Power Word: Fortitude, and melee. Smite, Lesser
Heal, and wand fire require standing still. Consequence for the lease
design: the judgment model may offer the four instants plus melee as
move-compatible candidates; Smite / Lesser Heal / Shoot must either
cancel the movement lease or wait for it to lapse.

## COMPLETE

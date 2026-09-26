# M1 evidence: target selection and clearing, verified live

Live-verified against the real server via `./dist/tuicraft` built from commit
`52587cc3c4212c1c1a43cf4a5421ca6ef538abbe`, 2026-09-26 (times below are UTC).
Two throwaway eversong10 characters at Fairbreeze Village, map 530:

| Role | Character | GUID | Level | Account (deleted after the run) |
| --- | --- | --- | --- | --- |
| A, actor | Fgklhcejnoo | `0xa2f` | 10 | FAC6AB7249DEE |
| B, player to target | Fgklhcejoab | `0xa30` | 10 | FAC6AB7249E01 |

Each character ran its own daemon with its own XDG directories. Every command,
its raw stdout/stderr, exit code and start time is in
[target-selection-2026-09-26.json](target-selection-2026-09-26.json) as an
ordered `steps` array (63 steps), together with the matching lines from A's
`session.log`.

All `src/…` line references in this file are to commit `52587cc`, the binary
under test. Later commits have changed some of that code; see the dead
creature section.

Two fields of `control --json` are compared throughout:

- `requestedTarget`: the GUID the client last sent in `CMSG_SET_SELECTION`
  (`ControlRuntime.selectTarget`, `src/wow/control.ts:248-253`).
- `target`: A's own `UNIT_FIELD_TARGET`, as the server reports it.

The text form of `control` prints the same pair as
`target observed=<target> requested=<requestedTarget>`.

## Summary

| Case | Requested | Observed | Outcome |
| --- | --- | --- | --- |
| Creature (Magistrix Landra Dawnstrider, 6.98 yd) | `0xf130003f520009e5` | `0xf130003f520009e5` | Accepted and echoed by the server |
| Clear after creature | `0x0` | `0x0` | Cleared |
| Player B | `0xa30` | `0xa30` | Accepted and echoed; B also saw it |
| Clear after player | `0x0` | `0x0` | Cleared |
| Malformed: `0xzz`, 2^64, `-1`, `0x`, empty, missing, `1.5`, extra argument | not sent | unchanged (`0x0`) | Refused at argument parsing, exit 1, `invalid guid` |
| Never-observed GUID `0xf1300000000000ff` | `0xf1300000000000ff` | `0xf1300000000000ff` | **Not refused at `target`**; refused downstream |
| Player B after B logged out | `0xa30` | `0xa30` | **Not refused at `target`**; refused downstream |
| Dead creature (Springpaw Stalker corpse) | `0xf130003d2307737d` | `0xf130003d2307737d` | **Not refused at `target`**; refused downstream |
| Same creature after it despawned | `0xf130003d2307737d` | `0xf130003d2307737d` | **Not refused at `target`**; refused downstream |

Timing of the target and clear requests that were sent:

- Daemon side, from the `target_requested` line to the next `target_observed`
  line in `session.log`: 14 ms to 64 ms over 14 requests.
- Client side, from just before the `target` command to the first
  `control --json` poll that showed the observed value: 39 ms to 128 ms over
  the 12 requests that were polled. This
  includes CLI process start-up for each poll, so it is an upper bound, and
  its resolution is one poll interval (about 70 ms).

## Creature target and clear (steps 3-7)

Baseline after login (step 3):

    $ ./dist/tuicraft control
    ...
    target observed=none requested=none

`nearby --json` (step 5) listed B at 0 yd and Magistrix Landra Dawnstrider
`0xf130003f520009e5` (level 12, faction template 1604) at 6.98 yd.

    01:49:41.136Z $ ./dist/tuicraft target 0xf130003f520009e5
    Daemon accepted request. No server result confirmed.

The first `control --json` poll, 54 ms after the command started, already
showed `"requestedTarget":"0xf130003f520009e5"` and
`"target":"0xf130003f520009e5"`. The text form then printed:

    target observed=0xf130003f520009e5 requested=0xf130003f520009e5

`session.log` lines 47-48: `target_requested` then `target_observed` 34 ms
later. B's `nearby --json`, taken 4.5 s later, listed A's `target` as
`0xf130003f520009e5`.

    01:49:45.725Z $ ./dist/tuicraft target 0
    Daemon accepted request. No server result confirmed.

The first poll (38 ms) showed `requestedTarget` `0x0` while `target` was still
`0xf130003f520009e5`; the second poll (108 ms) showed both `0x0`. Text form:
`target observed=0x0 requested=0x0`. Daemon latency 28 ms (lines 51-52).

Note on representation: before any request both fields are `null` (text
`none`); after a clear both are `"0x0"`.

## Player target and clear (steps 8-11)

    01:49:58.794Z $ ./dist/tuicraft target 0xa30
    Daemon accepted request. No server result confirmed.

Poll at 38 ms: requested `0xa30`, observed `0x0`. Poll at 109 ms: both
`0xa30`. Daemon latency 25 ms. B's `nearby --json` listed A's target as
`0xa30`. `target 0` then cleared both to `0x0` (109 ms by poll, 34 ms daemon
side).

The `--json` form reports intent only:

    $ ./dist/tuicraft target 0xa30 --json
    {"command":"target","data":null,"error":null,"events":[],"kind":"intent"}

## Malformed GUIDs (steps 12-20)

Every case below exited 1 with `invalid guid` on stderr, and `control --json`
showed `requestedTarget` and `target` unchanged at `0x0` 0.3 s later:

    $ ./dist/tuicraft target 0xzz
    invalid guid
    $ ./dist/tuicraft target 18446744073709551616
    invalid guid
    $ ./dist/tuicraft target -1
    invalid guid
    $ ./dist/tuicraft target -- -1
    invalid guid

The same happened for `0x`, an empty string, no argument, `1.5` and
`0xa30 extra`. With `--json`:

    {"command":"target","data":null,"error":{"message":"invalid guid","stage":"arguments"},"events":[],"kind":"error"}

## Stale and unobserved GUIDs

**Finding: the `target` command refused none of the four stale GUIDs.** In
every case the CLI printed `Daemon accepted request. No server result
confirmed.`, the daemon sent the selection, and the server wrote the GUID into
A's `UNIT_FIELD_TARGET` within 28-59 ms (daemon side). This agrees with the source:
`ControlRuntime.selectTarget` rejects only negative values, and AzerothCore
`WorldSession::HandleSetSelectionOpcode` calls `Player::SetSelection`, which
sets the field without checking that the GUID exists
(`src/server/game/Handlers/MiscHandler.cpp:534`,
`src/server/game/Entities/Player/Player.cpp:11578` in the local
azerothcore-wotlk-playerbots checkout). Refusal happened only in later
commands, as listed per case.

### Never-observed GUID `0xf1300000000000ff` (steps 21-38)

    01:50:15.247Z $ ./dist/tuicraft target 0xf1300000000000ff
    Daemon accepted request. No server result confirmed.
    ...
    target observed=0xf1300000000000ff requested=0xf1300000000000ff

Observed after 116 ms by poll, 59 ms daemon side; B also listed A's target as
`0xf1300000000000ff`. Downstream:

    $ ./dist/tuicraft face-guid 0xf1300000000000ff
    ERR target_not_observed
    $ ./dist/tuicraft walk-toward 5 0xf1300000000000ff
    {"status":"stopped","reason":"target_not_observed","traveled":0,...}
    $ ./dist/tuicraft fight 0xf1300000000000ff --json
    {"command":"fight","data":null,"error":{"message":"target_not_pve_creature","stage":"command"},"events":[],"kind":"error"}
    $ ./dist/tuicraft attack 0xf1300000000000ff --json
    {"command":"attack","data":null,"error":null,"events":[],"kind":"intent"}
    $ ./dist/tuicraft cast 589 0xf1300000000000ff --json
    {"command":"cast","data":null,"error":null,"events":[],"kind":"intent"}

- `walk-toward ... --json` gave only
  `"message":"walk stopped without completion"`; the text form above names
  the reason.
- The first `fight` attempt returned `missing_jev_key` because A's daemon had
  been started without `TYPESAFE_API_KEY` in its environment. A was stopped
  and restarted with the key (steps 32-33), and the `fight` output above is
  from after the restart.
- `cast 589` (Shadow Word: Pain) was accepted as intent. The server answered
  with cast failure result 12, which is `SPELL_FAILED_BAD_TARGETS` in
  AzerothCore `SharedDefines.h` (`session.log` line 121).
- `attack` was accepted as intent. The server's reply failed to parse; see
  "Suspected bug" below.

After the restart, before any new request, the text form read
`target observed=0xf1300000000000ff requested=none`: the server still reported
the made-up GUID as A's target after relogin.

### Player B after logout (steps 39-48)

A targeted B (`0xa30`, observed in 112 ms), then B's daemon was stopped at
01:51:29.4Z. B stayed in A's `nearby` list for about 61 s after that; while it
was listed, and after it left, A's observed target stayed `0xa30`. A cleared
the target, then targeted `0xa30` again:

    01:52:38.556Z $ ./dist/tuicraft target 0xa30
    Daemon accepted request. No server result confirmed.
    ...
    target observed=0xa30 requested=0xa30

Downstream: `face-guid` gave `target_not_observed`, `walk-toward --json` gave
the generic failure, `fight` gave `target_not_pve_creature`, and `cast 589`
was accepted as intent, then refused by the server with result 12 (line 139).
`fight` refuses every player GUID with `target_not_pve_creature`, so here that
refusal does not depend on the GUID being stale.

### Dead creature (steps 49-54)

The attempt to walk to the Springpaw Stalker area stopped twice with
`height_unresolved` (not in `steps`; see `omittedFromSteps`). From the second
stop, A observed a Springpaw Stalker corpse `0xf130003d2307737d` at 98.93 yd:
health 0/120, level 6, faction template 38. A never attacked it before this
point, so another character killed it (inference; the kill is not in A's
record).

    01:53:59.851Z $ ./dist/tuicraft target 0xf130003d2307737d
    Daemon accepted request. No server result confirmed.
    ...
    target observed=0xf130003d2307737d requested=0xf130003d2307737d

Downstream:

    $ ./dist/tuicraft face-guid 0xf130003d2307737d --json
    {"command":"face-guid","data":null,"error":{"message":"target_stale","stage":"command"},"events":[],"kind":"error"}
    $ ./dist/tuicraft fight 0xf130003d2307737d --json
    {"command":"fight","data":null,"error":{"message":"target_dead","stage":"command"},"events":[],"kind":"error"}

In build `52587cc`, `target_stale` meant that the corpse's last motion
observation was more than 5 s old (`src/wow/runtime.ts:205-210` at that
commit). It was not a death check. `e604028` ("fix: Keep idle creatures
targetable") removed that 5 s check after this run. Target lookup
(`src/wow/observed-target.ts`) no longer looks at motion age: it needs the
GUID in the entity store with a finite position on the character's map, and
a supported motion if one is observed. So on current `main`, `face-guid` on this
corpse would no longer answer `target_stale`. `attack`
was accepted as intent. The server answered with `SMSG_ATTACKSTOP` naming the
corpse, which parsed, and `combat` recorded
`lastOutcome {"kind":"attack","status":"succeeded"}` (line 170). `cast 589`
was accepted as intent and refused by the server with result 12 (line 172).

### Despawned creature (steps 55-62)

The corpse left A's observed set (`ENTITY_DISAPPEAR`) about 12 s after polling
began. A's observed target stayed `0xf130003d2307737d`. After `target 0`,
targeting it again at 01:55:01.505Z was accepted and echoed (112 ms by poll, 32 ms daemon
side). Downstream: `face-guid` gave `target_not_observed`, `walk-toward --json`
gave the generic failure, and `fight` gave `target_not_pve_creature`. `attack`
was accepted as intent, and its reply produced the same parse failure again
(line 186). `cast 589` was accepted as intent and refused by the server with
result 12 (line 189).

## Suspected bug: SMSG_ATTACKSTOP without a victim fails to parse (#185)

When `attack` names a GUID the server cannot resolve, AzerothCore
`HandleAttackSwingOpcode` calls `SendAttackStop(nullptr)`
(`src/server/game/Handlers/CombatHandler.cpp`). That function writes only the
attacker packed GUID. It writes the victim packed GUID and the `uint32` dead
flag only when there is a victim (`CombatHandler.cpp:84-95`).
`parseAttackStop` (`src/wow/protocol/combat.ts:35-41`) always reads all three
fields. A's `session.log` recorded, at lines 69-70 (two entries, same
timestamp) and 186:

    {"data":{"error":"Out of bounds access","opcode":324,"type":"packet_error"},"type":"PACKET",...}

Opcode 324 is `0x144`, `SMSG_ATTACKSTOP` (`src/wow/protocol/opcodes.ts:362`).
Consequence observed: `combat --json` kept
`"pendingAttack":"0xf1300000000000ff"` with `"attacking":false` until
`stop-attack` was sent (steps 28, 30-31). The same reply naming a real victim
(the corpse case) parsed without error.

## Limits

- The record shows the requested and observed selection, not what the
  selection is used for. No target in this run was fought or damaged.
- The latency figures come from one session, from a stationary character
  within 7 yd of the creature and 0 yd of B. They are not a distribution
  under load.
- B's view of A's target field was captured for the creature, player and
  never-observed cases only.
- It is an inference that B stayed visible for about 61 s after `stop`
  because the server keeps a disconnected character in the world for a
  period. The record shows only the timing.
- The "dead creature" case used a corpse that A did not kill, at 98.93 yd.
  Its GUID was observed but its motion was more than 5 s old, which is why
  `face-guid` reported `target_stale` in build `52587cc`, not a distance or
  death reason. `e604028` removed that 5 s check after this run, so current
  `main` would not answer `target_stale` here.
- `attack` and `cast` report intent only. Server refusal is shown by
  `combat` state and `session.log` lines, not by the command's exit code.

# Live fault-path proof: plan

Date: 2026-09-21. Condensed 2026-09-24; the full text is at `9c47b07`.

Milestone 1 closes its last gap: the fault paths covered only by protocol or
daemon regressions get live-server evidence. Transport and flight defer (see
below).

## Fixture disclosure

Triggers use GM chat commands on the dedicated test accounts (`.tele`,
`.gps`, `.freeze`, `.unfreeze`, `.appear`, `.go xyz`). The accounts already
carry GM privilege. GM commands are the environment fixture, the way a test
harness spawns a mob. What is under test is the client's behavior when the
server forces movement, denies control, or answers queries under
cancellation. No server data is edited, no session is repaired mid-scenario,
and every trigger is visible in the test source. Position truth comes from
`.gps` system messages parsed from the client's own stream.

`.appear` and `.go xyz` are suite hygiene. The two proximity tests in
`live.ts` never positioned the characters and were observed failing 1661 yards
apart. Each now calls `.appear` first, and S1 restores its starting position
with `.go xyz` in a `finally` block.

## Scenarios and acceptance

- **S1, forced teleport, same map.** `.tele FairbreezeVillage` from Silvermoon
  City after a peace pre-check. Expect `.gps` displacement over 100 yards on
  map 530, no control errors, a clean STATUS and a working MOVE once settled.
- **S2, freeze denies control, then releases.** `.freeze` on self. During the
  freeze a MOVE must refuse or produce no displacement (`.gps` decides). After
  `.unfreeze` a MOVE returns OK. The client is not expected to refuse locally.
- **S3, transport.** Deferred (below).
- **S4, held WHO meets HALT.** Pipeline `WHO` and `HALT` on one socket. Both
  responses are sane, STATUS stays CONNECTED, no `ERR internal`, and a later
  SAY returns OK.

## Outcome

Committed as `test: Prove fault paths on the live server`. S1, S2 and S4
passed in every full live run on 2026-09-21: the teleport moved the character
over 100 yards with no control error, the freeze held drift under 1.5 yards
and `.unfreeze` restored movement, and the pipelined WHO and HALT both
answered sanely.

## Deferred with reasons

Transport needs a client capability that does not exist.
`MovementHandler.cpp:419` boards a passenger only inside
`if (HasMovementFlag(MOVEMENTFLAG_ONTRANSPORT))`, using the transport GUID the
client supplies. `ControlRuntime` never sets `MovementFlag.ON_TRANSPORT`, so no
fixture reaches the scenario. Boarding belongs to a milestone that owns it.

Flight needs NPC gossip, taxi nodes, a fare and known nodes the test accounts
lack. Knockback-strength spells one-shot a level-1 character. Both stay
regression-covered until those prerequisites exist.

# Live fault-path proof: plan

Date: 2026-09-21. Milestone 1 closes its last gap: the four fault paths
currently covered only by protocol or daemon regressions get live-server
evidence. Flight defers (see below).

## Fixture disclosure

Triggers use GM chat commands on the dedicated test accounts (`.tele`,
`.gps`, `.freeze`, `.unfreeze`, `.appear`, `.go xyz`). The accounts
already carry GM privilege; `.gps` execution proved it. GM commands are
the environment fixture, the way a test harness spawns a mob. What is
under test is the client's protocol behavior when the server forces
movement, denies control, or answers queries under cancellation. No
server data is edited, no session is repaired mid-scenario, and every
trigger is visible in the test source. Position truth comes from `.gps`
system messages, parsed from the receiving client's own stream.

`.appear` and `.go xyz` are suite hygiene rather than scenario triggers.
The two proximity tests elsewhere in `live.ts` assert on SAY range and
the visibility grid but never positioned the characters, so they passed
or failed on wherever a previous run happened to leave them; they were
observed failing with the characters 1661 yards apart. Each now calls
`.appear` on the other character first. S1 correspondingly restores its
recorded starting position with `.go xyz` in a `finally` block, so a
teleport scenario no longer displaces the character for everything that
runs after it.

## Scenarios and acceptance

### S1: forced teleport, same map

`.tele FairbreezeVillage` from Silvermoon City after a peace pre-check
(stable health, not attacking; teleports refuse while fighting).
`.recall` is not used: the test character has no home bind, so recall is
a no-op. Expect server-driven relocation on map 530 through the
teleport-ack path: `.gps` displacement over 100 yards, no control
errors, clean STATUS after, and a working MOVE once settled. No
assertion on mid-teleport MOVE; that window is too short to catch
deterministically.

### S2: freeze denies control, then releases

`.freeze` on self at Fairbreeze Village after S1: no damage, no combat,
fully reversible with `.unfreeze`, needs no target. Hostile spells were
tried first and cannot self-target even triggered (BAD_TARGETS); Frost
Nova roots only enemies, never the caster. During the freeze a MOVE must
either refuse or produce no displacement; `.gps` decides. After
`.unfreeze` a MOVE must return OK with no stuck control error. The
freeze is server-side silent as far as observed: the client is not
expected to refuse locally, which exercises the prediction-versus-
observation distinction rather than local block detection.

### S3: transport carries an idle character

Deferred. See below.

### S4: held WHO meets HALT

Inline daemon server over a live handle. Pipeline `WHO` and `HALT` on
one socket so HALT can land while the WHO is outstanding. Assert both
responses are sane, STATUS stays CONNECTED, no `ERR internal`, and a
follow-up SAY returns OK. The exact mid-flight interleave stays
mock-covered by the existing held-WHO regressions; this proves live
cancellation hygiene with deterministic assertions.

## Deferred with reasons

Transport needs a client capability that does not exist, so no fixture
reaches it. `MovementHandler.cpp:419` boards a passenger only inside
`if (HasMovementFlag(MOVEMENTFLAG_ONTRANSPORT))`, using the transport
GUID the client itself supplies; AzerothCore runs no server-side
collision check that boards a walking player. `ControlRuntime` never
sets `MovementFlag.ON_TRANSPORT`, so `blockedReason` stays undefined
however long the character edges around the deck, and a live run spends
its 900-second budget to prove only that. Boarding is a real movement
capability and belongs in a milestone that owns it, not smuggled into a
fault-path proof. The scenario returns once the client can declare
transport movement, and its acceptance text above stands unchanged.

Flight needs NPC gossip dialogs, taxi node handling, a fare the test
accounts cannot pay, and known nodes they lack. That is an M5 slice plus
account funding, not a fault-path proof. Knockback-strength spells
one-shot a level-1 character, so knockback stays regression-covered
until a durable character exists. Both re-open when those prerequisites
land; neither blocks milestone 1.

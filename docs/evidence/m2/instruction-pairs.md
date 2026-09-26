# M2: replicating the standing-instruction contrast (issue #181)

Encounters 04 and 05 were one pair, one run per instruction. The README
calls that pair suggestive and unreplicated. This file adds six more pairs,
twelve encounters, run live on 2026-09-26. It also reads 04 and 05 again as
pair 0 with the same script.

## Method

**Character.** One new eversong10 account, `FAC6AB724C926`, character
`Fgklhcemjcg` (`0xa31`). The character is a level 10 priest on map 530. It
had 217 health and 607 mana (base mana 272). Encounters 04 and 05 used Xiara,
also a level 10 priest, with 187 health and 547 mana. The class is the same,
but the character is different. The account was deleted after the runs.

**Creatures.** Every encounter was against a Springpaw Stalker (entry 15651,
faction template 38), as in 04 and 05. None of the runs used a Crazed
Dragonhawk. The first two encounters ran north-west and north of Fairbreeze Village. The
other ten ran south-east of it, from about (8800, -6720) to (8990, -6810).

**Comparable.** Here, "comparable" means: the same creature type; a creature
at level 6 or 7; the character at level 10 with full health and mana; and a
start at about the same separation. Before every encounter the character was
out of combat, and `combat --json` showed exactly 217/217 health and 607/607
mana. The character stayed at level 10 through all twelve encounters, with
no level-up. Pairs 2, 3, 4 and 6 matched level 6 against level 6. Pair 5
matched level 7 against level 7. Pair 1 is mismatched: A fought a level 6
and B fought a level 7, because no second level 6 was in range.

**Order.** The order was counterbalanced. Pairs 1, 3 and 5 ran A then B.
Pairs 2, 4 and 6 ran B then A.

**Instructions.** Each instruction was passed explicitly as the trailing
words of `./dist/tuicraft fight <guid> <text>`, without `--framing`. Every
record shows `promptVariant: none`.

- A: `defeat the selected target while keeping the character alive`
- B: `Conserve mana for several encounters. Favor efficient damage and use weapon attacks when useful. Keep enough health to survive safely.`

The measurement script asserts that each new record carries the exact text
for its condition.

**Supervision.** The supervising agent chose each creature from
`nearby --json`. It walked in short `face` and `move forward` legs to about
20 to 26 yards (operator `nearby` distance; the p1-a approach stopped at 19.9
yards). It then issued `face-guid` and `fight`. It gave no command during a
fight. The records cannot prove a negative, so this rests on the operator's
account.

**Distillation.** Each run was distilled with
`mise evidence:encounter <runId> none` while the account's XDG environment
was exported. For every file, the runId, the instruction text and the
outcome were checked against the `tactics --json` state at the end of the
run.

**Code.** All twelve encounters used the same `./dist/tuicraft` binary, built
2026-09-26 01:48:16 UTC, before the first encounter. The records do not
record its source revision. The model was `jev-1.13.0` in every record.
Compared with 04 and 05, the offered kit now includes directional movement
(`move_forward`, `move_backward`, `strafe_left`, `strafe_right`,
`stop_moving`). This is a code difference between pair 0 and pairs 1 to 6.
Pair 0 is therefore not strictly comparable with the new pairs.

## Records

| Pair | Order | A record | B record | Target level A / B |
|------|-------|----------|----------|--------------------|
| 0 | A, B | [encounter-04](encounter-04.json) | [encounter-05](encounter-05.json) | 6 / 6 |
| 1 | A, B | [pair-01-a](pair-01-a.json) | [pair-01-b](pair-01-b.json) | 6 / 7 |
| 2 | B, A | [pair-02-a](pair-02-a.json) | [pair-02-b](pair-02-b.json) | 6 / 6 |
| 3 | A, B | [pair-03-a](pair-03-a.json) | [pair-03-b](pair-03-b.json) | 6 / 6 |
| 4 | B, A | [pair-04-a](pair-04-a.json) | [pair-04-b](pair-04-b.json) | 6 / 6 |
| 5 | A, B | [pair-05-a](pair-05-a.json) | [pair-05-b](pair-05-b.json) | 7 / 7 |
| 6 | B, A | [pair-06-a](pair-06-a.json) | [pair-06-b](pair-06-b.json) | 6 / 6 |

All twelve new encounters completed with `server_kill_credit`. None has a
transport error. One record, pair-01-b, has one discarded decision:
`{actionId: cancel, reason: unavailable}`. No attempt failed or was aborted,
so the set has no failed-attempt records.

The character died twice between encounters, both times after the pair 4 B
kill. The first death came while it waited after walking up to the pair 4 A
target. The second came about 33 seconds after it reclaimed its corpse at
the same place. The character had no tactics run and no attack active in
either case. The session log shows health falling from 217 to 88 to 74 to 5
and then 0, with `attack_stopped` events and no identified attacker. In the one
`nearby` check made after the first death, no entity had the character as
its target. The cause is not known.
Neither death is part of any encounter. Recovery (release, corpse query,
walk back, reclaim) completed both times. The character then waited out of
combat until health and mana were full before pair 4 A started.

Start and end state from operator `combat --json` readings (not in the
records):

| Run | Start HP/mana | End HP/mana | Record elapsed ms |
|-----|---------------|-------------|-------------------|
| 1 A | 217/607 | 211/497 | 7097 |
| 1 B | 217/607 | 163/509 | 16718 |
| 2 B | 217/607 | 203/524 | 16103 |
| 2 A | 217/607 | 217/435 | 8786 |
| 3 A | 217/607 | 217/403 | 11180 |
| 3 B | 217/607 | 199/518 | 14032 |
| 4 B | 217/607 | 200/519 | 13855 |
| 4 A | 217/607 | 217/403 | 10763 |
| 5 A | 217/607 | 217/379 | 13082 |
| 5 B | 217/607 | 173/607 | 17148 |
| 6 B | 217/607 | 183/566 | 13332 |
| 6 A | 217/607 | 217/403 | 10747 |

The end readings were taken immediately after `fight` returned. They include
any mana regenerated during the fight, so they are not a clean cost
measurement.

## Measurement

The measurement script is committed as
[instruction-pairs-measure.py](instruction-pairs-measure.py); run it from
the repository root. Tables T1, T2, T3 and T5 come from the distilled
records only. T4 is marked RAWLOG: it comes from
[instruction-pairs-rawlog.json](instruction-pairs-rawlog.json), a reduced
slice of the account's session log holding, per run, each request's
`observation.separation` and every `cast_succeeded` and `cast_interrupted`
combat event inside the run's window. The distilled records have no
separation field and no server cast outcomes. For pair 0 no raw log was
available, so T4 shows it as "not recorded".

Definitions:

- Applied choice: a decision with `applied: true`.
- Opener: the first applied choice that is not `wait` or `face`.
- `firstDamage`: the first applied `:target` spell or `attack`.
- `cost%base`: the sum over applied spell choices of each spell's
  `costPercentageOfBaseMana` from the build-12340 spell data. The values are
  Smite R1 585 = 9, Smite R2 591 = 12, Mind Blast 8092 = 17, Power Word:
  Shield 17 = 23. Using percent of base mana lets the two characters be
  compared.
- `succeededCost%base`: the same sum over casts that the server reported as
  succeeded.
- Buckets: as in the README. Forced is a row whose offered set is exactly
  `wait` and `cancel`. Full-kit genuine is a row that offers a spell,
  `attack` or `face`. `wait_stopattack` is a row that offers only `wait` and
  `stop_attack`. The new kit needs a fourth bucket, `movement_only`: rows
  that offer movement (and perhaps `stop_attack`) but no spell, attack or
  face.

Exact output of `python3 docs/evidence/m2/instruction-pairs-measure.py`:

```text
T1 per encounter, applied choices (from records)
pair|cond|ord|file|tgtLvl|dec|appl|opener|firstDamage|PWS17|MB8092|Smite585|Smite591|attack|cancel|moves|manaCasts|cost%base
0|A|1|encounter-04|6|51|48|attack|attack|1|0|5|0|1|0|0|6|68
0|B|2|encounter-05|6|65|58|attack|attack|0|0|5|0|1|0|0|5|45
1|A|1|pair-01-a|6|29|28|spell:8092:target|spell:8092:target|0|1|0|2|0|0|1|3|41
1|B|2|pair-01-b|7|64|57|spell:8092:target|spell:8092:target|0|1|8|0|0|5|0|9|89
2|B|1|pair-02-b|6|63|59|spell:8092:target|spell:8092:target|0|3|6|0|1|6|0|9|105
2|A|2|pair-02-a|6|36|34|spell:17:self|spell:8092:target|1|1|0|2|1|0|4|4|64
3|A|1|pair-03-a|6|46|43|spell:17:self|spell:8092:target|1|1|0|3|0|0|5|5|76
3|B|2|pair-03-b|6|54|51|spell:591:target|spell:591:target|0|1|5|1|1|4|0|7|74
4|B|1|pair-04-b|6|53|50|cancel|spell:8092:target|0|1|5|0|1|3|0|6|62
4|A|2|pair-04-a|6|41|39|spell:17:self|spell:8092:target|1|1|0|2|0|0|5|4|64
5|A|1|pair-05-a|7|52|51|spell:17:self|spell:8092:target|1|1|1|3|1|0|5|6|85
5|B|2|pair-05-b|7|61|60|spell:8092:target|spell:8092:target|0|2|7|0|1|8|0|9|97
6|B|1|pair-06-b|6|48|47|spell:8092:target|spell:8092:target|0|1|6|0|1|5|0|7|71
6|A|2|pair-06-a|6|42|38|spell:17:self|spell:8092:target|1|1|0|3|0|0|5|5|76

T2 per encounter, decision buckets (from records)
pair|cond|forced|wait_stopattack|movement_only|fullkit
0|A|37|5|0|9
0|B|56|0|0|9
1|A|25|0|1|3
1|B|46|0|8|10
2|B|41|0|12|10
2|A|26|0|5|5
3|A|35|0|6|5
3|B|35|0|10|9
4|B|32|0|13|8
4|A|31|0|5|5
5|A|40|0|5|7
5|B|36|0|14|11
6|B|37|0|3|8
6|A|32|0|5|5

T3 per encounter, mean probability when offered (n rows) (from records)
pair|cond|spell:8092:target|spell:17:self|spell:585:target|spell:591:target|attack|cancel|forced
0|A|0.210 (3)|0.143 (3)|0.360 (8)|0.134 (8)|0.330 (1)|0.053 (37)
0|B|0.043 (9)|0.043 (9)|0.373 (9)|0.074 (9)|0.730 (1)|0.366 (56)
1|A|0.350 (1)|0.130 (3)|0.100 (3)|0.360 (3)|-|0.074 (25)
1|B|0.128 (4)|0.041 (10)|0.300 (10)|0.110 (10)|0.710 (1)|0.421 (46)
2|B|0.258 (4)|0.045 (10)|0.262 (10)|0.093 (10)|0.720 (1)|0.424 (41)
2|A|0.315 (2)|0.260 (1)|0.124 (5)|0.256 (5)|0.430 (1)|0.076 (26)
3|A|0.295 (2)|0.340 (1)|0.092 (5)|0.300 (5)|0.355 (2)|0.080 (35)
3|B|0.172 (4)|0.038 (9)|0.286 (9)|0.120 (9)|0.690 (1)|0.430 (35)
4|B|0.253 (3)|0.035 (8)|0.285 (8)|0.094 (8)|0.730 (1)|0.431 (32)
4|A|0.340 (2)|0.320 (1)|0.090 (5)|0.266 (5)|0.390 (2)|0.086 (31)
5|A|0.450 (1)|0.470 (1)|0.122 (6)|0.322 (6)|0.400 (3)|0.084 (40)
5|B|0.182 (5)|0.046 (11)|0.234 (11)|0.097 (11)|0.730 (1)|0.452 (36)
6|B|0.160 (3)|0.041 (8)|0.304 (8)|0.094 (8)|0.710 (1)|0.430 (37)
6|A|0.375 (2)|0.340 (1)|0.088 (5)|0.293 (5)|0.367 (2)|0.085 (32)

T4 per encounter, RAWLOG (instruction-pairs-rawlog.json, not in records)
pair|cond|sepStart|sepAtFirstDamage|sepMin|serverSucceeded|serverInterrupted|succeededCost%base
0|A|not recorded|-|-|-|-|-
0|B|not recorded|-|-|-|-|-
1|A|23.8|23.8|3.5|{"591": 2, "8092": 1}|{}|41
1|B|18.5|18.5|3.5|{"585": 3, "8092": 1}|{"585": 5}|44
2|B|25.5|25.5|3.5|{"585": 2, "8092": 1}|{"8092": 2, "585": 4}|35
2|A|25.0|21.4|3.5|{"17": 1, "591": 2, "8092": 1}|{}|64
3|A|26.6|19.6|3.5|{"17": 1, "591": 3, "8092": 1}|{}|76
3|B|24.1|24.1|3.5|{"585": 2, "8092": 1}|{"591": 1, "585": 3}|35
4|B|23.6|23.3|2.2|{"585": 2, "8092": 1}|{"8092": 1, "585": 3}|35
4|A|24.8|18.3|3.5|{"17": 1, "591": 3, "8092": 1}|{}|76
5|A|31.7|21.1|3.5|{"17": 1, "585": 1, "591": 3, "8092": 1}|{}|85
5|B|20.0|20.0|3.5|{"8092": 1}|{"8092": 1, "585": 7}|17
6|B|21.5|21.5|3.5|{"585": 1, "8092": 1}|{"585": 5}|26
6|A|26.5|18.2|1.9|{"17": 1, "591": 3, "8092": 1}|{}|76

T5 per pair
pair|cost%base A|cost%base B|MB A|MB B|PWS A|PWS B|attack A|attack B|cancel A|cancel B
0|68|45|0|0|1|0|1|1|0|0
1|41|89|1|1|0|0|0|0|0|5
2|64|105|1|3|1|0|1|1|0|6
3|76|74|1|1|1|0|0|1|0|4
4|64|62|1|1|1|0|0|1|0|3
5|85|97|1|2|1|0|1|1|0|8
6|76|71|1|1|1|0|0|1|0|5

POOLED MEAN PROBABILITY WHEN OFFERED (row-weighted), pairs 1-6 and pair 0
pairs 1-6 A {'attack': (0.385, 10), 'cancel|forced': (0.081, 189), 'spell:17:self': (0.265, 8), 'spell:585:target': (0.103, 29), 'spell:591:target': (0.296, 29), 'spell:8092:target': (0.345, 10)}
pairs 1-6 B {'attack': (0.715, 6), 'cancel|forced': (0.431, 227), 'spell:17:self': (0.041, 56), 'spell:585:target': (0.276, 56), 'spell:591:target': (0.101, 56), 'spell:8092:target': (0.19, 23)}
pair 0 A {'attack': (0.33, 1), 'cancel|forced': (0.053, 37), 'spell:17:self': (0.143, 3), 'spell:585:target': (0.36, 8), 'spell:591:target': (0.134, 8), 'spell:8092:target': (0.21, 3)}
pair 0 B {'attack': (0.73, 1), 'cancel|forced': (0.366, 56), 'spell:17:self': (0.043, 9), 'spell:585:target': (0.373, 9), 'spell:591:target': (0.074, 9), 'spell:8092:target': (0.043, 9)}
```

In T4, `sepMin` is the smallest `observation.separation` over the requests
of a run. The 3.5 value in most runs is a floor that recurs in the
observations. Why it recurs is not established here.

### A correction to the pair 0 table in the README

The README table for 04 and 05 counts chosen decisions, not applied ones.
In encounter 04, the one Mind Blast choice (decision 10) has
`applied: false`. In encounter 05, two of the seven Smite choices (decisions
12 and 57) have `applied: false`. Counted as applied, the pair is: Mind
Blast 0 against 0, Power Word: Shield 1 against 0, Smite R1 5 against 5, and
melee 1 against 1. So the applied difference in pair 0 is one Power Word:
Shield. The README section is otherwise left as it was.

## Cross-pair summary

Pairs 1 to 6 (n = 6 pairs, 12 encounters). Pair 0 is listed separately
because its kit had no movement.

| Measure | A ahead of B in pairs | Tied | B ahead | Pair 0 |
|---------|-----------------------|------|---------|--------|
| Power Word: Shield applied (A 5, B 0) | 5 | 1 | 0 | A 1, B 0 |
| Smite rank applied most (B applied R2 once, pair 3) | A: R2 591 in 6 | - | B: R1 585 in 6 | both R1 only |
| Melee `attack` applied | 0 | 3 | 3 (B used it, A did not) | tied 1, 1 |
| Mind Blast applied | 0 | 4 | 2 (B more) | tied 0, 0 |
| `cancel` applied | 0 | 0 | 6 (A never, B 3 to 8) | tied 0, 0 |
| `cost%base`, applied choices | 3 (pairs 3, 4, 6: A higher) | 0 | 3 (pairs 1, 2, 5: B higher) | A higher |
| `succeededCost%base` (RAWLOG) | 5 (A higher) | 0 | 1 (pair 1, 44 against 41) | not recorded |
| Elapsed ms (records) | 0 | 0 | 6 (B longer every pair) | B longer |

Mean probabilities when offered, pooled over pairs 1 to 6, are
consistent in direction with the predicted change:

- Power Word: Shield: 0.265 (A, 8 rows) against 0.041 (B, 56 rows).
- Mind Blast: 0.345 (A, 10 rows) against 0.190 (B, 23 rows).
- Smite R2 591: 0.296 against 0.101.
- Smite R1 585: 0.103 against 0.276.
- Melee `attack`: 0.385 (10 rows) against 0.715 (6 rows).

Per encounter (T3), every B run gives Power Word: Shield between 0.035 and
0.046, and every A run gives it between 0.13 and 0.47. Every B run gives
`cancel` in forced rows between 0.421 and 0.452, and every A run between
0.074 and 0.086. Pair 0 shows the same shape: shield 0.143 against 0.043,
Mind Blast 0.210 against 0.043, cancel 0.053 against 0.366. These per-row
probabilities are not independent. Rows within one run share state, so the
row counts overstate the effective sample.

**The `cancel` behaviour.** Under B, the forced `wait`/`cancel` rows after
a Smite or Mind Blast starts get `cancel` at about 0.42 to 0.45, and the
applied choice often lands on `cancel` (for example 0.52 against 0.48).
T4 shows that the server interrupted those casts: under B, 4 to 8
interrupted casts per run, mostly Smite R1, and under A none. So under B the
character repeatedly starts a Smite and cancels it. This spends time
without dealing damage. Every B run took longer than its paired A run, and
B ended with lower health in every pair. Because interrupted casts cost no
mana [INFERENCE from 3.3.5a spell mechanics, not measured here], the lower
server-succeeded cost under B comes partly from cheaper spell choices
(Smite R1 over R2, no shield) and partly from cancelled casts. The records
cannot say whether the cancels are a deliberate conservation tactic or a
misreading of the instruction. They show only that B raises the probability
of `cancel` about fivefold.

**Other differences.** Under A, after the shield, the character applied
`move_forward` 4 or 5 times in pairs 2 to 6 and moved closer before its
first damage (T4 `sepAtFirstDamage` 18.2 to 21.4 yards against a 24.8 to
31.7 yard start). Under B no movement was applied. B opened with Mind Blast in
four of six pairs. A opened with the shield in five of six pairs.

## Verdict

At the level of individual choices, the change is consistent and runs in the
predicted direction for the costly defensive spell and for spell rank.
Power Word: Shield was applied in 5 of 6 A runs and 0 of 6 B runs. Its mean
offered probability was lower under B in all 6 pairs. A always preferred
Smite R2 and B always preferred Smite R1. Melee was applied in 5 of 6 B runs
and 2 of 6 A runs.

For Mind Blast, the result is null to mixed. It was applied at least once in
every run of pairs 1 to 6 under both instructions, and more often under B in
two pairs. Its mean offered probability was lower under B in all 6 pairs
(0.128 to 0.258 against 0.295 to 0.450). So the tendency is visible in the
probabilities but not in the counts.

For total mana, the result is mixed. Counted from applied choices
(`cost%base`), B was higher than A in 3 pairs and lower in 3. Counted from
server-succeeded casts in the raw log, B was lower in 5 of 6 pairs. That
reduction depends heavily on B cancelling its own casts. B runs were also
slower and cost more health in every pair.

So the instruction does change behaviour, and the instruction-linked
differences (no shield, cheaper Smite rank, more melee, frequent
self-cancel) repeat across all six pairs and both orders. Whether the change
does what "conserve mana ... favor efficient damage" asks is not shown: the
cancel pattern makes B slower without clearly making it more efficient.

This is six pairs with a stochastic judge. Counts per run are small (0 to 3
for the key spells), and within-run probability rows are correlated. No
significance test is offered, and none would be meaningful at this sample
size. Pair 1 is not level-matched (6 against 7). Pair 0 used another
character and a kit without movement. This file does not mark the behaviour
change in milestone 2 as accepted.

# M6 evidence: a first sustained supervised session

One 41-minute supervised session on 2026-09-26. This record does not show
that milestone 6 is met. It covers one character, one class and two
neighbouring areas. No death happened inside a running cycle, and one death
needed a daemon restart and the spirit healer.

## Records

- [session-2026-09-26.json](session-2026-09-26.json) is the output of
  `tuicraft record --since 1790384179360`. It was built only from the
  CYCLE, TACTICS and RECOVERY events in the daemon session log. It was
  regenerated with the reworked #149 (`12f2ba5`) from the session log cut
  at the journal's end, 1790386643151, because `record` has no upper bound
  and the same log later held a smoke test. Against the first version
  (built with `55a611b`), only `latency.decisionRatePerSec` and the new
  `latency.decisionRequests` changed. If #149 changes again before it
  lands, this file must be regenerated the same way. Its event window is
  1790384250578 to 1790386638307, 39.8 minutes.
- [session-2026-09-26-journal.md](session-2026-09-26-journal.md) is the
  supervising agent's own journal: every command it ran, with epoch ms and
  its reason, from 1790384179360 to 1790386643151 (41.1 minutes). It is
  hand-written and not evidence in its own right. It attributes the actions
  the event log cannot see: travel, rests, spirit-healer requests and daemon
  restarts. Where the journal and the log disagree, this README follows the
  log (see "Corrections" below).

## Setup

- Character Fgklhbcangn (`0xa0b`), level 10 blood elf priest from the
  `eversong10` SOAP preset, on my own throwaway account `FAC6AB7120D6D`,
  map 530 (Eversong Woods). Build: the #143 (cycle resume), #148
  (continue after death) and #149 (session record) stack.
- Supervisor: one omp worker agent owned the CLI for the whole session. It
  picked targets from `nearby --all --json`, travelled with `face` and
  `move`, and issued `cycle`, `halt` and `cycle --resume`. It gave no
  tactical command during a fight; Jev (`jev-1.13.0`) chose every in-fight
  action. No GM command was used in this session.

## What the record shows

- 30 cycle runs (26 started, 4 resumed) started 33 fights: 16 completed
  with server kill credit, 12 blocked and 1 failed. The journal names the
  kills: Springpaw Stalker ×10, Wretched Hooligan ×5 and Wretched Thug ×1,
  north of Fairbreeze and at the edge of the Wretched camp near Sunsail
  Anchorage (about 8780, -6200). 15 kills opened loot (`looted`) and one
  had none. Item and coin gains were not checked against inventory, so
  `looted` means only that a corpse window opened.
- 13 targets were skipped: `target_unreachable` ×5, `obstructed` ×2,
  `height_unresolved` ×1, `server_action_rejected:134` ×2,
  `server_action_rejected:47` ×1, `server_action_rejected:bad_facing` ×1
  and `unverified_hostile_relation` ×1 (a Crazed Dragonhawk, refused by
  design).
- Interventions in the record: three mid-fight HALTs, each followed by
  `cycle --resume` with a different instruction. Every resumed target was
  then killed (1790384343602→1790384348044, 1790384628820→1790384633165,
  1790385354694→1790385356237). There was one `manual_override`, when a new
  cycle replaced an idle one (failure 3), and one resume after a
  `corpse_unreachable` stop. Five standing instructions were used.
- Deaths 5, recovered by a cycle 4. Every one of the five deaths happened
  between cycles, with no cycle or fight running (see failure 1). Four
  times the next `cycle` started while the character was dead or a ghost
  and recovered first: release, 16–18 corpse legs, reclaim at 29–35 yd,
  then the fight. The fifth recovery did not finish (failure 2).
- Stale actions: 8 Jev results discarded, all `unavailable`.
- Latency, two numbers quoted together: a loop rate of 4.106 requests per
  second over 645.4 s of active tactics time (mean 239 ms, p95 281 ms per
  request), and a decision rate of 3.237 per second: 2089 of the 2650
  requests offered an action other than `wait` or `cancel`. Jev applied
  407 non-`wait` actions against 2203 `wait`s, so most offered decisions ended
  in a `wait`.

## What went well

- HALT and resume worked all three times without a repair. The halted
  target was fought again under the new instruction and killed, and the
  queue position and the loot of targets already done were kept.
- A cycle started as a corpse recovered on its own four times out of four
  (reclaim within 35 yd, then a fight), all four at the Wretched camp.
- The session kept running for 41 minutes across three creature types and
  five instructions, and every stop in it carried a named cause.
- The record was rebuilt from the log alone and agrees with the journal on
  every run, kill, HALT and resume.

## Failures

1. **Deaths between cycles.** All five deaths happened while the
   supervisor was choosing, travelling or resting. Nothing defends the
   character when no cycle or fight is running, and the Wretched camp
   respawns and pulls adds. The supervisor did not check `recovery` or
   `combat` before acting. After each death its `move` legs were refused
   with `rooted`, which is the refusal a dead character gets, and it read
   them as obstructed ground for up to 20 s (journal 1790384756482–
   1790384772319 and 1790385469225–1790385488637).
2. **Death #5 needed a session repair.** A fallback exploration walked the
   character about 500 yd south into Withered Green Keeper ground (level
   9–10, factionTemplate 91), where it died while resting. The next cycle
   and its resume both stopped `corpse_unreachable`: the ghost did not get
   off the Fairbreeze graveyard, 563 yd from the corpse, in 14 and 11 legs.
   The supervisor then sent `spirit-healer` from 12 yd. The server never
   answered, and the client refused every retry, including one at 0.8 yd
   and one after `halt`, with "Previous spirit-healer request remains
   unanswered". Only a daemon restart cleared it. The first restart came
   from a shell without `TYPESAFE_API_KEY`, so the daemon was restarted a
   second time. The spirit healer then revived the character
   (1790386540732). This recovery was done by the supervisor, not by the
   cycle, and the daemon restart counts as a repair. Filed as #178.
3. **An idle cycle.** At 1790385714502 a cycle started a fight on a
   Springpaw Stalker 22 yd away with "keep health above half; heal before
   attacking again if needed", at full health. Jev chose `wait` in 1241
   of its 1253 results over 300 s (the rest were 10 shields, 1 heal and 1
   Mind Blast), and the target was still at 137/137 health in the last
   observation.
   Nothing in the cycle or tactics loop limits a run that makes no
   progress. The supervisor replaced it (`manual_override`), and the new
   cycle killed the target in 12 s. Filed as #179.
4. **Travel.** `walk-toward` failed all 8 times with "walk stopped without
   completion". Of 119 `move` legs, 62 moved 0 yd. Navigation causes
   (`target_unreachable`, `obstructed`, `height_unresolved`) account for 8
   of the 13 skips.
5. **Server-rejected openers.** Four first engagements ended with
   `server_action_rejected` (`134` ×2, `47`, `bad_facing`). Both retries
   after a `134` killed the target.

## Interventions

From the record and the journal, every supervisor action other than
choosing a cycle's queue and instruction:

- 3 HALTs of a running fight, each followed by `cycle --resume` with a new
  instruction.
- 1 new cycle that replaced an idle cycle (`manual_override`, failure 3).
- 2 `cycle --resume` refusals (`cycle_nothing_to_resume`) after deaths
  outside a cycle, then 1 resume after `corpse_unreachable`.
- 1 `halt` sent only to try to clear the spirit-healer request (the record
  does not see it, because no cycle or fight was running).
- 5 `spirit-healer` requests and 2 daemon restarts (failure 2).
- 118 `face`, 1 `face-guid` and 119 `move` travel commands, 8
  `walk-toward` attempts, and 9 rests with no command, all between cycles.

## Corrections

The supervisor's summary reported deaths #1 and #2 as mid-cycle deaths
that the cycle recovered. The session log disagrees. The first
`life_observed` dead came at 1790384755864, 62 s after one cycle stopped
and 19 s before the next started. The second came at 1790384890415, 8 s
after a cycle stopped. Neither fell inside a cycle's run. The record,
which counts recoveries only from CYCLE `recovered` events, attributes all
four recoveries to cycles that started while the character was dead.

Journal lines 193 and 323 show `cycle --resume --instruction …` with the
instruction unquoted. The journal does not show whether the supervisor
quoted it. The two commands were well-formed either way: the CLI reads
every word after `--instruction` up to the next flag, and both were
refused with `cycle_nothing_to_resume` before the instruction was used.

## Not shown

- A death inside a running cycle followed by in-run recovery. That was
  shown only in #148, with GM `.die` kills.
- More than one character, class or zone; quests; inventory gains.
- Human-facing presentation.

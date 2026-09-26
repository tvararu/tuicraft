# M5 evidence: the selected questing loop

Live record against the real server via `./dist/tuicraft` built at
`85b38f9`, character Fgklhapghbp (0xa04, `fresh` preset, level 1 blood elf
priest, map 530). Quest 8325 "Reclaiming Sunstrider Isle": kill 8 Mana
Wyrms (15274) for Magistrix Erona (15278, guid 0xf130003bae004980). The
AzerothCore DB lists Erona as its starter and ender, with rewards of 30
copper, 100 XP and a choice of item 20997 or 20998. Every step used
tuicraft CLI verbs; no GM commands, no scripts. Operator journal:
`tmp/m5-final/journal.md` (gitignored, not committed).

## Records

- [quest-8325-positive-2026-09-26.json](quest-8325-positive-2026-09-26.json) —
  outcome `positive`. Each stage below comes from a different observation,
  so none of them is inferred from another.

## Stages

1. **Offer.** `talk 0xf130003bae004980` → `quests --json` dialog `gossip`,
   menu 11902, quest 8325 icon 2 (available).
2. **Acceptance.** `select-quest 8325` at 1790382014517. Events: QUEST
   `intent` (request), `dialog` details (packet), `accepted` (quest_log),
   `log`. Slot 0 = 8325, flags 0, counters `[0,0,0,0]`. 8325 is an
   auto-accept quest (flags 524424 include 0x80000), so the server logs it
   when the details open. `accept-quest` then fails locally with
   `quest_already_in_log`. `cancel-interaction` → QUEST `closed` (packet).
3. **Objective progress.** Eight kills, each by `face-guid`, `cast 585`
   (Smite pull) and `fight`. Each `read --json` holds QUEST `progress`
   (packet: SMSG_QUESTUPDATE_ADD_KILL, `currentCount` N of 8, npc 15274)
   followed by QUEST `progress` (quest_log, slot counters `[N,0,0,0]`).
   The count went 1, 2, 3, 4, 5, 6, 7, 8. The `experience` field `xp`
   after each kill: 51, 101, 151, 201, 251, 301, 351, then level 2 with
   xp 1 (kill notices: 51, then 50 each).
4. **Level up.** On kill 8 the `experience` level went 1 → 2
   (`nextLevelXp` 400 → 900). The `lastLevelUp` notice
   (SMSG_LEVELUP_INFO) shows level 2, health +6, mana +55, stats
   `[0,0,0,1,1]`.
5. **Completion.** In the kill-8 read: QUEST `completed` (quest_log), and
   slot 0 flags 1 with counters `[8,0,0,0]`.
6. **Turn-in.** `talk` → gossip with 8325 icon 4. `select-quest 8325`
   records intent `complete`, and the server answers directly with an
   `offer` (no request-items step): 30 copper, 100 XP, choices
   20997/20998, faction 911. `choose-reward 0` at 1790382266999.
7. **Reward notification.** QUEST `rewarded` (packet:
   SMSG_QUESTGIVER_QUEST_COMPLETE): `lastReward` questId 8325,
   experience 100, money 30. Alongside it: REWARDS `item_push` (20997,
   bag 255 slot 26) and the COMBAT `xp` notice (total 100, kind other).
8. **Actual changes.** `inventory --json` coinage 0 → 30, and item 20997
   ×1 appears at bag 255 slot 26 (all eight earlier stacks unchanged).
   `experience --json` xp 1 → 101 at level 2. The quest log is empty
   after the QUEST `removed` (quest_log) event.

## Findings and limits

- `goto` on Sunstrider Isle mostly refuses destinations near the Sunspire
  (`ambiguous ground column`, `pathfind_find_height failed
  (UNKNOWN_HEIGHT)`); the route used known-good waypoints plus `face` and
  `move forward` legs.
- `fight` alone refuses Mana Wyrms with `unverified_hostile_relation`,
  because they are neutral. A Smite pull made each one hostile first.
- `face-guid` returned `target_stale` for six of the eight wyrms, which
  were idle and had no recent movement update. The pull hit anyway.
- `talk` uses CMSG_GOSSIP_HELLO. AzerothCore answers it for questgiver-only
  NPCs too: Marsilla Dawnstar (npcflag 2) returned an empty gossip in the
  probe run, so CMSG_QUESTGIVER_HELLO was not needed.

## Quest 8326: a collect quest

Record: [quest-8326-positive-2026-09-26.json](quest-8326-positive-2026-09-26.json),
outcome `positive`. Same character and binary as the cancel run below
(Fgklhbgejpp, 0xa12, level 2 after playing 8325 with the same verbs).
Quest 8326 "Unfortunate Measures": collect 8 Lynx Collars (20797) from
Springpaw Lynx (15372) and Springpaw Cub (15366); prerequisite 8325;
Magistrix Erona starts and ends it. The AzerothCore DB gives 50 copper,
a choice of 20994/20993/20992 and a 100% quest drop from both beasts.

1. **Metadata.** `query-quest 8326` → `queries` known, `requiredItems`
   20797×8, money 50, next quest 8327.
2. **Acceptance.** `talk` → gossip 8326 icon 2 (flags 524424, auto-accept).
   `select-quest 8326` → dialog `details`, QUEST `accepted` (quest_log);
   slot 0 = 8326, flags 0, counters `[0,0,0,0]`; `items` =
   `{questId 8326, itemId 20797, required 8, carried 0}`.
3. **Objective progress.** Five kills (Smite pull, then `fight`), each
   looted with `open-loot`, `take-loot`, `release-loot`; the server's
   loot-AoE pushed a second collar on `open-loot` for kills 3–5. Each of
   the 8 SMSG_ITEM_PUSH_RESULT packets (bag 255, slot 27 then
   0xFFFFFFFF for merges, count 1, total 1…8) produced, in the same read,
   a QUEST `progress` event with source `inventory` whose `lastProgress`
   is `collect` with `carried` equal to the push total, and
   `inventory --json` showed the stack at 255/27 grow 1, 2, 4, 6, 8
   (snapshots taken after both pushes of a double kill). `itemPushes` was
   empty at every snapshot: the server sends the item field updates
   before each push.
4. **What the server does not send.** The packet dump holds no
   SMSG_QUESTUPDATE_ADD_ITEM, SMSG_QUESTUPDATE_ADD_KILL or
   SMSG_QUESTUPDATE_COMPLETE, and the quest-log counters stayed
   `[0,0,0,0]` throughout. AzerothCore defines `SendQuestUpdateAddItem`
   but never calls it, so collect progress exists only as item pushes and
   bag fields.
5. **Completion.** In the collar-8 read: QUEST `completed` (quest_log),
   slot 0 flags 0 → 1.
6. **Turn-in.** `talk` → 8326 icon 4. `select-quest 8326` → dialog
   `requestItems` (20797×8), unlike 8325. `request-reward` → `offer`:
   50 copper, 250 XP, choices 20994/20993/20992. `choose-reward 0`.
7. **Reward notification.** QUEST `rewarded` (packet:
   SMSG_QUESTGIVER_QUEST_COMPLETE) `lastReward` questId 8326, experience
   250, money 50; REWARDS `item_push` 20994 at 255/27; COMBAT `xp` 250.
8. **Actual changes.** `inventory --json`: coinage 30 → 80, the 8 collars
   at 255/27 gone and 20994×1 in their slot. `experience --json`: xp
   343 → 593 at level 2.

The server then offered the follow-up 8327, an auto-accept quest that
entered the log already complete; it was left there.
`src/wow/quest-8326-capture.test.ts` replays the captured query, dialog,
push and reward packets.

## Cancel with an unresolved request

Record: [cancel-barrier-2026-09-26.json](cancel-barrier-2026-09-26.json),
outcome `positive`. Character Fgklhbgejpp (0xa12, `fresh` preset), CLI
verbs only, no GM. The binary was built from the branch's runtime source
(pre-squash commit `4b5a9b3`; only help text differs) plus an uncommitted
`TUICRAFT_PACKET_DUMP` patch used solely to capture raw packets.

1. **Unanswered request.** At the waypoint `10382 -6379.56 37.69`, 36.02
   yd from Erona (still listed by `nearby`), `talk 0xf130003bae004980`
   sent CMSG_GOSSIP_HELLO. AzerothCore's `GetNPCIfCanInteractWith` refuses
   at that range and answers nothing. Three seconds later `quests --json`
   showed `pending` talk `unanswered`, no dialog, `unresolved` empty.
2. **Cancel.** `cancel-interaction` sent CMSG_QUESTGIVER_CANCEL; the
   server answered SMSG_GOSSIP_COMPLETE 16 ms later. Events: QUEST
   `intent` (cancel, with the talk moved into `unresolved`), then `closed`
   (packet). `quests --json`: `pending` null, `unresolved` holds the talk
   (`guid` Erona, `at` 1790384152026).
3. **Second cancel.** Another `cancel-interaction` with nothing pending
   drew another SMSG_GOSSIP_COMPLETE; `unresolved` still held the talk.
   Before this change, that cancel overwrote the single `uncertain` field
   with nothing.
4. **Later.** The talk was still `unresolved` after two answered talks
   and after quest 8326 was rewarded; nothing but an authoritative
   outcome may settle it, and a gossip hello has none.

`src/wow/quest-cancel.test.ts` replays the captured packets, and
`src/test/live-quest.ts` repeats the scenario under `mise test:live`.

## Jev-driven quest loop (issue #214)

- [quest-loop-jev-2026-09-26.json](quest-loop-jev-2026-09-26.json) —
  8325 `positive`; 8326 `partial`, because the objective was completed by
  the loop but the turn-in was blocked by a full backpack (#222). Character
  Fgklhdlaija (fresh preset). `./dist/tuicraft` was built at e97bdb9: the loop commit
  on top of #134 and #139 (fight neutral), before either landed. The daemon
  picked every target and Jev made every tactical choice: the supervisor
  issued no `fight`, `cast`, `attack`, `target`, `face-guid` or GUID `cycle`
  (0 forbidden commands).

### 8325: kill 8 Mana Wyrms

| Actor | Counts |
|---|---|
| Supervisor, objective | 1: `cycle --quest 8325` |
| Supervisor, dialog | 5: `talk`, `select-quest 8325` (auto-accept); `talk`, `select-quest 8325` (completion), `choose-reward 0` |
| Supervisor, travel | 107 `face`/`move` legs, all on the return to Erona; each `goto` was refused with `ambiguous ground column` (#138) |
| Supervisor, inspection | 105 |
| Daemon target picks | 9: 8 kills with `server_kill_credit`, and 1 skipped as `target_unreachable` |
| Jev | 393 decision requests, 384 applied (`wait` 227, `move_forward` 124, Smite 25, `face_target` 5, Lesser Heal 2, `attack` 1), 0 discarded |

The one `cycle --quest 8325` run started at the spawn point with no travel
and stopped with `objective_complete` after 9 starts out of 16. Server
progress events (SMSG_QUESTUPDATE_ADD_KILL) counted 1 to 8, and each
victim GUID matches a queue entry. Log slot 0 had flags 1 and counters
`[8,0,0,0]`, 104.8 s after acceptance. Turn-in: `lastReward` 100 XP and 30
copper; `experience` xp 2 → 102 (level 2); coinage 0 → 30; item 20997
added to the backpack. The quest then left the log.

### 8326: collect 8 Lynx Collars (item 20797)

The quest query names the item but not the creatures that drop it, so the
supervisor passed the drop sources from the DB: `--source 15366 --source
15372` (Springpaw Cub and Lynx). There were four `cycle --quest 8326` runs.
Runs 1 to 3 stopped with `objective_targets_out_of_reach` (nearest target
at 57, 74 and 74 yd; reach 50). After each, the supervisor moved closer
(79 travel legs in total). Run 4 stopped with `objective_complete`.
Daemon picks: 9, with 1 skipped as `obstructed`. Jev: 293 requests, 283
applied (`wait` 192, `move_forward` 61, Smite 27, `face_target` 3),
1 discarded. Item pushes counted 1 to 8, the log slot was marked complete
and 8 collars were carried. At turn-in, request-items was followed by
`request-reward` and then the offer (50 copper, 250 XP). `choose-reward 0`
was answered with inventory error 50 (`inventoryFull`): the loop had
looted every drop into the 16-slot backpack. No reward was given; 8326
stays complete in slot 0 (#222).

### Limits found

- Every `goto` on the isle was refused in this run, including a waypoint
  that had worked before (#138). All travel was `face`/`move` legs.
- Item-objective progress has no counter in `cycling.objective`: the
  server sends no per-item quest update, only item pushes and the
  completion flag.
- Travel, acceptance and turn-in stay explicit supervisor steps. They are
  a handful of dialog verbs; folding them into the loop would mean
  pathing to the giver, which is the part that does not work yet.

### Rerun on the rebased loop

- [quest-loop-jev-rebased-2026-09-26.json](quest-loop-jev-rebased-2026-09-26.json) —
  8325 `positive`, 8326 `positive`. `./dist/tuicraft` at a9fe28e: the loop
  rebased onto main, where a death recovers and the cycle continues, and
  `cycle --resume` continues a stopped quest run. Fresh character
  Fgklhilldno (0xabf). No forbidden command was issued.

| | 8325 | 8326 |
|---|---|---|
| Supervisor objective | 6 (`cycle --quest` ×3, `--resume` ×3) | 6 (`cycle --quest --source 15366 --source 15372` ×2, `--resume` ×4) |
| Supervisor dialog / travel / inspect | 5 / 57 / 92 | 7 / 130 / 211 |
| Daemon stop+start | 1 | 1 |
| Jev requests / applied / discarded | 256 / 243 / 0 | 432 / 419 / 1 |
| Result | server kill credit 1→8, slot complete; lastReward 100 XP, 30c; xp 3→103, coinage 0→30, +20997 | collars 1→8, slot complete; lastReward 250 XP, 50c; xp 557→807, coinage 30→80, 8×20797 replaced by 20994 |

This time 8326 was turned in: the backpack held 13 of 16 slots. #222 is
still open; that outcome depends on how many drops the loop loots.

The runs mostly stopped with `objective_targets_out_of_reach`, and the
supervisor travelled closer before continuing. Twice (once per quest) a
loot open was answered only by a release, and the run stopped with
`loot_release_only_reconnect_required` (#165). The stuck opening then
blocked the next loot (`loot_denied:Previous loot window has not closed`)
until the daemon was restarted. Skipped picks were `obstructed`,
`height_unresolved`, `target_unreachable` and `server_action_rejected:47`
near the ledges west of the Sunspire. `goto` was refused
(`ambiguous ground column`, #138), and all travel was `face`/`move` legs.

### Final run on the merged head

- [quest-loop-jev-final-2026-09-26.json](quest-loop-jev-final-2026-09-26.json) —
  8325 `positive`; 8326 `partial`, because the objective was completed by
  the loop but the turn-in was refused with inventory full (#222).
  `./dist/tuicraft` at ab56ac5: the loop on current main, including the
  #165 fix (a loot opening that never opens fails closed after 3 s).
  Fresh character Fgklhjacpoo (0xad4). No forbidden command was issued and
  the daemon was never restarted.

| | 8325 | 8326 |
|---|---|---|
| Supervisor objective | 2 (`cycle --quest`, then `--resume` after one 31 yd walk) | 5 (`cycle --quest` ×2, `--resume` ×3) |
| Supervisor dialog / travel / inspect | 5 / 27 / 43 | 7 / 77 / 120 |
| Jev requests / applied / discarded | 268 / 260 / 0 | 279 / 267 / 0 |
| Result | 8 starts, 8 server kill credits, slot `[8,0,0,0]` flags 1; lastReward 100 XP, 30c; xp 3→103, +20997 | collars 1→8, `objective_complete`; `choose-reward 0` refused with inventory error 50, backpack 16/16 |

A release-only loot reply on the eighth wyrm was now failed closed
3 s later (`loot_open_failed`), and the next run looted normally. The
cycle still stopped as `loot_denied:release_only` rather than
`objective_complete`, even though the slot was already complete. One
8326 resume skipped three targets with `jev_timeout`.

## Unanswered requests no longer block other givers (#215)

Record: [quest-reply-bound-2026-09-26.json](quest-reply-bound-2026-09-26.json),
outcome `positive`. Character Fgklhdomged (own `fresh` account), CLI verbs
only, no GM.

1. **Before, on `main` `208db93`.** Matron Arena's only option, "I require
   priest training." (icon 3), drew SMSG_TRAINER_LIST 13 ms later and
   nothing else. `pending` stayed `selectOption` `unanswered`, and two
   `talk`s to Erona at 2.38 yd, 10 s apart, both failed with a bare
   `ERR quest_reply_unanswered` until `cancel-interaction`.
2. **Trainer window.** On the fix, the same option gave `[quest] window
   unsupported_window:trainer` in `read`, no `pending`, `unresolved` empty,
   and `lastError` `{kind: unsupported_window, window: trainer, guid:
   Arena}`. The next `talk` to Erona opened her gossip with no
   `cancel-interaction` in between.
3. **Silent talk.** From 36 yd the server ignored `talk` (no gossip or quest
   packet in the next 7 s). A second `talk` failed with `quest_reply_unanswered:
   talk 0xf130003bae004980 unanswered for 0.0s; it expires as no_reply after
   5s, or run cancel-interaction`. After 5025 ms `read` showed `[quest]
   expired no_reply`, `pending` was gone and `unresolved` held the talk with
   `reason: no_reply` (the #147 rule). Back in range, `talk` opened the
   gossip without `cancel-interaction`.

`src/wow/quest-reply-bound.test.ts` replays the captured gossip, select,
trainer list and hello packets; `src/test/live-quest.ts` repeats both cases
under `mise test:live`.

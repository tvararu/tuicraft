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

# M4 evidence: repeatable encounter cycles

Live records against the real server via `./dist/tuicraft`, character Xiara
(0x3eb, level 10 priest, map 530). The M4 design
(`docs/plans/2026-09-22-m4-encounter-cycles-design.md`) wants two parts:
a run of fights with loot, then one full death cycle with no developer
repair. This directory holds what the live sessions actually produced —
blocked branches reported as blocked, never inferred.

## Records

- [recovery-blocked-2026-09-24.json](recovery-blocked-2026-09-24.json) —
  outcome `blocked`. A full ghost session (Healer pocket to south ridge,
  ~157yd mapped) in which both recovery prongs blocked with named causes:
  spirit-healer gossip select swallowed ×10 sessions (dialog opens, select
  never answered, bytes match spec), and corpse run stopped by
  wall-to-wall ambiguous ground with the corpse 140–250yd out of range.
  Corpse query round-trips (125/125), life observations (181), and
  ground-refusal stops (370 obstructed, 300 height_unresolved) all
  exercised. Fights, reclaim, resurrection accept, and corpse arrival
  unexercised — reported, not inferred. Raw detail: the daemon session log
  (40710 lines) and an operator journal, neither committed.
- [encounter-cycles-positive-2026-09-23.json](encounter-cycles-positive-2026-09-23.json) —
  outcome `positive-partial`. Seven server kill credits with xp (distinct
  targets, ts>=1790118690822), six loot windows all opened->released with
  ack, one proved serial take-all ([0,1] with take->removed per slot),
  and six reclaims split by provenance: two clean no-repair cycles
  (gate 0.13yd / 0.00yd, ghost->alive observed) plus four repair-assisted
  (journal-recorded GM .go; log confirms gates and life transitions).
  Requested-vs-observed split explicit: server granted takes the loop
  refused to record on unconfirmed close. Money 0 in all six opens, so
  coinage proof unmet; denied/full/empty and current-offer resurrection
  unexercised. Raw source: the append-only daemon session log
  (window-scoped timestamps; log totals drift as the daemon appends)
  crossed with an operator journal that is not committed.
- [encounter-cycles-paired-2026-09-24.json](encounter-cycles-paired-2026-09-24.json) —
  outcome `positive-partial`. One `cycle --max 2` run
  (startedAt 1790161478424, `queue_exhausted` at 1790161509957, log
  lines 43203–43646 of 43669 at audit time): two distinct Stalker GUIDs
  both `server_kill_credit` with `lastXp` total 108 kind kill
  (0xf130003d2302679a at 1790161494955, outcome 1790161495201 hp 123;
  0xf130003d23026691 at 1790161509623, outcome 1790161509853 hp 147).
  Both windows offered two slots with serial take->removed->item_push
  per slot and close->release observed; window2 open_requested
  (1790161509854) follows window1 release_observed (1790161495251).
  Raw carried-slot diffs: 4814 4->5, 27668 4->6 across the run, 20772
  1->2, coinage 6164 unchanged (money 0 both opens). No death, ghost,
  resurrect, corpse, or reclaim lines in the window; Xiara alive
  throughout. Epoch 3, server `.gps` pose, and walk-toward legs are
  journal-sourced worker claims, not log observations. Unexercised:
  denied/full/empty loot, coinage gain, current-offer resurrection.
- [money-gain-positive-2026-09-23.json](money-gain-positive-2026-09-23.json) —
  outcome `positive-partial`. Four server kill credits with xp (three
  Springpaw Stalkers: 0xf130003d23012e5b xp 56, 0xf130003d23012e39 xp 84,
  0xf130003d23000965 xp 56; Wretched Hooligan 0xf130003f220197ce xp 56;
  outcomes 1790167003924–1790167215810, log lines 49030–49626), four
  windows all opened->released with ack. The three Stalker offers were
  money 0 (coinage 6164); the Hooligan offer was money 10 + item 27668.
  Explicit take-money request (1790167231036) -> money cleared 10->0
  (1790167231067) with money_notice, then raw carried-scope
  inventory_observed coinage 6164->6174 (line 49639), held through
  close (line 49643) and release ack (line 49644, coinage 6174) and
  confirmed by a later snapshot (line 49723, coinage 6174). No
  loot_removed/item_push/take line for the Hooligan GUID in
  49631–49644; carried slots identical across open/observed/release
  (bag 20 slot 16 entry 27668 count 12 unchanged), so the item was
  left untaken and item storage is NOT claimed for this window. No
  death, ghost, corpse, reclaim, denied/full/empty, or RESURRECT line
  in 49030–49655. Route/waypoints/GPS poses are journal-sourced
  worker claims (in-window poses are predicted-source), not log
  observations. The prior blocked coinage record below stands as
  history; this record covers only the later run after line 47114.
- [money-loot-blocked-2026-09-23.json](money-loot-blocked-2026-09-23.json) —
   outcome `blocked`. Nine server kill credits with xp (distinct Stalker
   GUIDs, xp lines 43905–46416, opens 43912–46425, releases 43928–46441,
   log lines 43800–47114 of 47114 at audit time), all nine loot offers
   money=0 with coinage 6164 in every inventory snapshot, so take-money
   was never offered and coinage proof stays OPEN. Two later normal
   death/ghost/healer/alive cycles (dead 46477/47017, ghost 46492/47033,
   corpse found 46527/47064, healer request unanswered 46528/47065 with
   guid 0xf13000195b0009f1, alive epoch 2 46570/47107) with reclaim
   blocked corpse_out_of_range (421.44yd water corpse, 184.15yd corridor
   corpse). SQL candidates 15968/16162/15645 verified in
   creature_template.sql (mingold/maxgold 5-12/5-11/6-13, map-530 spawns
   5/18/15) as offline reference only: Scout spawn approached but never
   observed live, Wretched ground never reached — no live absence
   claimed. Denied/full/empty and current-offer resurrection unexercised
   (no such lines in 43800–47114).

## Exit evidence and limits

- The paired cycle proved two fights, two item-gain windows, and a valid
  second window after the first release. Two earlier no-repair corpse
  reclaims proved ordinary death recovery. The Wretched window proved
  money gain with raw coinage 6164->6174 after an explicit take and
  release acknowledgment.
- Denied/full/empty loot and current-offer resurrection were unexercised
  live. Release-only opening denial still requires an ordinary reconnect;
  none of these records proves denial/retry support.
  The 2026-09-26 section below records later live runs of these branches.

## Unexercised branches and the spirit-healer gossip, 2026-09-26

Record: [unexercised-branches-2026-09-26.json](unexercised-branches-2026-09-26.json)
(issue #201). One live session on three throwaway factory characters, all
deleted afterwards: A `Fgklhcpcnhl` (`0xa4a`, eversong10 priest, level 10,
the actor), B `Fgklhcpcnek` (`0xa4b`, eversong10 priest, level 10) and G
`Fgklhcpcobf` (`0xa4c`, `fresh --gm 2`, used only to type GM commands).
Build `90c148a`. The record holds every command with its raw output (long
outputs truncated and marked), the matching session-log lines, and the
incoming packets for each branch.

A's daemon ran under a throwaway wrapper, not committed, that logged every
incoming opcode with its body and whether a handler exists. No source file
changed. The login banner says the server also runs a "Loot aoe" module; its
source is not available here, so any effect it has on loot is unknown.

### GM commands (setup only)

All typed by G in chat. None touched a fight, a loot roll or the
resurrection itself.

| When (epoch ms) | Command | Purpose |
|---|---|---|
| 1790390116180 | `.appear Fgklhcpcnhl` | reach A |
| 1790390124443 | `.die` (A selected) | first death, for the resurrection offer |
| 1790390152419 | `.die` (A selected) | second death, for the gossip diagnosis |
| 1790390350828 | `.appear Fgklhcpcnhl` | reach A |
| 1790390354952 | `.additem 2318 -1` | remove A's partial Light Leather stack so loot cannot stack into it |
| 1790390356009 | `.additem 25 104` | fill A's 104 free slots |
| 1790390501439 | `.appear Fgklhcpcnhl` | reach A |
| 1790390505569 | `.additem 25 -1` | free one slot |
| 1790390525396 | `.additem 25 -3` | free three more for the denial run |
| 1790390871001 | `.revive` (G itself) | G had been killed while idle |
| 1790390872060 | `.appear Fgklhcpcnhl` | reach A |
| 1790390876183 | `.additem 25 -100` | remove the remaining filler |

### Spirit-healer gossip: the select is answered, the client drops the answer

The 2026-09-24 record called the gossip select "swallowed". It is not.
A ghost 5.44 yd from the Fairbreeze Spirit Healer `0xf13000195b0009f1`
sent `talk`, which opened menu 83 with one option, `Return me to life.`,
and then `select-option 0`:

    1790390168294 $ tuicraft select-option 0
    Daemon accepted request. No server result confirmed.
    probe 1790390168347 op 0x222 UNKNOWN handled=false body f109005b190030f1

0x222 is `SMSG_SPIRIT_HEALER_CONFIRM`, and its body is the healer's packed
GUID. In AzerothCore, `Player::OnGossipSelect` handles
`GOSSIP_OPTION_SPIRITHEALER` by having the healer cast spell 17251, and the
script for that spell (`spell_gen_spirit_healer_res`) sends this packet. The
Blizzard client then shows a confirmation and answers with
`CMSG_SPIRIT_HEALER_ACTIVATE`. tuicraft has no opcode entry and no handler
for 0x222, so `OpcodeDispatch.handle` drops it and nothing follows. Filed as
#200. From the same spot, `tuicraft spirit-healer <guid>` sends
`CMSG_SPIRIT_HEALER_ACTIVATE` directly and revived the ghost in 52 ms
(`life_observed alive`, epoch 3 to 4).

The other case, a direct request that gets no answer (#178, PR #187), is a
different path. `HandleSpiritHealerActivateOpcode` returns without replying
when `GetNPCIfCanInteractWith` fails, and that check includes
`INTERACTION_DISTANCE` (5.5 yd). That fits PR #187's live result (no answer
at 17.8 yd, revived at 3.8 yd). It is inference for the 12 yd M6 request.

### Resurrection offer accepted

A was killed with a GM `.die` and did not release. B cast Resurrection
(2006) on A. A received `SMSG_RESURRECT_REQUEST` from `0xa4b`, and
`recovery --json` held it as a current offer:

    "resurrection":{"guid":"0xa4b","name":"","reserved":0,"sickness":0,
      "receivedAt":1790390139789,"response":"unanswered"}
    1790390144491 $ tuicraft resurrect accept
    Daemon accepted request. Check tuicraft recovery for observed results.

The session log shows `resurrection_offered`, then
`resurrection_response_requested`, then `life_observed alive` at 70 health,
epoch 1 to 2, 4.8 s after the offer. The text form of `recovery` does not
print the offer; only `--json` shows it.

### Loot with full bags

With 0 free slots, `cycle` on Springpaw Stalker `0xf130003d23078460` killed
it (server kill credit, 40 XP), opened loot offering one Lynx Meat (27668),
requested slot 0, and stopped:

    Target 0xf130003d23078460: done (server_kill_credit), 40 XP
    Stop reason: loot_inventory_full

The server answered the take with inventory error 50,
`EQUIP_ERR_INVENTORY_FULL`. The cycle left the loot window open with the take
still `unanswered`; a separate `release-loot` closed it (release status 1).

### Loot denied: two forms, both by direct command

Neither was produced inside a `cycle`. The cycle loots straight after its own
kill, and in these runs every corpse it opened was in range and lootable.

- **Release-only.** `open-loot` about 14.4 yd from the corpse (A's server
  pose after the reconnect against the corpse position then observed) was
  answered only by
  `SMSG_LOOT_RELEASE_RESPONSE` (the server's out-of-range path in
  `Player::SendLoot`). The client kept loot phase `opening` with the request
  `unanswered`. After that, `release-loot` gave
  `ERR No open loot window to close` and a second `open-loot` gave
  `ERR Previous loot window has not closed`. Only a daemon restart cleared
  it, as the help text says.
- **Server error.** A throwaway socket script took both offered items,
  released, and reopened the same corpse 1 ms after the release was
  observed. That was before the update clearing the lootable flag arrived,
  so the local lootable check passed. The server answered
  `SMSG_LOOT_RESPONSE` type 0 with error 0, `LOOT_ERROR_DIDNT_KILL`, from
  the lootable-flag check in `Player::SendLoot`. The client recorded
  `lastLootError {"error":0}` and went back to `closed`. Inside a cycle this
  would become `loot_denied:0` through `lootError` in `src/wow/loot-run.ts`.
  That is read from source, not observed.

### Empty loot: not lootable by A, not an empty table

A and B were grouped (group loot, A leader) and A ran `cycle --max 2`. The
first kill was looted. For the second, `0xf130003d23078486`, the cycle
recorded loot `none`, sent no loot request, and stopped `queue_exhausted`,
which is the corpse branch `src/wow/loot-run.ts` treats as empty. The
server's `SMSG_LOOT_LIST` (0x3f9, no handler) named B `0xa4b` as round-robin
looter, and B's own client saw the corpse as lootable. B's `open-loot` from
out of range was then answered release-only. So the corpse had loot, just
not for A. A kill with no loot at all, or a server window with no items and
no money, was not observed.

### Still unexercised

- A denial or a release-only answer inside a running `cycle`.
- A creature whose loot is empty for everyone.
- Declining a resurrection offer, and accepting one after release.

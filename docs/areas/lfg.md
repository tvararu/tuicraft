# lfg

The `lfg` area keeps the character's dungeon finder status, the random
dungeons it may queue for with their lock reasons, the party members'
locks and the raid-browser search flag. World-service code reads it
through `session.areas.lfg.state()`. The area emits `status` and
`dungeons` events. Three acts ask the server for the status, the
player's dungeons and the party's locks; the queue and role check acts
follow. `answerProposal`, `teleport` and `voteKick` answer a dungeon
group proposal, move the character into or out of the dungeon and vote
on a kick. The store also keeps the last `proposal`, `boot`,
`teleportDenied`, `offerContinue` and `reward` and emits `proposal`,
`boot`, `teleport_denied`, `offer_continue` and `reward` events. It also
keeps the raid browser lists per dungeon in `raidLists`, emits
`raid_list`, and `searchRaids` and `stopSearch` search and leave the
browser.

## Wire notes

- `SMSG_LFG_UPDATE_PARTY` with data is join, queued, two zeroes, three
  more zeroes, the count, the entries and the comment
  (`Handlers/LFGHandler.cpp:362-368`), seven flag bytes where
  `wow_messages` `lfg/smsg_lfg_update_party.wowm` has four. AzerothCore
  wins.
- `SMSG_LFG_PLAYER_INFO` is a `u8` random count, one reward block per
  dungeon and a `u32` lock count
  (`Handlers/LFGHandler.cpp:152-228`), where `wow_messages`
  `lfg/smsg_lfg_player_info.wowm` has a `u8` count. AzerothCore wins.
- Only update types 5 and 12 carry queued true, so `SMSG_LFG_UPDATE_PLAYER`
  maps 5 and 12 to `queued`, 4, 6, 7, 8 and 9 to `none`, 13 to `proposal`
  and 14 to `queued` when its queued byte is set
  (`Handlers/LFGHandler.cpp:302-337`).
- The `ghostlands20` probe shows the finder enabled: the status flow
  receives `SMSG_LFG_UPDATE_PLAYER` and `SMSG_LFG_UPDATE_PARTY`, and the
  logout sends `SMSG_LFG_UPDATE_SEARCH`
  (`Handlers/LFGHandler.cpp:613-619`). The default options mask is 5
  (`worldserver.conf.dist:3471`).
- At level 20 the server offers one random dungeon, entry 100663554
  (id 258, type 6), and locks the rest with status 2 (`too_low_level`).
- `SMSG_LFG_DISABLED` has no caller: only
  `WorldSession::SendLfgDisabled` writes `SMSG_LFG_DISABLED`
  (`Handlers/LFGHandler.cpp:621-626`), so the client learns a disabled
  finder from a `CMSG_LFG_JOIN` with no reply
  (`Handlers/LFGHandler.cpp:50-55`).
- `CMSG_LFG_JOIN` is roles `u32`, two flag bytes, a `u8` entry count, one
  `u32` per entry, the constant `u8` 3, three `u8` needs and the comment
  CString (`Server/Packets/LFGPackets.cpp:20-34`); at most 50 entries
  (`Server/Packets/LFGPackets.h:34`).
- `SMSG_LFG_JOIN_RESULT` is `u32` result, `u32` state and the party lock
  block only when locks exist (`Handlers/LFGHandler.cpp:441-454`).
- `SMSG_LFG_QUEUE_STATUS` is the dungeon `u32`, five signed wait `i32`,
  three `u8` role counts and the queued `u32`
  (`Handlers/LFGHandler.cpp:456-473`).
- `SMSG_LFG_ROLE_CHOSEN` is the member `u64`, a ready `u8` and the roles
  `u32` (`Handlers/LFGHandler.cpp:383-392`); `SMSG_LFG_ROLE_CHECK_UPDATE`
  is the state `u32`, an initializing `u8`, a dungeon count, the entries,
  a member count and per member `u64`, ready `u8`, roles `u32`, level
  `u8` with the leader first (`Handlers/LFGHandler.cpp:394-439`); the
  five-puppet run showed the group role check, each role answer and its
  echo on the live server.
- The run followed the server's order: the proposal answers land before
  the state-2 update rebroadcasts them
  (`DungeonFinding/LFGMgr.cpp:1944-1952`), the teleport out before the
  removal that offers continue
  (`DungeonFinding/LFGScripts.cpp:238-244`); a premade party that queues
  together is converted without LFG restrictions
  (`Groups/Group.cpp:2484-2488`), so a kick vote needs solo queuers and
  stays unseen.
- A role mask holds tank `2`, healer `4` and damage `8`; bit `1` is the
  leader flag, so a leader-only join or role answer fails the role check
  with `NO_ROLE` although the server echoes the answer as ready. `join`
  refuses such a mask before sending and `setRoles` settles it as refused
  (`DungeonFinding/LFG.h:39-43`, `DungeonFinding/LFGMgr.cpp:1500-1502`).
- A `CMSG_SET_LFG_COMMENT` after the join stores no comment-carrying
  update: the queued type-12/13 `SMSG_LFG_UPDATE_PLAYER` updates keep the
  join comment, and the `CMSG_LFG_GET_STATUS` reply after leaving is type
  14 with no data, so the changed comment is never returned
  (`Handlers/LFGHandler.cpp:302-337`). The status reply carries no comment,
  so `requestStatus` returns none (`Handlers/LFGHandler.cpp:281-300`).

- `SMSG_LFG_PROPOSAL_UPDATE` is the dungeon `u32`, the state `u8`, the
  proposal id `u32`, the encounter mask `u32`, a silent `u8`, a count
  `u8` and per member the role `u32` and five `u8` (self, in dungeon,
  same group, answered, accepted), members ordered tank, healer, damage
  (`Handlers/LFGHandler.cpp:545-611`).
- Proposal states are 0 initiating, 1 failed and 2 success
  (`DungeonFinding/LFGMgr.h:79-84`). State 0 sets the proposal with a
  deadline 40 s after its first update (`DungeonFinding/LFGMgr.h:51`); a
  later state 0 update for the same id keeps that deadline, and state 1
  or 2 ends the proposal.
- `SMSG_LFG_BOOT_PROPOSAL_UPDATE` is in progress `u8`, did vote `u8`,
  agree `u8`, the victim `u64`, votes, agrees, seconds left and needed
  votes as `u32`, and the reason CString
  (`Handlers/LFGHandler.cpp:513-543`).
- A kick vote lasts 120 s (`DungeonFinding/LFGMgr.h:50`): the boot
  deadline is the arrival time plus the seconds left, and an update not
  in progress ends the vote.
- `SMSG_LFG_PLAYER_REWARD` is the random and the finished dungeon `u32`,
  a done `u8`, a constant `u32` 1, money and experience `u32`, two zero
  `u32`, an item count `u8` and per item the item id, the display id and
  the count as `u32` (`Handlers/LFGHandler.cpp:475-511`), where
  `wow_messages` `QuestGiverReward` puts count before display id.
  AzerothCore wins.
- The server sends the reward to each member when a dungeon finishes
  (`DungeonFinding/LFGMgr.cpp:2421`).
- `SMSG_LFG_TELEPORT_DENIED` carries one `u32` code
  (`Handlers/LFGHandler.cpp:636-642`) and `SMSG_LFG_OFFER_CONTINUE` one
  `u32` dungeon entry (`Handlers/LFGHandler.cpp:628-634`).
- Denial codes are 1 dead, 2 falling, 3 vehicle, 4 fatigue, 6 invalid
  location and 8 combat (`DungeonFinding/LFGMgr.h:87-97`). The server
  checks for an LFG group first (code 6), then dead, falling, fatigue,
  vehicle and combat (`DungeonFinding/LFGMgr.cpp:2228-2264`).
- `teleport` refuses `not_in_lfg_group` (code 6), `dead` (code 1) and
  `in_combat` (code 8) without a send, in the server's order, reading an
  LFG group from the group list's dungeon fields
  (`Groups/Group.cpp:1906-1909`), life from the recovery store and
  combat from the self entity's in-combat unit flag. Falling, fatigue,
  vehicle and charm are left to the server's denial, and a teleport out
  from another map is silent in AzerothCore
  (`DungeonFinding/LFGMgr.cpp:2264-2268`), so it settles `no_answer`
  after 10 s. `{ force: true }` skips the local refusal; only the probe
  flow uses it.
- `CMSG_LFG_PROPOSAL_RESULT` is the proposal id `u32` and the answer `u8`
  (`Handlers/LFGHandler.cpp:95-104`); `CMSG_LFG_SET_BOOT_VOTE`
  (`Handlers/LFGHandler.cpp:133-141`) and `CMSG_LFG_TELEPORT`
  (`Handlers/LFGHandler.cpp:143-150`) are one `u8` each.
- `answerProposal` settles on a proposal update for its id that shows the
  self player's `answered` and `accepted` flags matching the answer, or
  on a state 2 update. Other members' replies rebroadcast state 0 with
  the self entry unchanged (`DungeonFinding/LFGMgr.cpp:1944-1952`), so
  they do not settle it. A state 1 update without the matching self
  entry (another member declined first) settles `refused`
  `proposal_failed`; a decline is removed with state 1
  (`DungeonFinding/LFGMgr.cpp:1937-1941`).
- `voteKick` returns `ok` once the vote is sent. The server sends no
  update until the agree or deny count reaches the threshold
  (`DungeonFinding/LFGMgr.cpp:2193-2195`), so a non-decisive vote gets no
  packet; any later boot update still updates the store.
- Puppet calls: `answerProposal '["accept"]'`, `teleport '["out"]'` and
  `voteKick '["yes"]'` (the other values are `decline`, `in`, `no`).
  A puppet call awaits the act and reports a refusal as an error.
- `join` refuses `no_dungeons` for an empty dungeon list
  (`Handlers/LFGHandler.cpp:56-60`) and `leave` refuses `not_leader`
  for a grouped non-leader (`Handlers/LFGHandler.cpp:78-92`) before
  sending; a refused join returns the party locks in `LfgJoinResult`.
- `CMSG_SEARCH_LFG_JOIN` and `CMSG_SEARCH_LFG_LEAVE` are one `u32` each
  (`Handlers/LFGHandler.cpp:265-272`, `Handlers/LFGHandler.cpp:274-279`).
  The join masks the id with `0x00FFFFFF`; the leave ignores its `u32`,
  and the server sends nothing back for it.
- A browser search stores the player in the team's searchers and answers
  at once with the cached list or the empty form
  (`DungeonFinding/LFGMgr.cpp:1038-1041`,
  `DungeonFinding/LFGMgr.cpp:1048-1066`); it checks no option and no
  dungeon id, so the empty list comes back for any id. Leaving removes
  the player (`DungeonFinding/LFGMgr.cpp:1043-1046`). Only a dungeon
  finder join with a raid-type dungeon fills the browser
  (`DungeonFinding/LFGMgr.cpp:989-1000`,
  `DungeonFinding/LFGMgr.cpp:815-825`), and no bot does that, so a fresh
  account's list is always empty. Later differences are pushed every 5 s
  while someone searches that dungeon
  (`DungeonFinding/LFGMgr.cpp:1068-1100`).
- The raid list packet is the type `u32` (2), the masked dungeon id
  `u32`, a `u8` that is 0 for a full list and 1 for a difference, for a
  difference a `u32` deleted count and that many `u64` guids (players and
  groups), then `u32` group count, a zero `u32`, the groups, `u32` player
  count, a zero `u32` and the players
  (`DungeonFinding/LFGMgr.cpp:1391-1429`). A group is the `u64` guid, the
  flags `u32` (always comment, roles and bound), the comment CString,
  three zero `u8` and the instance guid `u64` with the encounter mask
  `u32` (`DungeonFinding/LFGMgr.cpp:1321-1335`). A player is the `u64`
  guid, the flags `u32` and the parts the flags name in this order:
  `0x01` character info, `0x02` comment, `0x04` group leader (`u8` 1),
  `0x08` group guid `u64`, `0x10` roles `u8`, `0x20` area `u32`, `0x40`
  status `u8` (never set) and `0x80` instance guid `u64` with the
  encounter mask `u32`, set exactly when the player has no group
  (`DungeonFinding/LFGMgr.cpp:1337-1389`, flag values
  `DungeonFinding/LFGMgr.h:136-144`). The parser reads by flags.
- Three disagreements with `lfg/smsg_update_lfg_list.wowm`; AzerothCore
  wins. (1) The instance guid and the encounter mask follow a player only
  with flag `0x80`, where wowm reads them for every player
  (`DungeonFinding/LFGMgr.cpp:1385-1388`). (2) The average item level is
  an `f32`, where wowm has a `u32`
  (`DungeonFinding/LFGMgr.cpp:1364`). (3) The `u8` after the dungeon id is
  1 for a difference packet with the deleted guids and 0 for a full one,
  where wowm calls 0 `PARTIAL` and puts the deleted guids there
  (`DungeonFinding/LFGMgr.cpp:1395-1397`,
  `DungeonFinding/LFGMgr.cpp:1410`).
- The store keeps one list per masked dungeon id in `state().raidLists`:
  a full packet replaces the entry's groups and players, a difference
  packet deletes the listed guids and replaces or appends the records it
  carries, and each emits `raid_list`. `searchRaids(entry)` sends the
  entry as given and settles `ok` with the form on the first list for the
  masked id, `no_answer` after 5 s; it refuses `bad_entry` for a value
  outside `1..0xFFFFFFFF` and does not check the entry against the
  finder's dungeons. `stopSearch(entry)` sends the leave and settles
  `ok`; it keeps the lists. Neither touches the `searching` flag, which
  the server drives only through `SMSG_LFG_UPDATE_SEARCH`.

## Left out

- A non-leader in a partly filled `CMSG_LFG_JOIN` group may join
  (`Handlers/LFGHandler.cpp:50-55`); the join act still refuses
  `not_leader` for every non-leader (SR2-instances-15).

## Capabilities row

The `dungeon` tool queues, answers role checks and proposals, teleports in and out and votes on kicks. The queue result and the queue line in `status` say whether the queue is solo (with the agent not in a group) or for the agent's party, with the party size from the party state. A `status` to queued writes one passive `lfg/queued` row, to `none` one `lfg/left`; a nonzero `join_result` writes `lfg/refused` with the reason and locks; `queue` status writes a throttled (60 s) passive `lfg/queue` row; an open proposal, an initializing role check and an open boot vote write `wake` rows with their deadlines; `teleport_denied` writes passive `lfg/teleport_refused`; `reward` writes a `log` row with `progress: true`; `dungeons` and `raid_list` write none. The queue lifecycle follows `SMSG_LFG_UPDATE_PLAYER` update types 5, 12, 4, 6, 7, 8, 9, 13 and 14 (`Handlers/LFGHandler.cpp:302-337`); the wait text uses `SMSG_LFG_QUEUE_STATUS` (`Handlers/LFGHandler.cpp:456-473`); proposals use `SMSG_LFG_PROPOSAL_UPDATE` with a 40 s deadline (`Handlers/LFGHandler.cpp:545-611`); kicks use `SMSG_LFG_BOOT_PROPOSAL_UPDATE` with a 120 s vote (`Handlers/LFGHandler.cpp:513-543`); role checks use `SMSG_LFG_ROLE_CHECK_UPDATE` (`Handlers/LFGHandler.cpp:394-439`) with tank 2, healer 4 and damage 8 (`DungeonFinding/LFG.h`); and joins use `CMSG_LFG_JOIN` (`Handlers/LFGHandler.cpp:50-55`).

## Proof

| Opcode | Proof | Evidence | Source |
|---|---|---|---|
| `CMSG_LFG_GET_STATUS` | `live` | probe flow `lfg-status`, exit 0; both updates follow | `Handlers/LFGHandler.cpp:281-300` |
| `SMSG_LFG_UPDATE_PLAYER` | `live` | probe flow `lfg-status`, exit 0; solo body is type 0 with no data | `Handlers/LFGHandler.cpp:302-337` |
| `SMSG_LFG_UPDATE_PARTY` | `live` | probe flow `lfg-status`, exit 0; solo body is type 0 with no data | `Handlers/LFGHandler.cpp:339-381` |
| `CMSG_LFD_PLAYER_LOCK_INFO_REQUEST` | `live` | probe flow `lfg-status`, exit 0; player info follows | `Handlers/LFGHandler.cpp:152-228` |
| `SMSG_LFG_PLAYER_INFO` | `live` | probe flow `lfg-status`, exit 0; one random dungeon at level 20 | `Handlers/LFGHandler.cpp:169-227` |
| `CMSG_LFD_PARTY_LOCK_INFO_REQUEST` | `live` | probe run with a partner, not committed: trace shows `out` size 0, then 13 ms later `SMSG_LFG_PARTY_INFO` | `Handlers/LFGHandler.cpp:230-263` |
| `SMSG_LFG_PARTY_INFO` | `live` | probe run with a partner, not committed: trace shows `in` size 1061, `handled`, 13 ms after the request | `Handlers/LFGHandler.cpp:230-263` |
| `SMSG_LFG_UPDATE_SEARCH` | `live` | probe flow `lfg-status`, exit 0; sent at logout | `Handlers/LFGHandler.cpp:613-619` |
| `SMSG_LFG_DISABLED` | `dead` | no caller for `SendLfgDisabled`; a join with no reply means off | `Handlers/LFGHandler.cpp:621-626` |
| `CMSG_LFG_JOIN` | `live` | probe flow `lfg-queue`, exit 0; trace shows `out` size 20, then `SMSG_LFG_JOIN_RESULT` | `Handlers/LFGHandler.cpp:50-55` |
| `SMSG_LFG_JOIN_RESULT` | `live` | probe flow `lfg-queue`, exit 0; trace shows `in` size 8, `handled`, same tick as the type-5 update | `Handlers/LFGHandler.cpp:441-454` |
| `SMSG_LFG_QUEUE_STATUS` | `live` | probe flow `lfg-queue`, exit 0; two `in` rows of size 31, `handled`, during the 12 s wait | `Handlers/LFGHandler.cpp:456-473` |
| `CMSG_LFG_LEAVE` | `live` | probe flow `lfg-queue`, exit 0; trace shows `out` size 0, then the type-7 update | `Handlers/LFGHandler.cpp:78-93` |
| `CMSG_SET_LFG_COMMENT` | `builder` | sent live, effect not seen: probe flow `lfg-queue` traces `out` size 10 with the changed comment, then the rejoin sends an empty comment that overwrites it. Builder test on `buildLfgComment` | `Handlers/LFGHandler.cpp:122-131` |
| `CMSG_LFG_SET_ROLES` | `live` | two `ghostlands20` puppets in a party, the leader queues the level-20 random dungeon as damage (`lfg-rolecheck` flow, run not committed): the leader trace shows `out` size 1 answering the opening role check, then `SMSG_LFG_ROLE_CHOSEN` and `SMSG_LFG_ROLE_CHECK_UPDATE` 24 ms later. The member's trace was not kept | `Handlers/LFGHandler.cpp:106-120` |
| `SMSG_LFG_ROLE_CHECK_UPDATE` | `live` | same run, leader trace: `in` size 39, `handled`, on the group join before the roles are sent, again after the leader's answer, and once more about 10 s later when a proposal follows | `Handlers/LFGHandler.cpp:394-439` |
| `SMSG_LFG_ROLE_CHOSEN` | `live` | same run, leader trace: `in` size 13, `handled`, in the same tick as each role-check update | `Handlers/LFGHandler.cpp:383-392` |
| `CMSG_LFG_TELEPORT` | `live` | probe flow `lfg-teleport` on a fresh `ghostlands20` account, run not committed: trace shows `out` size 1, then 14 ms later `SMSG_LFG_TELEPORT_DENIED` | `Handlers/LFGHandler.cpp:143-150` |
| `SMSG_LFG_TELEPORT_DENIED` | `live` | same run: `in` size 4, `handled`; the store holds code 6 (`invalid_location`, not in an LFG group) | `Handlers/LFGHandler.cpp:636-642` |
| `SMSG_LFG_PROPOSAL_UPDATE` | `live` | five-`ghostlands20`-puppet run, not committed: a full party matches itself, state 0 then state 2 for the level-20 random dungeon | `Handlers/LFGHandler.cpp:545-611` |
| `CMSG_LFG_PROPOSAL_RESULT` | `live` | same run: trace shows five `out` proposal answers, the leader first, then the state-2 update | `Handlers/LFGHandler.cpp:95-104` |
| `SMSG_LFG_OFFER_CONTINUE` | `live` | same run: `CMSG_GROUP_UNINVITE` after the teleport out, the leader gets `in` size 4 body `0c000001` | `Handlers/LFGHandler.cpp:628-634` |
| `CMSG_LFG_SET_BOOT_VOTE` | `builder` | builder test on `buildLfgBootVote`; a live send needs a kick vote, so not seen live until instances-11 | `Handlers/LFGHandler.cpp:133-141` |
| `SMSG_LFG_BOOT_PROPOSAL_UPDATE` | `mock` | mock body built by `lfgBootBody`; not seen live | `Handlers/LFGHandler.cpp:513-543` |
| `SMSG_LFG_PLAYER_REWARD` | `mock` | mock body built by `lfgRewardBody`; needs a finished random dungeon, so not seen live | `Handlers/LFGHandler.cpp:475-511` |
| `CMSG_SEARCH_LFG_JOIN` | `live` | probe flow `lfg-raid-browser` on a fresh `max80` account, exit 0: the flow takes the first raid-type lock (entry 0x020000f7, dungeon 247) from the `SMSG_LFG_PLAYER_INFO` locks, and the trace `tmp/probe/instances-9-probe2/packets.jsonl` shows `out` size 4, then `SMSG_UPDATE_LFG_LIST` 20 ms later; the first run's trace with bodies, `tmp/probe/instances-9-probe/packets.jsonl`, shows `out` body `f7000002` | `Handlers/LFGHandler.cpp:265-272` |
| `SMSG_UPDATE_LFG_LIST` | `live` | same runs: `in` size 25, `handled`; the first run's body is `02000000f7000000` and 17 zero bytes, the empty full list for dungeon 247, and the flow result of the second run holds an empty `raidLists[247]` (`tmp/probe/instances-9-probe2/stdout.txt`). The non-empty full and difference forms are rig tests from the writer (`protocol-list.test.ts`, `store-list.test.ts`); no bot fills the browser | `DungeonFinding/LFGMgr.cpp:1048-1066` |
| `CMSG_SEARCH_LFG_LEAVE` | `accepted` | same run: `out` size 4 three seconds after the join, then six more seconds on the session, a clean logout and exit 0, no disconnect; builder test on `buildSearchLeave` | `Handlers/LFGHandler.cpp:274-279` |

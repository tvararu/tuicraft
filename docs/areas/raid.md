# raid

The `raid` area keeps the full group roster from `SMSG_GROUP_LIST`: the
group kind (party or raid), the battleground and dungeon-finder flags,
the character's own subgroup, flags and roles, every other member's
name, guid, status, subgroup, flags and roles, the leader, the loot
method with the master looter and threshold, and the three difficulty
bytes. It emits one `group_list` event per list with the `changes`
between the previous list and the new one (`converted`, `subgroup`,
`flag`, `loot`, `difficulty`, `joined`, `left`, `leader`). The server never lists the receiving character, so a
change to its own subgroup or flags, or a leader guid that no member row
holds, is a `subgroup`, `flag` or `leader` change with `self: true` and
no name, and one
`invite_blocked` event per `SMSG_GROUP_INVITE` with status 0. The
group is raid when bit `0x02` of the type is set, so a battleground raid
(`0x03`) reads as raid with `battleground` set. The counter belongs to
one group: a list whose group guid matches the held group and whose
counter is not newer changes nothing, a list of another group replaces
the held one, and a zero-member list of another group is ignored. The
"you left" form clears the group and emits `disbanded`. The legacy
party code reads the same packet for the `social` tool; this area only
peeks it. The area also keeps one `MemberStats` per roster member from
the peeked `SMSG_PARTY_MEMBER_STATS` and `SMSG_PARTY_MEMBER_STATS_FULL`:
status bits, health, power with its type, level, zone, position, auras,
pet fields and the vehicle seat, stamped with the area clock; stats for
a guid outside the roster are ignored. Each peek emits one
`member_stats` event with the full guid, the roster name and the
`transitions` (`died`, `ghost`, `revived`, `offline`, `online`) since
the previous stats for that member. The runtime sends one
`CMSG_REQUEST_PARTY_MEMBER_STATS` per member the roster adds; the act
`memberStats(name)` returns the held stats and refreshes a member whose
stats are missing or older than 30 s, at most one request per member
per 10 s; the act `requestMemberStats(name)` sends one request and
throws for a name outside the group. The raid structure acts each send
one packet: `convertToRaid()` sends the empty convert;
`moveToSubgroup(name, group)` takes the tool group 1-8 and sends the
wire group 0-7, throwing for a tool group outside 1-8 because the
server drops it with no reply; `swapSubgroups(name, withName)` sends
both names; `setAssistant(name, on)` sends the member guid and the
flag byte; `setMainTank(name, on)` and `setMainAssist(name, on)` send
the role byte (main tank 0, main assist 1), the apply byte and the guid;
`uninviteGuid(name, reason)` sends the member guid and the reason. The
ready check acts are `startReadyCheck()`, which sends the empty start,
`answerReadyCheck(ready)`, which sends one state byte, and
`finishReadyCheck()`, which sends the empty finish. The runtime finishes
a check the agent started once every online member answered, or after
30 s, whichever comes first; a finish from the server cancels the
timer. A start sets `readyCheck` with the initiator, the start time and
empty answers and emits `ready_check_started`; a confirm records
`ready`, `not_ready` or `offline` (state 0 for a member whose roster
status is offline) and emits `ready_check_answer`; a finish stamps
`finishedAt` and emits `ready_check_finished` with the ready count, the
names not ready, the offline count and the pending count. `group do=ready_check`
waits for that finish, which the server sends once every online member answered
or after the runtime's own 30 s finish, and its `DONE` detail names who was
ready, not ready, offline or silent; `group status` appends one line naming the
open check's waiting and answered members, or the last check's outcome.
Confirms with
no open check, from a guid outside the roster, or after the finish are
ignored. Every act names another member: a name outside the roster throws
`not in your party`, and the caller's own name throws too because the
server never lists the receiving character. The peeked
`SMSG_PARTY_COMMAND_RESULT` emits one `command_result` event with the
operation and result as names and the member name; unknown codes keep
their number (`result_<n>`, `operation_<n>`). The harness writes one
`wake` row `command` per result, and one row `roster` per change: `wake`
when the change makes the receiving character the leader, `passive`
otherwise, except `joined` and `left`, which the legacy `group/roster` row
already says; `invite_blocked` writes one `log` row.

The area also keeps `marks`, eight guids where `0` is an empty slot. A
kind 0 `MSG_RAID_TARGET_UPDATE` sets one slot, clears the same target
from the other slots and emits `raid_mark` with the setter's name, the
icon and the target; a target of 0 clears the slot; an icon past 7 is
dropped. A kind 1 list replaces all eight slots and emits `raid_marks`.
A disband or a switch to another group clears the marks.
`MSG_MINIMAP_PING` emits `minimap_ping`
with the sender, the name and the two floats. The acts are
`setRaidMark(icon, guid)`, `clearRaidMark(icon)` (a set of guid 0),
`requestRaidMarks()` and `pingMinimap(x, y)`, each one packet; an icon
outside 0-7 throws before any send. The harness writes one `passive`
row `mark` for a set with a setter and a target, or a clear by a named
member, no row for the server's own clear (who 0) or for a list, and one
`passive` row `ping` with the distance and direction from the
character when its position is known.

Summons: `SMSG_SUMMON_REQUEST` sets `summon` (summoner guid, the
summoner's name from the roster or an empty string, zone id, zone name
and `expiresAt`, the receive time plus the packet's timeout) and emits
`summon_requested`. The runtime holds one timer for the offer; at
`expiresAt` it clears the offer and the store emits `summon_expired`. A
newer request replaces the offer and restarts the timer; an expiry set
for an older offer clears nothing. `answerSummon(accept)` throws
`no_summon` when no offer is pending, otherwise sends the summoner
guid and one byte and clears the offer, so a second answer throws. The
zone name comes from `AreaTable.dbc` (name column 11) when
`spell_data_dir` holds the file; without it the event carries no zone
name and the harness row reads `zone <id>`. A request that arrives
before the file has loaded is also named by id. The harness writes one
`wake` row `summon` (`<name> summons you to <zone>. Answer within <n>
s.`; the name falls back to the unit lookup, then `Someone`) and one
`passive` row `summon_expired`. The puppet call is `answerSummon` with
`accept` or `decline`.

## Wire notes

- `SMSG_GROUP_LIST` (type, own subgroup/flags/roles, the dungeon-finder
  insert, group guid, counter, member count, one row per member except
  self, leader guid, loot block) is written by `Group::SendUpdateToPlayer`
  (`Groups/Group.cpp:1900-1950`).
- `SMSG_GROUP_LIST` skips the receiving member
  (`Groups/Group.cpp:1917-1918`), so the legacy party code resolves
  names only through the other members.
- `SMSG_GROUP_LIST` marks bit `0x01` of the member status as online; a
  battleground member carries bit `0x02` (`Groups/Group.cpp:1920-1923`),
  which still reads as offline here.
- `SMSG_GROUP_LIST` member flags are assistant `0x01`, main tank `0x02`
  and main assist `0x04`, written per member
  (`Groups/Group.cpp:1928`).
- The `SMSG_GROUP_LIST` counter is `Group::m_counter`, so it belongs to
  one group and rises on every send of that group
  (`Groups/Group.cpp:1913`).
- The group type is a flag set: `GROUPTYPE_BG` `0x01`, `GROUPTYPE_RAID`
  `0x02`, their mask `GROUPTYPE_BGRAID` and `GROUPTYPE_LFG` `0x08`
  (`Groups/Group.h:87-92`).
- `SMSG_GROUP_INVITE` with status 0 goes to an invitee who is already
  in a group (`Handlers/GroupHandler.cpp:160-176`); status 1 is a live
  invite, which the legacy code handles.
- `SMSG_PARTY_MEMBER_STATS` carries the changed fields of one member
  (`Handlers/GroupHandler.cpp:835-999`), and `SMSG_PARTY_MEMBER_STATS_FULL`
  carries the full reply to `CMSG_REQUEST_PARTY_MEMBER_STATS`
  (`Handlers/GroupHandler.cpp:1023-1135`): the full reply without the
  power-type bit defaults the power type to mana (0)
  (`Handlers/GroupHandler.cpp:1032-1033`), and the offline reply for a
  guid not in the raid carries only the status
  (`Handlers/GroupHandler.cpp:1011-1017`). The request reads one guid
  (`Handlers/GroupHandler.cpp:1002-1006`).
- `SMSG_PARTY_MEMBER_STATS` position is two `uint16` casts of floats
  (`Handlers/GroupHandler.cpp:887-889`), read here as signed `int16` so
  a negative Eversong y stays negative.
- `SMSG_PARTY_MEMBER_STATS` writes a zero pet guid when the member has
  no pet (`Handlers/GroupHandler.cpp:909-915`). A full
  `SMSG_PARTY_MEMBER_STATS_FULL` reply adds the pet name, model and
  auras even for a member without a pet
  (`Handlers/GroupHandler.cpp:1028-1037`).
- The `SMSG_PARTY_MEMBER_STATS` status word sets `MEMBER_STATUS_ONLINE`
  and, when set, `MEMBER_STATUS_PVP`, `MEMBER_STATUS_DEAD` or
  `MEMBER_STATUS_GHOST`, `MEMBER_STATUS_PVP_FFA`, `MEMBER_STATUS_AFK`
  and `MEMBER_STATUS_DND` (`Handlers/GroupHandler.cpp:841-860`).
- `SMSG_PARTY_COMMAND_RESULT` carries the operation, the member name, the
  result and a value word
  (`Handlers/GroupHandler.cpp:53-62`).
- `CMSG_GROUP_RAID_CONVERT` carries no body; the leader's convert is
  answered with operation 0 result 0 and then the raid roster, while a
  member below the raid level is refused with result 25
  (`Handlers/GroupHandler.cpp:647-670`).
- `CMSG_GROUP_CHANGE_SUB_GROUP` carries the member name and the wire
  subgroup 0-7; a value at or above `MAX_RAID_SUBGROUPS` is dropped with
  no reply (`Handlers/GroupHandler.cpp:672-707`).
- `CMSG_GROUP_SWAP_SUB_GROUP` carries two member names; bad names are
  answered with operation 4 result 14
  (`Handlers/GroupHandler.cpp:1154-1180`).
- `CMSG_GROUP_ASSISTANT_LEADER` carries the member guid and the apply
  flag (`Handlers/GroupHandler.cpp:709-726`).
- `MSG_PARTY_ASSIGNMENT` carries the role byte (main tank
  `GROUP_ASSIGN_MAINTANK` 0, main assist `GROUP_ASSIGN_MAINASSIST` 1),
  the apply flag and the member guid
  (`Handlers/GroupHandler.cpp:728-758`).
- `CMSG_GROUP_UNINVITE_GUID` carries the member guid and the reason
  (`Handlers/GroupHandler.cpp:353-360`).
- `MSG_RAID_READY_CHECK` from the server carries the initiator's guid
  (`Handlers/GroupHandler.cpp:783-787`,
  `HandleRaidReadyCheckOpcode`); the client start is empty and the
  client answer carries one state byte (`:790-800`). The server relays
  each answer to the leader and assistants and at the start sends a
  state-0 confirm for each offline member (`Groups/Group.cpp:2000`,
  `MSG_RAID_READY_CHECK_CONFIRM`). `MSG_RAID_READY_CHECK_CONFIRM`
  carries a guid and a state byte (`Handlers/GroupHandler.cpp:795-800`,
  `Handle_NULL`). The finish is sent only on a client request from the
  leader or an assistant (`Server/Protocol/Opcodes.cpp:1097`,
  `MSG_RAID_READY_CHECK_FINISHED`); there is no server timer, so
  Peon finishes its own checks after 30 s.
- `MSG_RAID_READY_CHECK_FINISHED` carries no body
  (`Server/Protocol/Opcodes.cpp:1097`, `MSG_RAID_READY_CHECK_FINISHED`).
- The `SMSG_PARTY_COMMAND_RESULT` result `raid_disallowed_by_level` is
  code 25 and `group_swap_failed` is code 14; the operation `swap` is
  code 4.
- `MSG_RAID_TARGET_UPDATE` kind 0 is `u8 0`, the setter guid as a full
  `u64`, the icon and the target guid
  (`Groups/Group.cpp:1830-1849`). `SetTargetIcon` first clears the same
  target from every other icon by calling itself with an empty guid, and
  each call broadcasts its own kind 0 packet with who 0 and target 0
  (`Groups/Group.cpp:1835-1839`); the set follows to every member
  including the setter (`Groups/Group.cpp:1848`). An icon of 8 or more
  is dropped (`Groups/Group.cpp:1832-1833`).
- `MSG_RAID_TARGET_UPDATE` kind 1 is `u8 1` then an `(icon, target)`
  pair for each set icon only, so it holds 0 to 8 pairs and ends with
  the packet (`Groups/Group.cpp:1851-1869`); wowm writes a fixed eight
  (`raid/raid_target.wowm`). The client request is a single `0xFF` and
  answers the sender only; an update carries the icon and the guid, is
  refused in a raid unless the sender leads or assists, and drops a
  player target that is offline or hostile
  (`Handlers/GroupHandler.cpp:610-645`).
- `MSG_MINIMAP_PING` from the server is the sender guid and two floats
  (`Server/Packets/MiscPackets.cpp:76-83`); the client form is the two
  floats (`Server/Packets/MiscPackets.cpp:70-74`). The server drops a
  ping outside a group or outside valid map coordinates
  (`Handlers/GroupHandler.cpp:584-595`) and sends it to every member
  except the sender (`Groups/Group.cpp:2272-2280`).
- The icon names star, circle, diamond, triangle, moon, square, cross,
  skull for icons 0-7 are client art: neither AzerothCore nor wowm names
  them, so that order is unconfirmed.

- `give` sends `CMSG_LOOT_MASTER_GIVE` only after the checks the server
  makes: the sender is the master looter, the corpse is open, and the
  target is in the candidate list; a bad slot or a full bag answers a
  loot error, and the server removes the slot before it sends the new
  item (`Handlers/LootHandler.cpp:483-500`).
- The master list reaches the master when the first player opens a
  master-looted corpse (`Groups/Group.cpp:1444,1482-1492`); the tool
  reads the candidates from that reply and refuses a name outside it.
- `pass_loot` sets the opt-out flag and gets no reply
  (`Handlers/GroupHandler.cpp:1143-1152`).
- `roll` answers only the roll the agent names or the single open roll;
  Peon never rolls by itself.
- `SMSG_SUMMON_REQUEST` is the summoner guid (`uint64`), the summoner's
  zone (`uint32`) and the auto-decline time in milliseconds (`uint32`),
  written by `Spell::EffectSummonPlayer` (`Spells/SpellEffects.cpp:4442-4446`).
- The auto-decline time is `MAX_PLAYER_SUMMON_DELAY * IN_MILLISECONDS`,
  which is 120 s (`Entities/Player/Player.h:923`).
- `CMSG_SUMMON_RESPONSE` is read only when the player is alive and out of
  combat (`Handlers/MovementHandler.cpp:872-873`); it holds the summoner
  guid (`uint64`) and the answer (`uint8`)
  (`Handlers/MovementHandler.cpp:879-881`).
- The offer is cleared on a decline, an accept after the offer expired is
  ignored, and an answer with no offer returns at once
  (`Entities/Player/Player.cpp:12691-12700`).
- The summon request is seen live through the Stormwind meeting stone
  179595 (map 0), not through a lone stone use. The stone runs
  `GameObject.cpp:1902-1927` and casts spell 23598, which triggers the
  ritual (`Spells/SpellEffects.cpp:1124`) and spawns the two-participant
  summoning portal 179944 (type 18, `reqParticipants` 2). The request
  itself comes from `Spell::EffectSummonPlayer`
  (`Spells/SpellEffects.cpp:4415-4445`) once the second group member
  clicks the portal (`GameObject.cpp:1810-1870`).
- Live proof: two level-15 `elwynn10` characters placed at the stone with
  `soap setup position`. A selected B and sent `CMSG_GAMEOBJ_USE` for
  the stone, then A and B each sent it for the portal. B's trace holds
  `in` `SMSG_SUMMON_REQUEST` size 16 (summoner A, zone 1519, timeout
  120000 ms) and, after `answerSummon accept`, `out`
  `CMSG_SUMMON_RESPONSE` size 9. The traces are kept in the worker's
  artifact directory, not committed.
- The Orgrimmar stone 179596 is on map 1; no use of it is claimed. The round 328 summon run
  graded `fail` with 0 of 2 checks met: its agent trace holds no
  `CMSG_GAMEOBJ_USE` and no `SMSG_SUMMON_REQUEST`.
- Eval `t9-raid-summon` (round 408, replica 4,
  `tmp/evals/408/t9-raid-summon-4/result.json`) passed 2 of 2: two
  partners joined the agent's group, one used the stone on the agent and
  the other the portal, the game log holds `raid/summon`, and `group`
  with `do` `summon` and `what` `accept` answered `DONE`. Its
  `packets.jsonl` holds `in` `SMSG_SUMMON_REQUEST` then `out`
  `CMSG_SUMMON_RESPONSE`. Replicas 1 to 3 aborted on scenario staging (a
  partner not in the group, then too far from the stone), not on the
  game.
- The stone use requires the user and the selected target in the same
  group with both at or above the stone's min level. The `group` tool
  answers a pending offer and refuses `no_summon` otherwise.

## Left out

- The LFG form (type `0x08`) is not seen live until `instances` forms a
  dungeon-finder group. The acts name other members only: the caller's own name throws
  `not in your party`, because the server never lists the receiving
  character in `SMSG_GROUP_LIST`. The `group` tool's `mark` refuses a
  hostile player as a target and refuses in a raid unless Peon leads or
  assists, mirroring the `MSG_RAID_TARGET_UPDATE` handler
  (`Handlers/GroupHandler.cpp:610-645`); `ping` sends the target's or
  the character's position and gets no echo, mirroring the
  `MSG_MINIMAP_PING` handler (`Handlers/GroupHandler.cpp:584-595`)
  and its broadcast (`Groups/Group.cpp:2272-2280`).

## Live evidence

Two runs on `eversong10` throwaway accounts, all deleted afterwards.
Both were kept, not committed, in the directory `live-group3` of the
`proto-group` worktree's scratch space.

The first run (accounts A Fgkllmaablf, B Fgkllmaabbk, C Fgkllmaabkl)
ran the puppets with `--packet-trace headers`; its
`<ACCOUNT>-packets.jsonl` files show opcode order only, with no packet
bodies. A's file holds the full send sequence in order: `out
CMSG_GROUP_INVITE` twice, `out CMSG_GROUP_RAID_CONVERT`, `out
CMSG_GROUP_CHANGE_SUB_GROUP`, `out CMSG_GROUP_SWAP_SUB_GROUP`, `out
CMSG_GROUP_ASSISTANT_LEADER`, two `out MSG_PARTY_ASSIGNMENT`, a second
`out CMSG_GROUP_SWAP_SUB_GROUP` (the bad-name raw send), `out
CMSG_GROUP_UNINVITE_GUID`, a third `out CMSG_GROUP_INVITE` for the
regroup, and a second `out CMSG_GROUP_RAID_CONVERT` for the level
refusal. `in SMSG_GROUP_LIST` follows each act, `in
SMSG_PARTY_COMMAND_RESULT` answers the two converts and the bad swap,
and `in SMSG_GROUP_DESTROYED` answers the uninvite.

The second run (A Fgkllmaabng, B Fgkllmaabln, C Fgkllmaabgo) repeated
the same steps and saved A's `events --json` output after each step,
in the subdirectory `round2` as `A-events-<NN>-<step>.json`. Every
state and result claim below is read from those files, in step order:

- Step 1: A invited B and C by `call invite`; both accepted with `call
  acceptInvite`.
- Step 2, `call convertToRaid`: one `command_result` on the `group`
  hook with `operation` 0, `target` empty, `result` 0, and one
  raid-area `command_result` `invite` / `ok`; the following
  `group_list` carries the `converted` change.
- Step 3, `call moveToSubgroup '["<B>", 2]'`: a `group_list` whose
  change is `subgroup` for B, `from` 0, `to` 1.
- Step 4, `call swapSubgroups '["<B>", "<C>"]'`: two `group_list`
  events, B `subgroup` from 1 to 0, then C `subgroup` from 0 to 1.
- Step 5, `call setAssistant '["<B>", "on"]'`: a `group_list` change
  `flag` `assistant`, `on` true, for B.
- Steps 6 and 7, `call setMainTank` and `call setMainAssist` with
  `"on"`: `group_list` changes `flag` `main_tank` and then
  `main_assist`, `on` true, for B. B's member `flags` read 7 in step
  9's roster.
- Step 8, a raw `CMSG_GROUP_SWAP_SUB_GROUP` with the name `Nobody`
  twice: a `command_result` with `operation` 4, `target` `Nobody`,
  `result` 14, and a raid-area `command_result` `swap` /
  `group_swap_failed`. The tool refuses the same call before any send
  with `not in your party`, so no `out` row is written for it.
- Step 9, after B and C stopped, `call uninviteGuid '["<C>", "test"]'`:
  a legacy `group_list` whose change lists C in `removed`, then a
  raid-area `group_list` with `changes` `[{"kind":"left","name":"<C>"}]`.
  A `group_destroyed` event follows, then an empty `group_list` (A left
  alone) and a raid-area `disbanded` event.
- Steps 10 and 11, B set to level 9 by GM, B logged in again, A
  invited B and B accepted, then `call convertToRaid`: a
  `command_result` with `operation` 0, `result` 25, and a raid-area
  `command_result` `invite` / `raid_disallowed_by_level`.

Three `eversong10` throwaway accounts A, B and C ran through their
puppets with `--packet-trace headers`: A invited B, B accepted, then C
(in no group) invited A. Kept, not committed, in the directory
`live-raid-fix1` of the `proto-group` worktree's scratch space, one `<ACCOUNT>-packets.jsonl` and one
`<ACCOUNT>-events.json` per account:

- A's trace holds `out CMSG_GROUP_INVITE`, `in SMSG_GROUP_INVITE` and
  three `in SMSG_GROUP_LIST`; A's events hold a raid `group_list` with
  `joined` for B and an `invite_blocked` for C.
- B's trace holds `in SMSG_GROUP_INVITE`, `out CMSG_GROUP_ACCEPT` and
  three `in SMSG_GROUP_LIST`; B's events hold a raid `group_list` with
  `joined` for A.
- C's trace holds the outgoing invite.

A second run over the same characters, kept under
`live-raid-fix1-regroup` of the same scratch space, found A and B still grouped from the
first run, so A's new invite of B was answered with status 0 and both
puppets logged `invite_blocked`.

Battleground groups and the self-only changes are proven by
`areaRig` tests built from the writer at `Groups/Group.cpp:1883-1950`,
not seen live.

Two throwaway accounts A (`eversong10`, Fgkllkghmhk) and B
(`ghostlands20`, Fgkllkghpll) ran through their puppets with
`--packet-trace headers`: A invited B, B accepted. Kept, not committed,
in the directory `live-group2` of the `proto-group` worktree's scratch
space, one `<ACCOUNT>-packets.jsonl` per account:

- A's trace holds `out CMSG_GROUP_INVITE`, `in SMSG_GROUP_LIST`, two
  `in SMSG_PARTY_MEMBER_STATS` (the zone and y of out-of-range B),
  `out CMSG_REQUEST_PARTY_MEMBER_STATS` (sent by the roster-add policy)
  and `in SMSG_PARTY_MEMBER_STATS_FULL`.
- a `requestMemberStats` puppet call for B wrote
  `out CMSG_REQUEST_PARTY_MEMBER_STATS` and
  `in SMSG_PARTY_MEMBER_STATS_FULL`.
- After B's puppet stopped, A's trace holds the offline
  `SMSG_GROUP_LIST` (status 0), and a later `requestMemberStats` for B
  wrote `out CMSG_REQUEST_PARTY_MEMBER_STATS` with the 10-byte offline
  `in SMSG_PARTY_MEMBER_STATS_FULL`. That run's events file was empty,
  so the second run below is the proof of the `offline` event.

A second run repeated the pair with an `eversong10-hunter` account A
(Fgkllkkgkjo) and an `eversong10` account B (Fgkllkkhgne), both puppets
started with `--packet-trace bodies`. Kept, not committed, in the
directory `live-group2-fix2` of the same scratch space: both packet
traces and the `events --json` reads.

- B's trace holds the hunter's `in SMSG_PARTY_MEMBER_STATS_FULL`
  (77 bytes). Decoded, it has zone 3430, x 8735, y -6685 (a negative
  `int16`), and the pet fields for the hunter's starting pet: guid
  `0xf140000d730004ff`, name `Ravager`, model 17061, health 344 of 344,
  power type 2 and power 100 of 100. The pet was already summoned at
  login, so the pet fields were seen live.
- A's trace holds the 49-byte full reply for B with the same zone and
  y. Before B logged out, A's events hold `member_stats` for B with the
  `online` transition.
- After B's puppet stopped, A's trace holds the offline
  `SMSG_GROUP_LIST` (status 0) and, after a `requestMemberStats` for B,
  the 10-byte offline `in SMSG_PARTY_MEMBER_STATS_FULL`
  (`00032a0f010000000000`). A's events then hold `member_stats` for B
  with the `offline` transition. Removal clears both stores' pet state,
  proven by `areaRig` tests, not seen live.

A `group-9a` run with two `eversong10` throwaway accounts (A leader,
B partner) through their puppets, A's with `--packet-trace headers`
(accounts deleted, trace not committed):

- A's trace holds `out CMSG_GROUP_INVITE`, `in SMSG_PARTY_COMMAND_RESULT`
  (invite ok), `in SMSG_GROUP_LIST` with the partner joined,
  `out CMSG_GROUP_UNINVITE`, `in SMSG_LFG_UPDATE_PARTY`,
  `in SMSG_GROUP_DESTROYED` and a final `in SMSG_GROUP_LIST`.
- A's events hold the raid `group_list` with `joined` for the partner,
  then the raid `disbanded` after the kick of the last member (a party
  of two disbands, so no `left` row reaches the kicker).
- Both sides' `group list` console reads match "not in a group" after
  the kick: `Group type` reads `Party` with 2 players while grouped,
  and `<name> is not in a group!` after the disband
  (`Commands/cs_group.cpp:220-224`).

`group-9b` live proof re-ran the verbs through the `group` tool's acts on
two `eversong10` throwaway accounts (A Fgkllppeenl the leader, B
Fgkllppegba the partner; both deleted, trace not committed):

- A's trace shows `out CMSG_GROUP_RAID_CONVERT` then `in
  SMSG_PARTY_COMMAND_RESULT` (op 0, result 0,
  `Handlers/GroupHandler.cpp:647-670`) and a raid `group_list` with the
  `converted` change.
- The console read matches `Group type: Raid and consists of 2 players`
  (`Commands/cs_group.cpp:220-224`).
- A's trace shows `out CMSG_GROUP_CHANGE_SUB_GROUP` then `in
  SMSG_GROUP_LIST`, and the events show the `subgroup` change for B
  from 0 to 1.
- A's trace shows `out CMSG_GROUP_ASSISTANT_LEADER` then `in
  SMSG_GROUP_LIST`, and the events show the `flag` `assistant` change
  for B, `on` true. The raw act calls only accept JSON numbers, so the
  first two puppet `call` tries with a string group failed in the puppet
  layer and sent nothing.
- A's trace shows `out MSG_PARTY_ASSIGNMENT` then `in SMSG_GROUP_LIST`
  with B's flags reading main tank. The assistant flag arrives only on
  the second toggle because the server answers the first toggle without
  a list, so the tool settles on the next change.
- `setLootMethod` with A's own guid as master wrote the `loot` change
  with method 2 and threshold 3, and the legacy list shows
  `master_loot` with threshold `rare` (`Handlers/GroupHandler.cpp:516-545`).

`group-7` live proof on two `eversong10` throwaway accounts (A leader,
B partner, both deleted; traces and event reads not committed), both
puppets on `--packet-trace headers`, grouped, with a Red Dragonhawk
Hatchling from `nearby` as the target:

- `call setRaidMark` on A: A's trace holds `out MSG_RAID_TARGET_UPDATE`
  size 9 then `in` size 18, and B's trace holds `in` size 18. Both
  sides' events hold `raid_mark` with the icon, the target and A as
  `who` (A's own event has an empty name, because the roster never
  lists the receiving character). A plain party lets any member mark
  (`Handlers/GroupHandler.cpp:631-632`).
- A `setRaidMark` with target 0 on the same icon emitted `raid_mark`
  with target 0 and who A on both sides.
- `call requestRaidMarks` on A: `out MSG_RAID_TARGET_UPDATE` size 1
  then `in` size 10, and a `raid_marks` event whose eight slots hold the target in its slot
  (`Groups/Group.cpp:1851-1869`).
- Moving an `MSG_RAID_TARGET_UPDATE` mark to a second icon: B received
  two size 18 packets, first a clear of the old icon with who 0 and
  target 0, then the set (`Groups/Group.cpp:1835-1848`).
- `call pingMinimap '[8735, -6685]'` on B, B's own position: A's trace
  holds `in MSG_MINIMAP_PING` size 16 and A's events hold `minimap_ping`
  with B's name and the two floats; B's trace holds no `in` ping, so the
  sender gets no echo (`Groups/Group.cpp:2272-2280`).

## Capabilities row

No verb (N23).

Remove a member with a reason (`t9-raid-kick`, round 65 replica 2,
round 69 replica 1 and round 75 replica 1, all `pass` 3/3; run
directories not committed): the agent joined, took the lead on the timer
handoff, and kicked the partner with reason `test`; the game log shows
the raid `roster` disband row and the partner console read matches "not
in a group". A party of two disbands, so the kicker sees `disbanded`,
not a `left` row: `Group::RemoveMember` disbands when the group size
before removal is at most two (`Groups/Group.cpp:769-774`). The round 69
run needed the rescue nudge because the leader change does not wake an
idle agent. Round 75 re-ran on the `ghostlands` spawn after the
spawn-slot fix and passed with the same shape (kick `DONE`, disband row,
partner alone).

Run a raid (`t9-raid-convert`, round 78 replica 1, `pass` 6/6; run
directory not committed): the agent joined, took the lead after the
timer handoff and the scripted steer, then called `group` with `raid`,
`move` to group 2, `promote` assistant and `promote` main_tank, all
`DONE`. The game log shows the four roster rows (converted, subgroup,
assistant, main tank) and the console read matches a raid of 2 players.
Round 77 failed 0/6 because the passive leader handoff did not wake the
idle agent; the steer at 100 s fixed the scenario.

Set loot rules and give master loot (`t9-raid-master-loot`, round 84 replicas 1-3, `fail` 2/4 each; run directories not committed): the agent set master loot with itself as looter every time (roster loot row, `DONE`), and the game log shows the `looting/master_loot` candidate row with the master named. No replica moved an item through `give`: replica 1 named the placeholder `item` against a window of item ids, replica 2 named creature names and `Springpaw Pelt` against item ids, replica 3 looted the Lynx Meat (item 27668) normally before calling `give`. The tool now maps the caller's own character name to `@self` (the server lists only the master as candidate) and the task names the shown item id. `roll` and `pass_loot` stay unit-tested only: a group roll needs an uncommon drop and `pass_loot` has no server reply.

Mark a target (`t9-raid-mark`, round 90 replica 1, `pass` 3/3; run directory not committed): the agent joined the invited party, marked the nearest hostile Springpaw Stalker with skull through the group tool, and told the group in party chat. The game log shows the `raid/mark` row with icon 7 and the setter's name and the `chat/out` party row, and the packet trace holds `out MSG_RAID_TARGET_UPDATE` size 9 then `in` size 18. The target was a Stalker, not a Lynx: the spawn point holds no Lynx in range, so the agent marked the nearest hostile of the same family. An earlier round 90 replica failed 0/3 because the agent tried `accept_invite` before the partner invite arrived and the repeat guard refused the retry, so it never joined; the next wording was reverted to match the sibling scenarios.

## Proof

| Opcode | Proof | Evidence | Source |
|---|---|---|---|
| `CMSG_REQUEST_PARTY_MEMBER_STATS` | `live` | A's trace: roster-add request, `requestMemberStats` call, offline reply after B stopped | `live-group2` scratch dir |
| `CMSG_GROUP_RAID_CONVERT` | `live` | A's trace: `out` row, then `in SMSG_PARTY_COMMAND_RESULT` (op 0, result 0) and the raid roster; the level-9 rerun answers result 25 | `live-group3` scratch dir |
| `CMSG_GROUP_CHANGE_SUB_GROUP` | `live` | A's trace: `out` row, then the roster with B moved to group 2 | `live-group3` scratch dir |
| `CMSG_GROUP_SWAP_SUB_GROUP` | `live` | A's trace: `out` row, then the rosters swapping B and C; the bad-name raw send answers `SMSG_PARTY_COMMAND_RESULT` op 4 result 14 | `live-group3` scratch dir |
| `CMSG_GROUP_ASSISTANT_LEADER` | `live` | A's trace: `out` row, then the roster with B flagged assistant | `live-group3` scratch dir |
| `MSG_PARTY_ASSIGNMENT` | `live` | A's trace: two `out` rows, then the rosters with B flagged main tank and main assist | `live-group3` scratch dir |
| `CMSG_GROUP_UNINVITE_GUID` | `live` | A's trace: `out` row, then `SMSG_GROUP_DESTROYED`; A's events: roster change with C in `removed`, then `group_destroyed` and an empty roster | `live-group3` scratch dir |
| `MSG_RAID_READY_CHECK` | `live` | A starts: A's trace holds `out` size 0 then `in` size 8, B's trace holds `in` size 8; B starts: B's trace holds `out` size 0 then `in` size 8, A's trace holds `in` size 8 | not committed |
| `MSG_RAID_READY_CHECK_CONFIRM` | `live` | B answers ready: B's trace holds `out` size 1, A's trace holds `in` size 9; A answers not ready to B's check: A's trace holds `out` size 1, B's trace holds `in` size 9; B starts with A offline: B's trace holds `in` size 9 with the offline answer for A | not committed |
| `MSG_RAID_READY_CHECK_FINISHED` | `live` | B's answer completes A's check: A's trace holds `out` size 0, both traces hold `in` size 0; A's answer completes B's check the same way; the offline answer completes B's check without waiting | not committed |
| `MSG_RAID_TARGET_UPDATE` | `live` | A sets a mark: A's trace holds `out` size 9 then `in` size 18 (kind 0, the setter included), B's trace holds `in` size 18; A requests the list: `out` size 1 then `in` size 10 (kind 1 with one pair); moving a marked target to a second icon: B's trace holds two `in` size 18 packets, the first a clear of the old slot with who 0 and target 0 | not committed |
| `MSG_MINIMAP_PING` | `live` | B pings at its own position: B's trace holds `out` size 8, A's trace holds `in` size 16 and B's trace holds no `in` | not committed |
| `CMSG_GROUP_CANCEL` | `dead` | the server ignores it: no handler | `Server/Protocol/Opcodes.cpp:243` |
| `SMSG_REAL_GROUP_UPDATE` | `dead` | `STATUS_NEVER` and no send site in AzerothCore | `Server/Protocol/Opcodes.cpp:1050` |
| `SMSG_SUMMON_REQUEST` | `live` | the Stormwind stone try: B's trace holds `in` size 16 after A's stone use and both portal clicks (summoner A, zone 1519, timeout 120000 ms); eval `t9-raid-summon` round 408 replica 4: the agent's `packets.jsonl` holds `in` `SMSG_SUMMON_REQUEST`, and the game log holds `raid/summon` | `Spells/SpellEffects.cpp:4442` |
| `CMSG_SUMMON_RESPONSE` | `live` | B's trace after `call answerSummon '["accept"]'` holds `out` size 9 (summoner guid and byte 1); eval `t9-raid-summon` round 408 replica 4: the agent's `packets.jsonl` holds `out` size 9 right after the `in` request and `group` answered `DONE`; earlier, a raw response with no offer left the account connected (`tmp/probe/FAC6ABD9E3164-20260930T234539Z/packets.jsonl`, not committed) | `Handlers/MovementHandler.cpp:872-873` |

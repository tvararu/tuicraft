# looting

The `looting` area keeps who may loot each corpse and the character's
request to pass on group loot rolls. World-service code reads it through
`session.areas.looting.state()`: `owners` maps each creature guid to its
master looter, its group looter and `mine` (`yes`, `no` or `unknown`),
for the 64 newest kills; `masterCandidates` maps each opened corpse guid to the candidate guids from its `SMSG_LOOT_MASTER_LIST`, kept across loot window close and re-open until the creature disappears; `passOnLoot` is
the last requested pass flag. The area emits one `loot_owner` event per
`SMSG_LOOT_LIST`, one `master_loot_candidates` event per
`SMSG_LOOT_MASTER_LIST`, one `loot_removed` event per peeked
`SMSG_LOOT_REMOVED`, and one `loot_error` event per peeked
`SMSG_LOOT_RESPONSE` with loot type 0. An owner goes away when its creature disappears. The
act `setPassOnLoot(pass)` sends `CMSG_OPT_OUT_OF_LOOT` and sets
`passOnLoot` at once, because the server sends no reply. The act
`setLootMethod({ method, threshold, master })` sends `CMSG_LOOT_METHOD`
from names: `method` is `free_for_all`, `round_robin`, `master_loot`,
`group_loot` or `need_before_greed`, `threshold` is `uncommon`, `rare`,
`epic`, `legendary` or `artifact`, and `master` is the name of another
party member, empty for none, or the `@self` token for the character
itself. An unknown method or threshold, or a
master outside the party (`not in your party`), throws before any send.
The act does not wait: the leader's new rules arrive in the next
`SMSG_GROUP_LIST`, which the legacy party code reads. The act
`giveMasterLoot(lootGuid, slot, name)` sends one `CMSG_LOOT_MASTER_GIVE`
to the named candidate, or `@self` for the character itself, and waits up
to 5 s: it returns `{ status: "given", slot }` when the slot's
`SMSG_LOOT_REMOVED` arrives, throws the loot error text on a
`SMSG_LOOT_RESPONSE` refusal for that corpse, and throws a timeout with
no answer. A name outside the candidates (`not a candidate`) throws
before any send. The harness
writes no game-log row for `loot_owner`, since the packet arrives on
every kill; each `master_loot_candidates` event writes one `passive`
`master_loot` row with the candidate names.

## Wire notes

AzerothCore and wow_messages agree on the five bodies
(`wow_message_parser/wowm/world/loot/smsg_loot_list.wowm`,
`wow_message_parser/wowm/world/loot/cmsg_opt_out_of_loot.wowm`,
`wow_message_parser/wowm/world/social/cmsg_loot_method.wowm`,
`wow_message_parser/wowm/world/loot/smsg_loot_master_list.wowm`,
`wow_message_parser/wowm/world/loot/cmsg_loot_master_give.wowm`).

- `SMSG_LOOT_LIST` is the full `uint64` creature guid, then the master
  looter as a packed guid and the group looter as a packed guid. The
  group form writes `uint8 0` for a missing master or looter
  (`Groups/Group.cpp:1085-1101`); the master is set only under master
  loot with an item over the threshold. The solo form writes `uint8 0`
  twice (`Entities/Unit/Unit.cpp:13615-13618`), which reads as two empty
  packed guids, so the area reads both forms the same way.
- The solo `SMSG_LOOT_LIST` goes to every player near the killer
  (`Entities/Unit/Unit.cpp:13619`), so `owners` also holds kills of
  other players. Its `mine` is `unknown`, as for a group form with no
  master and no looter, which the wire cannot tell apart from it.
  `mine` is `yes` when self is the master or the looter, and `no` when
  another player is.
- `CMSG_OPT_OUT_OF_LOOT` is a `uint32`, 1 to pass and 0 to stop passing
  (`Handlers/GroupHandler.cpp:1143-1152`).
- `SMSG_LOOT_MASTER_LIST` is `uint8` count then that many full `uint64`
  guids of the group members in loot range (`Groups/Group.cpp:1482-1492`).
  The server sends it from `Group::MasterLoot` (`Groups/Group.cpp:1442`),
  called for a creature only when the corpse is first opened (`loot->loot_type == LOOT_NONE`, `Entities/Player/Player.cpp:8271-8290`), then answers the open with `SMSG_LOOT_RESPONSE` (`Entities/Player/Player.cpp:8373-8386`); a re-open sees the same `loot_type` and no new list, so the client keeps the candidates per corpse. It is sent whatever
  the item quality (`Groups/Group.cpp:1482-1491`).
- `CMSG_LOOT_MASTER_GIVE` is the full `uint64` loot guid, then `uint8`
  slot, then the full `uint64` target guid
  (`Handlers/LootHandler.cpp:483`). The giver must be the master looter
  (`Handlers/LootHandler.cpp:484-487`), and the give checks no threshold
  (`Handlers/LootHandler.cpp:484-559`). A refusal arrives as
  `SMSG_LOOT_RESPONSE` with loot type 0 (`Entities/Player/Player.cpp:8398-8405`)
  with an error code from the `LootError` enum; a success removes the slot
  with `SMSG_LOOT_REMOVED` after `SendNewItem`
  (`Handlers/LootHandler.cpp:564-571`).
- `CMSG_LOOT_METHOD` is `uint32` method, the full `uint64` master
  looter guid and `uint32` threshold (`Handlers/GroupHandler.cpp:518-521`).
  The server drops the
  packet with no reply when the sender is not the leader, the group is a
  dungeon-finder group, the method is over 4, the threshold is outside
  uncommon to artifact, or master loot names a non-member
  (`Handlers/GroupHandler.cpp:524-540`); otherwise it answers with
  `SMSG_GROUP_LIST` to every member (`Handlers/GroupHandler.cpp:546`).

The five loot methods are 0 to 4 in the order the act names them
(`Loot/LootMgr.h:56-63`), and the thresholds are item qualities 2 to 6
(`src/server/shared/SharedDefines.h:319-323`).

The pass flag starts off in every session (`Entities/Player/Player.cpp:215`),
and a player with it on passes at once on each group roll
(`Groups/Group.cpp:1160`).

## Left out

- Self as master looter. `SMSG_GROUP_LIST` leaves the receiving player
  out of its member list (`Groups/Group.cpp:1917-1918`), and the area
  resolves names only through that list, so `setLootMethod` refuses the
  character's own name unless it is the `@self` token (SR2-group-13).
  `giveMasterLoot` accepts the same token for the character itself.

## Capabilities row

No verb. `setPassOnLoot` and `setLootMethod` are core acts that the
puppet reaches through its calls of the same names; the `group` tool of
`group-9b` and `group-10c` adds the rows.

## Proof

| Opcode | Proof | Evidence | Source |
|---|---|---|---|
| `SMSG_LOOT_LIST` | `live` | probe flow `looting-kill` (`--expect SMSG_LOOT_LIST`) on an `eversong10-warrior` moved to East Sanctum with `soap gm tele EastSanctum`, exit 0; one received, the solo form for the flow's target, which the flow printed as its owner with `mine: unknown` | `Entities/Unit/Unit.cpp:13615-13618` |
| `CMSG_OPT_OUT_OF_LOOT` | `builder` | sent live, effect not seen: `--send CMSG_OPT_OUT_OF_LOOT --body 01000000` in the same `looting-kill` probe run, exit 0 with no error, and the puppet call `setPassOnLoot ["on"]` with the character still in the world 10 s later; the effect needs a group roll on an uncommon drop. Builder test "CMSG_OPT_OUT_OF_LOOT writes u32 1 to pass and 0 to stop" | `Handlers/GroupHandler.cpp:1143-1152` |
| `CMSG_LOOT_METHOD` | `live` | two `eversong10` puppets in a party: the leader's call `setLootMethod ["master_loot", "uncommon", "<partner>"]` sent the 16-byte body with the partner's guid, and the server answered with `SMSG_GROUP_LIST` holding method 2, the partner as looter and threshold 2, read as the legacy `group_list` event with `loot.method` `master_loot`. The raw body with threshold 1 got no `SMSG_GROUP_LIST`, and the puppet stayed in the world | `Handlers/GroupHandler.cpp:516-546` |
| `SMSG_LOOT_ITEM_NOTIFY` | `dead` | `STATUS_NEVER` and no send site in AzerothCore; wow_messages has no definition | `Server/Protocol/Opcodes.cpp:487` |
| `SMSG_LOOT_MASTER_LIST` | `live` | probe flow `looting-master` (`--expect SMSG_LOOT_MASTER_LIST --bodies`) on a level 20 `eversong10` puppet in a party with a second character, master loot with itself as master, at East Sanctum, exit 0: one list of one candidate (the puppet's own low guid) arrived right after `CMSG_LOOT`, before `SMSG_LOOT_RESPONSE`; the run is not committed. An earlier corpse held only copper (`SMSG_LOOT_RESPONSE` with zero items), so the flow skips corpses without items | `Groups/Group.cpp:1482-1492` |
| `CMSG_LOOT_MASTER_GIVE` | `live` | same run: the flow sent `CMSG_LOOT_MASTER_GIVE` for slot 0 with the puppet as target; the server answered `SMSG_ITEM_PUSH_RESULT` then `SMSG_LOOT_REMOVED` for slot 0, and `soap truth` listed item 4604 in the inventory | `Handlers/LootHandler.cpp:483-487` |

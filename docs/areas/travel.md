# travel

The `travel` area keeps the character's home inn. World-service code reads
it through `session.areas.travel.state()`: `home` (map, x, y, z and area of
the bind point), `offer` (the innkeeper that offered a bind through its
gossip menu, for 60 seconds), `lastBound` (the binder and area of the last
bind) and `bindPending`. The area emits `bind_point` (reason `login` at
every login, `bound` when it answers a bind), `bind_offer` and `bound`.
The area act `bindActivate(npc)` makes an innkeeper's inn the home
and settles as `ok` with the new home, `refused` with `busy` while another
bind is pending, or `no_answer` after 5 seconds of silence.
The area tracks taxi knowledge: `known` (node ids from the last
`SMSG_SHOWTAXINODES` mask, `undefined` until the first map), `masters`
(one `{ npc, node, known }` row per flight master seen), `learnedAt`
(when the last `SMSG_NEW_TAXI_PATH` arrived) and `benchmark` (self
`PLAYER_FLAGS` bit `0x20000`). The acts `queryTaxiStatus(npc)`,
`openTaxiMap(npc)` (or with `{ enable: true }` for `CMSG_ENABLETAXI`)
and `setTaxiBenchmark(on)` settle as `ok`, `refused` with `busy` while
one of the same kind is pending, or `no_answer` after 3 seconds of
silence. `destinations(from)` reports the node's own catalog record
(`node`: name, map and coordinates) and lists the catalog's direct edges
from the node with names, list prices and known flags; `planFlight(from,
destination)` matches the destination by case-insensitive name part
and returns the cheapest chain of direct edges over known nodes with
the summed list price, refusing with `unknown_node`, `ambiguous`,
`not_known`, `no_route` or `missing_taxi_data`. `activateTaxi(npc, route)`
sends `CMSG_ACTIVATETAXI` for two nodes and `CMSG_ACTIVATETAXIEXPRESS`
for a longer route, or for a two-node route when `{ express: true }`.
`{ unchecked: true }` sends a node that is not in `known`, which the
probe uses to show `not_visited`. The act settles `ok` with the route,
list price and `instant` on `ERR_TAXIOK`, `refused` with the reply's
short name otherwise, or `no_answer` after 5 seconds of silence. A self
teleport in that window, with no reply, settles `ok` with `instant: true`;
the probe treats that as landed without waiting for `flight_landed`.

## Wire notes

- `SMSG_BINDPOINTUPDATE` is x, y, z as `float`, then the map and the area
  as `uint32`. The server sends it at every login
  (`Entities/Player/Player.cpp:11775-11779`) and when the bind spell hits
  (`Spells/SpellEffects.cpp:6652-6658`).
- `SMSG_PLAYERBOUND` is the full `uint64` guid of the binder, then the
  area as `uint32` (`Spells/SpellEffects.cpp:6663-6666`). It follows the
  bind point update of the same bind.
- `SMSG_BINDER_CONFIRM` is the innkeeper's guid only
  (`Entities/Player/Player.cpp:9118-9122`). wow_messages adds an `Area`
  after the guid for 3.3.5
  (`wow_message_parser/wowm/world/item/smsg_binder_confirm.wowm:7-13`),
  which AzerothCore does not write. AzerothCore wins: the area reads 8
  bytes.
- `CMSG_BINDER_ACTIVATE` is the innkeeper's guid
  (`Handlers/NPCHandler.cpp:293-296`). The act sends no gossip first:
  the gossip option only makes the server offer the bind.
- The server answers a bind with nothing when the character is dead, is
  not near the innkeeper, or is on an instanceable map
  (`Handlers/NPCHandler.cpp:298-307,317-319`), so the act waits 5
  seconds and then settles as `no_answer`.
- A bind casts spell 3286 and ends with a trainer buy-succeeded packet
  for that spell (`Handlers/NPCHandler.cpp:321-331`). The trainer store
  counts it only when a `train` request for that trainer and spell is
  pending, so a bind never reads as a purchase.
- `SMSG_TAXINODE_STATUS` is the flight master's full `uint64` guid, then
  `uint8` 1 when the nearest node is known (`Handlers/TaxiHandler.cpp:53-55`,
  `Entities/Player/Player.cpp:10715-10717`). The server sends one per
  visible friendly flight master at login
  (`Entities/Player/Player.cpp:10699-10720`); it answers a
  `CMSG_TAXINODE_STATUS_QUERY` with `SMSG_TAXINODE_STATUS` when the guid
  is a flight master, and stays silent otherwise
  (`Handlers/TaxiHandler.cpp:27-33,35-51`).
- `CMSG_TAXINODE_STATUS_QUERY`, `CMSG_TAXIQUERYAVAILABLENODES` and
  `CMSG_ENABLETAXI` each carry the master's full `uint64` guid
  (`Handlers/TaxiHandler.cpp:27-33,60-63`); `CMSG_ENABLETAXI` shares the
  `CMSG_TAXIQUERYAVAILABLENODES` handler
  (`Server/Protocol/Opcodes.cpp:1302`). A `CMSG_TAXIQUERYAVAILABLENODES`
  query at an unknown node learns it: the server sends empty
  `SMSG_NEW_TAXI_PATH` (`Handlers/TaxiHandler.cpp:136-139`) and a
  `SMSG_TAXINODE_STATUS` update, with no map
  (`Handlers/TaxiHandler.cpp:140-147`).
- `SMSG_SHOWTAXINODES` is `uint32` 1, the master's guid, the `uint32`
  current node, then the known-node mask (`Handlers/TaxiHandler.cpp:98-102`).
  The mask holds the player's known-node words; node `n` is word
  `(n-1)/32`, bit `(n-1)%32`. The area reads the `SMSG_SHOWTAXINODES`
  body through `wire.peek`; the legacy quest handler still owns the
  opcode and reads the first `uint32` and guid. A Blood Elf knows node
  82 from creation.
- `CMSG_SET_TAXI_BENCHMARK_MODE` is one `uint8`
  (`Handlers/MiscHandler.cpp:1580-1585`); it sets or clears the
  `PLAYER_FLAGS_TAXI_BENCHMARK` self flag, which the server also clears
  at the flight end.
- The taxi catalog reads the `TaxiNodes.dbc` and `TaxiPath.dbc` files. A
  route is a chain of direct edges; the server looks up only one direct
  edge per hop.
- `CMSG_ACTIVATETAXI` is the master's full `uint64` guid, then two
  `uint32` nodes (`Handlers/TaxiHandler.cpp:279`).
  `CMSG_ACTIVATETAXIEXPRESS` is the guid, a `uint32` count and the nodes
  (`Handlers/TaxiHandler.cpp:199`); the 3.3.5 form has no `total_cost`.
- `SMSG_ACTIVATETAXIREPLY` is one `uint32` code
  (`Handlers/TaxiHandler.cpp:303`). The 13 codes are `ok`,
  `server_error`, `no_such_path`, `not_enough_money`,
  `too_far`, `unknown_5`, `not_visited`, `busy`, `mounted`,
  `shapeshifted`, `moving`, `same_node` and `not_standing`. An unknown
  code is `unknown_<n>`.
- A hop with no direct path gets no reply at all: the server clears the
  destination list and returns before sending. The same silence happens
  when movement is disabled.
- `CMSG_MOVE_SPLINE_DONE` is the packed mover guid, the movement info
  and one `uint32` spline id (`Handlers/TaxiHandler.cpp:208-214`). The
  taxi branch (`Handlers/TaxiHandler.cpp:216-257`) returns while a
  destination remains and runs `CleanupAfterTaxiFlight` when one node is
  left; at a single-map flight's end the server finalizes the flight
  itself (`FlightPathMovementGenerator::DoFinalize`, which clears
  `UNIT_FLAG_TAXI_FLIGHT`), so the send has no visible effect. Control
  sends exactly one when the spline duration has elapsed and
  `TAXI_FLIGHT` is still set, and none when the flag already cleared.
- A self `SMSG_MONSTER_MOVE` starts a flight the way the server launches
  it: `DoReset` sets `UNIT_FLAG_TAXI_FLIGHT` and calls `SetFly`, which
  keeps only the flying flag (`0x2000`) and thereby selects catmull-rom
  interpolation.
- A self `SMSG_MONSTER_MOVE` stop spline during the flight sets the server
  pose and the landing endpoint to the stop point, and the flag clearing
  with no stop spline lands at the last spline point.
  The in-flight predicted pose stays unknown: the motion store cannot
  evaluate a non-cyclic flying catmull-rom path, and the end point is
  enough for correctness.
## Harness verbs

`interact` with `do: "bind"` makes the inn of a nearby innkeeper the
home. It walks to the innkeeper first, sends `bindActivate` once and
reports `Home is now <area>.` from the area's `home_set` row. The send
must come from within the interaction distance, so the walk ends inside
it; the server drops a bind from farther away without an answer
(`Handlers/NPCHandler.cpp:298-307`). A silent server is `UNCONFIRMED`.
`look` with `find: "innkeeper"` lists the innkeepers in view.

`travel` with `to: "hearth"` uses the hearthstone (item 6948, spell
8690) and waits for the teleport. The item use packet carries the full
item guid, not the low guid
(`Handlers/SpellHandler.cpp:58-71`), and the spell's destination is the
home the server keeps (`Spells/Spell.cpp:1441-1444`). The step refuses
without the stone, while the spell is on cooldown, in combat or in
flight. A cast that ends without a teleport is `interrupted`.
The Hearthstone is an item, so `spell` `cast` of it refuses with `travel` `to: "hearth"` as the next call; the `travel` description names `to: "hearth"` too.
`travel` with `to: "<N> yd <direction>"` (for example `"10 yd north"`) walks N yards from the current server pose in one of the eight compass directions, up to 200 yards. The server's X axis runs north and south and its Y axis runs east and west, with larger values to the northwest (`Maps/AreaBoundary.h:78`). The verb resolves the form to the matching point and walks the same point-destination path as coordinates, so it refuses what the same point as coordinates refuses.

`travel` with `to: "fly <destination>"` walks to the nearest flight
master in view and opens the taxi map; a `learned` reply (the first query
at an unknown node) opens it once more. The current node is the
`currentNode` of that `taxi_map`, never a guess from coordinates. The
verb plans from that node with `planFlight`, sends `activateTaxi` and
waits for the `flight_landed` event; an instant teleport (the server's
`InstantFlightPaths`) settles at once. The run holds the claim from
the walk until the landing, so moves during the flight refuse with
`in_flight`. A landing the `DONE` fly result already reports stays with
that call, so it starts no second turn; a landing after the call returned
(an aborted `PARTLY` flight, or a later landing) still wakes the agent.
With no flight master in view it walks only to a known node on the same
map within 300 yd, else it refuses `no_flight_master`; it never plans a
route across zones. A mounted character gets "Get off your
mount first." with no next call. A landing is not waited for longer than
20 minutes (`no_landing`, `UNCONFIRMED`). Each `planFlight` and
`activateTaxi` refusal is one short refusal with its reason; an
ambiguous name lists the matches.

`interact` at a flight master prints the destinations known from its
node with list prices and a `travel` call for the first one. `look` with
`find: "flight_master"` lists the flight masters in view or remembered.
The store records a flight spline's duration only from the character's own non-cyclic flying `SMSG_MONSTER_MOVE` (`Movement/Spline/MoveSplineInit.cpp:115-124` writes the moving unit's packed GUID via `SendMessageToSet`, so the peek must filter on it). The harness log rows are `travel/node_learned`, `travel/flight_started`, `travel/flight_landed` (a wake) and `travel/flight_refused`. A fresh node discovery sends `SMSG_NEW_TAXI_PATH` and status with no map (`Handlers/TaxiHandler.cpp:89-102` sends `SMSG_NEW_TAXI_PATH` and status with no map when `SendLearnNewTaxiNode` learns an unknown node); the store remembers the pending learn and emits `taxi_node_named` once the re-query's `SMSG_SHOWTAXINODES` supplies the current node, which the runtime resolves against the taxi catalog for the `node_learned` text.

`travel` on the ground picks the floor from two sources that keep different
jobs. The height data (`findHeights`) is the only source of a walked z:
every point of a route sits on a surface it lists. The navmesh decides
which of those surfaces can be walked: its path gives the xy route, and a
surface with no polygon is not a floor. A mesh corner z is a hint, not a
surface. Surfaces within 0.25 yd of each other are one floor, and the
merged floor reports the highest. A mesh corner more than one climb above
the walked ground is accepted when no height in its column is within that
climb of the corner z; a corner below the ground, or above it with a data
surface near its z, still refuses because the walk is on another floor.
When the trace is lost along a polygon edge the column fallback takes the
standable floor nearest the walker and refuses only when several clear
floors are in reach. A point without a z plans each floor of its column:
one floor the mesh routes is the destination, several still refuse with
`ambiguous_floor` listing only those floors, and none refuses with the most
specific cause. A creature target takes the column floor within 0.25 yd of
the creature's observed z and never falls back to another floor when that
floor has no route. A pocket where collision data refuses the mesh
corridor stays refused: in Silvermoon City the route from the landing at
the flight master to a point 20 yd east runs 70 yd south through the stair
base, the mesh corner there is 14.93 while the column holds 16.68 and
14.67, and the 14.67 floor passes under a surface 0.55 yd above it, so
`path_corner_disagrees` is correct. The explore fallback blocks that
bearing.

A walk longer than 100 yd on foot names the ground-mount `spell` call that mounts when the character knows an outdoor-only ground mount: the hint fires for unmounted point and unit starts on maps 0, 1, 530 and 571, and stays silent indoors. Indoors follows the server's `IsOutdoors` area test: the hint reads the current area's `AreaTable.dbc` flags through the client DBC data the harness already reads, and an area flagged inside (without outside) gets no hint, the same no-hint as a missing area id, missing DBC data or an unreadable table (`Entities/Object/Object.cpp:3196-3201`, `Maps/Map.cpp:1486-1489`, `Spells/Spell.cpp:5911-5913`).

## Capabilities row

`t8-travel-bind-inn`: make an inn its home. `t8-travel-hearth-home`:
use the hearthstone to go home. `t8-travel-fly`: fly to Silvermoon City
and walk ten yards north. All are in
[capabilities.md](../capabilities.md).

## Proof

| Opcode | Proof | Evidence | Source |
|---|---|---|---|
| `SMSG_TAXINODE_STATUS` | `live` | probe flow `travel-taxi` on a `ghostlands20` character: `CMSG_TAXINODE_STATUS_QUERY` sent (8-byte guid), status reply follows; `login` flow near the Tranquillien master sent none (out of view) | `Handlers/TaxiHandler.cpp:53-55` |
| `CMSG_TAXINODE_STATUS_QUERY` | `live` | probe flow `travel-taxi`, exit 0; the status reply follows the send | `Handlers/TaxiHandler.cpp:27-33` |
| `CMSG_TAXIQUERYAVAILABLENODES` | `live` | probe flow `travel-taxi`: first send learns node 83 (`SMSG_NEW_TAXI_PATH` + status, no map), second send returns the 72-byte `SMSG_SHOWTAXINODES` | `Handlers/TaxiHandler.cpp:60-71` |
| `CMSG_ENABLETAXI` | `live` | probe flow `travel-taxi`: the send returns the 72-byte `SMSG_SHOWTAXINODES` (same handler as the query) | `Server/Protocol/Opcodes.cpp:1302` |
| `SMSG_NEW_TAXI_PATH` | `live` | probe flow `travel-taxi`: empty body on the first query at unknown node 83 | `Handlers/TaxiHandler.cpp:136-139` |
| `CMSG_SET_TAXI_BENCHMARK_MODE` | `live` | probe flow `travel-taxi`: both sends accepted, act settles `ok`; the flag bit shows in the self update | `Handlers/MiscHandler.cpp:1580-1585` |
| `SMSG_BINDPOINTUPDATE` | `live` | probe flow `login` (`--expect SMSG_BINDPOINTUPDATE`) on an `eversong10` character, exit 0; the report has no `not_implemented` notice for it | `Entities/Player/Player.cpp:11775-11779` |
| `SMSG_PLAYERBOUND` | `live` | probe flow `travel-bind` (`--expect SMSG_PLAYERBOUND --expect SMSG_BINDPOINTUPDATE`) at Falconwing Square, exit 0; the binder is the innkeeper | `Spells/SpellEffects.cpp:6663-6666` |
| `SMSG_BINDER_CONFIRM` | `live` | probe flow `travel-bind` with `--arg gossip=1` (`--expect SMSG_BINDER_CONFIRM`), exit 0; an 8-byte body | `Entities/Player/Player.cpp:9118-9122` |
| `CMSG_BINDER_ACTIVATE` | `live` | probe flow `travel-bind`, exit 0; `SMSG_BINDPOINTUPDATE` with the inn's area and `SMSG_PLAYERBOUND` follow the send, and the act settles `ok` | `Handlers/NPCHandler.cpp:293-296` |
| `CMSG_ACTIVATETAXI` | `live` | probe flow `travel-fly` on `FAC6ABDA53EE1` (`ghostlands20`, Tranquillien learned): two sends, the known route settled `ok` for nodes 83 to 82 at list price 110; `soap truth` money fell from 200000 to 199895 | `Handlers/TaxiHandler.cpp:279` |
| `SMSG_ACTIVATETAXIREPLY` | `live` | both `travel-fly` runs: `not_visited` for an unvisited node and `ok` for the known route; both bodies are 4 bytes | `Handlers/TaxiHandler.cpp:303` |
| `CMSG_ACTIVATETAXIEXPRESS` | `live` | probe flow `travel-fly` with `express=1`: two 20-byte sends (guid, count, two nodes, no total cost); the unvisited node refused `not_visited` and the known route settled `ok`; money fell another 105 | `Handlers/TaxiHandler.cpp:199` |
| `CMSG_MOVE_SPLINE_DONE` | `builder` | probe flow `travel-land` on `FAC6ABDC02AB1` (`ghostlands20`, Tranquillien to Silvermoon, nodes 83 to 82 at list price 110): `CMSG_ACTIVATETAXI` sent, `SMSG_ACTIVATETAXIREPLY ok` follows, the first `SMSG_MONSTER_MOVE` arrives 9 ms later, then `SMSG_DISMOUNT` at 1790820531146 and one `CMSG_MOVE_SPLINE_DONE` sent live at 1790820531152 with no visible effect (the server's `FlightPathMovementGenerator::DoFinalize` dismounts and clears `TAXI_FLIGHT` itself); trace `tmp/probe/FAC6ABDC02AB1-20261001T020741Z/packets.jsonl` | `Handlers/TaxiHandler.cpp:216-257` |
| `SMSG_FLIGHT_SPLINE_SYNC` | `dead` | registered as `STATUS_NEVER` and no AzerothCore code writes it: the only other mention is its enum line (`Server/Protocol/Opcodes.h:934`) | `Server/Protocol/Opcodes.cpp:1035` |

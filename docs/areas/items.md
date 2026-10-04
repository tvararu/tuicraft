# items

The `items` area covers gear, bags, containers, item timers, sockets,
equipment sets and refunds. Core reads the whole item template the server
sends for `CMSG_ITEM_QUERY_SINGLE`: `parseItemQueryResponse` in
`packages/core/src/wow/protocol/item.ts` returns the item's slot, class
and race masks, item and required levels, required skill and spell,
stats, damage, armour, resistances, weapon delay, ammo type, bonding,
page text, lock, item set, durability, bag family, sockets, socket bonus,
gem properties, duration and limit category, with the name, quality and
on-use spells it read before.

## Wire notes

- `SMSG_ITEM_QUERY_SINGLE_RESPONSE` is written at
  `Handlers/ItemHandler.cpp:413-536`, and an unknown entry is the entry
  with the high bit set and nothing after it
  (`Handlers/ItemHandler.cpp:542-543`). The field order is: entry,
  class, subclass, sound override, the name (`Handlers/ItemHandler.cpp:418`)
  and three empty names, display id, quality, flags, flags2, buy price,
  sell price, inventory type, allowable class, allowable race, item
  level, required level, required skill and rank, required spell, honor
  rank, city rank, reputation faction and rank, max count, stackable,
  container slots, then the stats count and that many type and value
  pairs (`Handlers/ItemHandler.cpp:443-448`), scaling distribution and
  value, two damage entries of `float` min, `float` max and `uint32`
  school, armour, six resistances, delay, ammo type and the `float`
  ranged range (`Handlers/ItemHandler.cpp:469`).
- Five spell entries of `SMSG_ITEM_QUERY_SINGLE_RESPONSE` follow. A slot with no spell writes `0, 0, 0, -1, 0,
  -1` (`Handlers/ItemHandler.cpp:497-505`); the parser keeps only spells
  with a non-zero id.
- The tail of `SMSG_ITEM_QUERY_SINGLE_RESPONSE` starts at bonding (`Handlers/ItemHandler.cpp:507`): the
  description string, page text, language, page material, start quest,
  lock id, material, sheath, random property, random suffix, block, item
  set, max durability, area, map, bag family, totem category, three
  socket colour and content pairs, socket bonus, gem properties,
  disenchant skill, the `float` armour damage modifier, duration in
  seconds, limit category and holiday (`Handlers/ItemHandler.cpp:536`).
- wow_messages has the same `SMSG_ITEM_QUERY_SINGLE_RESPONSE` order
  (`wow_message_parser/wowm/world/queries/smsg_item_query_single_response.wowm`)
  but differs in sign. AzerothCore wins: it writes max count and
  stackable as `int32` (`Handlers/ItemHandler.cpp:440-441`).
- The template struct declares max count and stackable `int32`
  (`Entities/Item/ItemTemplate.h:644-645`) and armour `uint32`
  (`Entities/Item/ItemTemplate.h:652`); wowm has `u32` for the first two
  and `i32` for armour.
- A stackable of 0 or below means no stack limit
  (`Entities/Item/ItemTemplate.h:727-729`).
- Item ids with known templates, read from the live server's responses:
  25 Worn Shortsword (a main-hand weapon, inventory type 21), 4500
  Traveler's Backpack (a bag, 16 slots), 18854 Insignia of the Alliance
  (a trinket with an on-use spell), 16921 Halo of Transcendence (item set
  211, three stats, fire and frost resistance), 6948 Hearthstone and 159
  Refreshing Spring Water.
- `readInventory` in `packages/core/src/wow/inventory.ts` reads the item
  update fields the server sends to the owner: the remaining time
  (`ITEM_FIELD_DURATION`, counted down in
  `Entities/Item/Item.cpp:319-333`), five signed spell charges
  (`Entities/Item/Item.h:317`), the creator and gift creator guids, the
  raw flags with the soulbound, wrapped, readable and refundable bits
  named (`Entities/Item/ItemTemplate.h:109-121`), and the non-empty
  enchantment slots.
- The 12 enchantment slots (`Entities/Item/Item.h:167-183`, 0 based)
  each take three words from `ITEM_FIELD_ENCHANTMENT_1_1`: id, duration
  and charges (`Entities/Item/Item.h:190-197`). The update-field table
  types the third word as `u16x2`, but AzerothCore writes it as one
  `uint32` (`Entities/Item/Item.cpp:937-939`); core reads the whole
  word as the charges.
- `InventoryState.ammoId` is `PLAYER_AMMO_ID` of the self entity, the
  entry of the loaded ammo. The bags journal marks the row of that entry
  `loaded ammo` and names it in an `Ammo:` line.
- Item 5806 Fool's Stout is a timed item: a copy added to a hunter's
  bags read `duration` 7200 live. The `eversong10-hunter` preset loads
  ammo 2515 Sharp Arrow.
- A bags row is wearable when the template names an equip slot
  (`Entities/Player/PlayerStorage.cpp:129-245`; inventory type 0 names
  none) and the character's class bit is set in the template's allowable
  class (`Entities/Player/PlayerStorage.cpp:2397`) and the character's
  level is at least the required level
  (`Entities/Player/PlayerStorage.cpp:2448`). A wearable row whose item
  level beats the worn item's is an `upgrade`, by item level only; a bag
  row compares slot counts against the best equipped bag.
- A bags row shows `durability C/M` when the observed durability is
  below a quarter of the maximum, and `<time> left` while
  `ITEM_FIELD_DURATION` is nonzero (seconds remaining,
  `Entities/Item/Item.cpp:319-333`).
- `CMSG_SWAP_INV_ITEM` carries the destination slot first, then the
  source slot: `SwapInventoryItem::Read` reads them in that order
  (`Server/Packets/ItemPackets.cpp:29-33`). wow_messages lists the source
  first (`wow_message_parser/wowm/world/item/cmsg_swap_inv_item.wowm`).
  AzerothCore wins. `CMSG_SWAP_ITEM` also carries the destination bag and
  slot before the source (`Server/Packets/ItemPackets.cpp:41-47`).
- `CMSG_SPLIT_ITEM` carries a `uint32` count after the source and
  destination positions (`Server/Packets/ItemPackets.h:40`).
- `CMSG_AUTOSTORE_BAG_ITEM` names one destination bag and no slot
  (`Server/Packets/ItemPackets.cpp:108-113`). Bag 0 is `NULL_BAG`
  (`Server/Protocol/Opcodes.cpp:398`), which lets the server pick any
  free slot, and a bag slot 19-22 limits the pick to that bag
  (`Handlers/ItemHandler.cpp:967-1000`). The gear tool accepts
  `backpack` and `bag 1` to `bag 4` as destinations alongside `bags`,
  `bag 19-22` and `bag B slot S`; an ordinal `bag N` lands in the Nth
  equipped bag and a missing or full bag is refused before any packet.
  The gear tool sends every unequip through this opcode, so every
  unequip logs `items/unequipped`; a move that starts on worn gear
  reroutes the same way. An explicit `bag B slot S` unequip autostores
  into bag B then moves to slot S with the existing move act.
- The items area peeks `SMSG_INVENTORY_CHANGE_FAILURE`. A move owns a
  failure when `item1` is the moving item, or when `item1` is 0 and no
  legacy request (destroy, vendor buy, quest accept or reward, loot take)
  was pending during the move.
- Result 59 `EQUIP_ERR_NONE` (`Entities/Item/Item.h:106`) is a no-change
  notice that the server sends when an item is stored back into its own
  slot (`Handlers/ItemHandler.cpp:1001-1006`); the move settles
  `no_change`, not `refused`.
- Several move paths answer with no packet at all
  (`Handlers/ItemHandler.cpp:41-45,103-110`), so a move with no answer
  settles `unanswered` after 5 seconds.
- A bag equips into the first free bag slot, 19 to 22
  (`Entities/Player/PlayerStorage.cpp:214-218`). `readInventory` numbers
  an item inside a bag with that bag slot as `bag` and a 0-based `slot`,
  as the move opcodes do. The `soap truth` dump numbers the same item
  differently: the hearthstone moved into slot 0 of the bag in slot 19
  shows as `bag` 0, `slot` 0, so truth counts bags from 0 (seen with one
  bag equipped).
- Items used for the move proof: 36 Worn Mace (main hand, required level
  1), 4496 Small Brown Pouch (a 6-slot bag), 4344 Brown Linen Shirt
  (shirt), 2284 Rat Cloth Cloak (required level 10) and 20 of 159
  Refreshing Spring Water.

- `CMSG_OPEN_ITEM` carries the bag and slot
  (`Handlers/SpellHandler.cpp:214-216`). The server opens only an item
  with `ITEM_FLAG_HAS_LOOT` or a wrapped item, and refuses others with
  `EQUIP_ERR_CANT_DO_RIGHT_NOW` naming the item
  (`Handlers/SpellHandler.cpp:244-248`). It answers with the item's loot
  window: `SMSG_LOOT_RESPONSE` names the item guid
  (`Handlers/SpellHandler.cpp:284`, `Entities/Player/Player.cpp:8381-8384`).
  The `open` act asks the rewards store to open that guid first, so the
  loot window lands in `core.rewards`, and closes it with a failure after
  a refusal or 5 seconds with no answer.
- The gear tool snapshots the offered loot slots before taking them:
  receiving a slot removal shrinks the live window. It waits for each
  requested slot to disappear and for its matching item-push receipt
  before releasing the window. AzerothCore sends the removal before
  `SendNewItem` (`Entities/Player/Player.cpp:13896-13921`).
- `CMSG_READ_ITEM` carries the bag and slot
  (`Server/Packets/ItemPackets.cpp:65-69`). `SMSG_READ_ITEM_OK` and
  `SMSG_READ_ITEM_FAILED` carry only the item guid
  (`Handlers/ItemHandler.cpp:559-571`). On a refusal the server sends
  `SMSG_INVENTORY_CHANGE_FAILURE` naming the item before
  `SMSG_READ_ITEM_FAILED` (`Handlers/ItemHandler.cpp:565-571`), so the
  read settles `failed` with the failure's reason. An item with no page
  text draws `EQUIP_ERR_ITEM_NOT_FOUND` with no item
  (`Handlers/ItemHandler.cpp:574-575`).
- `SMSG_ITEM_TEXT_QUERY_RESPONSE` is `0`, the item guid and the text for
  a carried item, or `1` alone (`Handlers/ItemHandler.cpp:1468-1479`).
  The `1` answer names no guid, so it settles the oldest waiting query.
- Items used for the open and read proof: 5335 A Sack of Coins (has loot, no lock), 889 A Dusty Unsent Letter (page text, no required level) and 38579 Venomous Tome (page text, required level 20, so a level 10 character's read fails with `cant_equip_level_i`). `CMSG_READ_ITEM` answers `SMSG_READ_ITEM_OK` only for items whose template names page text (`Handlers/ItemHandler.cpp:552-568`); `CMSG_PAGE_TEXT_QUERY` then serves each page and its next page id (`Handlers/QueryHandler.cpp:361-391`), while `CMSG_ITEM_TEXT_QUERY` serves only carried mail text (`Handlers/ItemHandler.cpp:1461-1479`). `gear read` follows the item template's page-text id through the page chain and keeps the item-text query for items with no page id. Items with page text draw `SMSG_READ_ITEM_OK` while items without draw `EQUIP_ERR_ITEM_NOT_FOUND` (`Handlers/ItemHandler.cpp:548-575`).
- Six gear eval scenarios prove the tool end to end on the live server
  (round 21): `t8-items-equip-upgrade` wears a better weapon and puts a
  bag on, `t8-items-unequip` takes the chest into the bags,
  `t8-items-move` moves the hearthstone into the bag in bag slot 19
  (truth shows it as `bag` 0, counting equipped bags from 0),
  `t8-items-split` splits 5 of 20 water off, `t8-items-open` opens A
  Sack of Coins and keeps the copper and items (the sack's contents are
  random per character, so the check compares the money delta to the
  loot window), and `t8-items-read` reads A Dusty Unsent Letter (its
  page text is empty on this server). The server deletes conjured
  items (`ITEM_FLAG_CONJURED`, `Entities/Item/ItemTemplate.h:148`)
  from a character that was logged out for more than 15 minutes, when
  it loads the inventory (`Entities/Player/PlayerStorage.cpp:6139`).
  The eversong10 conjured food and water (5349, 5350, 43518) therefore
  vanish between the offline baseline truth and the final truth, and
  the grader drops a baseline conjured row when the final inventory
  holds none of that item.
- `t8-items-ammo` (round 21) loads 200 Rough Arrow (2512) added by the
  setup. The `eversong10-hunter` preset already has 1000 Sharp Arrow
  (2515) loaded, so the task names the Rough Arrows; with "the new
  arrows" the agent took the Sharp Arrows as done (replica 1, `fail`).
  The server answers `CMSG_SET_AMMO` with an update that sets
  `PLAYER_AMMO_ID` to 2512 about 8 ms later.
- `SMSG_ITEM_COOLDOWN` is `u64` item guid and `u32` spell
  (`Entities/Player/Player.cpp:12058-12061`). It is sent only when an
  item with an on-use spell is equipped: the spell or its category cooldown
  must exceed 3000 ms (`Entities/Player/Player.cpp:12044`), no longer
  cooldown may already run (`Entities/Player/Player.cpp:12050`), and the
  spell must not carry `SPELL_ATTR0_NOT_IN_COMBAT_ONLY_PEACEFUL`
  (`Entities/Player/Player.cpp:12054`). The equip cooldown is always 30 s
  (`Entities/Player/Player.cpp:12056`), which the packet does not carry.
  login (`Entities/Player/Player.cpp` calls `SendItemDurations`, which calls
  each item's `SendTimeUpdate`). A later packet for the
  same guid replaces the earlier one, so a timer can rise.
- `SMSG_ITEM_ENCHANT_TIME_UPDATE` is `u64` item guid, `u32` enchant slot,
  `u32` seconds and `u64` player guid
  (`Server/Packets/ItemPackets.cpp:125-133`). The senders
  (`Entities/Player/PlayerStorage.cpp`, `AddEnchantmentDuration` and
  `SendEnchantmentDurations`) divide milliseconds by 1000.
- `SMSG_DURABILITY_DAMAGE_DEATH` has an empty body
  (`Server/Packets/MiscPackets.h:183-186`). It follows a death caused by a
  creature outside a battleground (`Entities/Unit/Unit.cpp`, `Unit::Kill`)
  and a fall death (`Entities/Player/Player.cpp`, `EnvironmentalDamage`).
- `SMSG_SET_PROFICIENCY` is `u8` item class and `u32` subclass mask
  (`Entities/Player/Player.cpp:10282-10285`). The server sends one at
  login per class and mask it builds (a `max80` priest drew 8 at login),
  and `Spell::EffectProficiency` sends one when a mask gains a bit
  (`Spells/SpellEffects.cpp`). The masks start empty each
  login, so the store reports `unknown` until the first packet and names
  only the bits that are new. Class 2 is weapons and class 4 armour; other
  classes change nothing.
- `SMSG_EQUIPMENT_SET_LIST` is `u32` count, then per set a packed set guid, `u32` index, name, icon and 19 packed item guids; raw packed value `1` marks an ignored slot and `0` an empty slot (`Entities/Player/Player.cpp:14894-14922`). `SendEquipmentSetList` also runs at login, so the slice reports `known` only after the first list and a delete is confirmed by the next login list.
- `CMSG_EQUIPMENT_SET_SAVE` is a packed set guid, `u32` index, name, icon and 19 packed item guids (`Handlers/CharacterHandler.cpp:1778-1847`). A set guid of 0 (one packed byte `0x00`) creates a set and is answered with `SMSG_EQUIPMENT_SET_SAVED` = `u32` index then the packed guid (`Entities/Player/Player.cpp:14952-14959`); a non-zero guid updates in place with no reply, and a guid or index that does not match is dropped silently (`Entities/Player/Player.cpp:14927-14946`). `HandleEquipmentSetSave` refuses an index at or above 10, a name over 16 bytes and an icon over 100 bytes, all silently (`Handlers/CharacterHandler.cpp:1778-1806`), so the act refuses these before sending and only sends guids of worn or carried items.
- `CMSG_EQUIPMENT_SET_USE` is 19 entries of packed guid, `u8` bag and `u8` slot; the bag and slot are read and ignored (`Handlers/CharacterHandler.cpp:1866-1868`). Guid `1` skips the slot and guid `0` unequips into the bags, and in combat only the weapon slots are processed (`Handlers/CharacterHandler.cpp:1875-1881`). `SMSG_EQUIPMENT_SET_USE_RESULT` is sent exactly once at the end, `0` ok or `4` bags full with the swaps rolled back (`Handlers/CharacterHandler.cpp:1946-1948`); single-slot failures arrive first as `SMSG_INVENTORY_CHANGE_FAILURE`, so `useSet` settles `ok` on result 0 and returns the owned failure names heard in between. `CMSG_DELETEEQUIPMENT_SET` carries only the packed set guid and sends nothing back (`Handlers/CharacterHandler.cpp:1849-1857`).
- `CMSG_ITEM_REFUND_INFO` and `CMSG_ITEM_REFUND` carry only the `u64` item guid (`Server/Packets/ItemPackets.h:253`, `Server/Packets/ItemPackets.h:263`). An unknown guid is dropped silently (`Handlers/ItemHandler.cpp:1424-1436`), and a carried but non-refundable item draws no reply either, returning inside `RefundItem` (`Handlers/ItemHandler.cpp:1438-1449`).
- `SMSG_ITEM_REFUND_INFO_RESPONSE` is `u64` item, `u32` money, honor and arena costs, five `u32` item and count pairs, `u32` 0 and the `u32` played-time delta (`Entities/Player/Player.cpp:15989-16001`).
- Only a non-stackable extended-cost purchase with the purchase-record flag becomes refundable (`Entities/Player/Player.cpp:10877-10884`).
- `SMSG_ITEM_REFUND_RESULT` is `u64` item and `u32` result; the money, honor, arena and item cost block follows only on result 0 (`Entities/Player/Player.cpp:16094-16104`), while an expired offer answers 10 (`Entities/Player/Player.cpp:16041-16049`). The refund destroys the item and grants the cost, so the act reports the packet and leaves inventory to the next observe.
- `BuyItemFromVendorSlot` drops a destination pack slot above `MAX_BAG_SIZE` (36) with no reply (`Entities/Player/Player.cpp:10906`, `Entities/Item/Container/Bag.h:22`), so pack slots 37 and 38 cannot be bought into; the live run below buys into the first empty slot at 29.
- `CMSG_WRAP_ITEM` is four `u8`: gift bag, gift slot, item bag, item slot (`Server/Packets/ItemPackets.cpp:135-141`). The handler refuses a missing gift or a gift whose template lacks the wrapper flag `0x200` with `EQUIP_ERR_ITEM_NOT_FOUND` naming the gift guid, or `0` when no gift is there (`Handlers/ItemHandler.cpp:1092-1101`); every other refusal names the target item: not found, already wrapped, equipped, bag, soulbound, stackable and unique or timed (`Handlers/ItemHandler.cpp:1103-1164`). On success the target item keeps its guid, takes the wrapper's entry (5042 becomes 5043, five other papers map likewise), gets the gift creator and the flags `ITEM_FIELD_FLAG_WRAPPED` alone, and one paper is destroyed (`Handlers/ItemHandler.cpp:1177-1210`). The `wrap` move therefore settles when the same guid reads `wrapped`, never on the entry. A failure that names the gift guid also belongs to the wrap; the paper count falls by one afterwards, or the stack is gone. The act refuses locally a gift without the wrapper flag, a gift wrapped onto itself and a worn target.
- `CMSG_ITEM_NAME_QUERY` is `u32` entry and a `u64` guid that the server skips (`Handlers/ItemHandler.cpp:1061-1065`). Only an entry listed in `item_set_names` is answered, with `u32` entry, the item's own name and a `u32` inventory type (`Handlers/ItemHandler.cpp:1066-1082`; wow_messages writes the type as `u8`, which would leave three bytes unread); any other entry draws no reply. Core calls the text a set-item name, caches it by entry (first reply wins), sends one query per entry and settles `set_item_name_none` after 5 seconds of silence, remembering the miss. It does not read `ItemSet.dbc`.
- Core keeps timers as absolute expiry times from the local clock at
  receipt (`ItemsState.timers`), item cooldowns as item guid, spell and
  time seen, and the weapon and armour masks. The game log writes
  `items/cooldown`, `items/expiring` (passive; a wake row under 60 s
  left, for timed items and temporary enchants), `items/durability_loss`
  (a wake row that tells the agent to repair) and `items/proficiency`.

## Left out

None.

## Capabilities row

The game log also writes `items/socketed` on `SMSG_SOCKET_GEMS_RESULT` (the item, the three socket enchants and the socket bonus) and `items/enchanted` for own enchant logs with a non-zero enchant id, both log rows, plus wake rows `items/refused` and `items/unanswered` when the socket is refused or unanswered.
It writes `items/set_saved` and `items/set_used` for equipment sets, with wake rows when a save or use goes unanswered or the bags are full.
A confirmed gift wrap writes the log row `items/wrapped`.


## Proof

| Opcode | Proof | Evidence | Source |
|---|---|---|---|
| `CMSG_AUTOEQUIP_ITEM` | `live` | probe flow `items-move` (`do=equip`) on a `fresh` priest, exit 0: the Worn Mace moves from backpack slot 26 to main hand 15 and the bag to bag slot 19 in truth, and each act settles `confirmed`; equipping the level-10 Rat Cloth Cloak draws `SMSG_INVENTORY_CHANGE_FAILURE` result 1 naming the cloak and settles `refused` | `Server/Packets/ItemPackets.cpp:49-53` |
| `CMSG_AUTOEQUIP_ITEM_SLOT` | `live` | probe flow `items-move` (`do=equip_to`), exit 0: the Brown Linen Shirt swaps into slot 3 in truth and the act settles `confirmed` | `Server/Packets/ItemPackets.cpp:35-39` |
| `CMSG_SWAP_ITEM` | `live` | probe flow `items-move` (`do=move`, `to=19:0`), exit 0: the hearthstone moves from backpack slot 25 into the bag in truth and the act settles `confirmed` | `Server/Packets/ItemPackets.cpp:41-47` |
| `CMSG_SWAP_INV_ITEM` | `live` | probe flow `items-move` (`do=move`, `to=31`), exit 0: the Honey Bread moves from backpack slot 23 to 31 in truth and the act settles `confirmed` | `Server/Packets/ItemPackets.cpp:29-33` |
| `CMSG_AUTOSTORE_BAG_ITEM` | `live` | probe flow `items-move` (`do=unequip`), exit 0: the shirt in slot 3 moves to the backpack in truth and the act settles `confirmed` | `Server/Packets/ItemPackets.cpp:108-113` |
| `CMSG_SPLIT_ITEM` | `live` | probe flow `items-move` (`do=split`, `count=5`), exit 0: the stack of 20 water in slot 30 leaves 15, a new stack of 5 is in slot 32 in truth, and the act settles `confirmed` | `Server/Packets/ItemPackets.cpp:20-27` |
| `CMSG_OPEN_ITEM` | `live` | probe flow `items-open` (`do=open`) on an `eversong10` character, exit 0: the item-guid `SMSG_LOOT_RESPONSE` for A Sack of Coins opens the loot window with 1140 copper and one item, and the act resolves with it | `Handlers/SpellHandler.cpp:214-216` |
| `CMSG_READ_ITEM` | `live` | probe flow `items-open` (`do=read`), exit 0: the server answers for the letter and the Venomous Tome | `Server/Packets/ItemPackets.cpp:65-69` |
| `SMSG_READ_ITEM_OK` | `live` | probe flow `items-open` (`do=read`) on A Dusty Unsent Letter, exit 0: the guid is the letter's and the read settles `ok` | `Handlers/ItemHandler.cpp:562` |
| `SMSG_READ_ITEM_FAILED` | `live` | probe flow `items-open` (`do=read`) on the level-20 Venomous Tome, exit 0: `SMSG_INVENTORY_CHANGE_FAILURE` result 1 naming the tome comes first, then this packet with its guid, and the read settles `failed` (`cant_equip_level_i`) | `Handlers/ItemHandler.cpp:567` |
| `CMSG_ITEM_TEXT_QUERY` | `live` | probe flow `items-open` (`do=text`), exit 0: the query carries the letter's guid | `Handlers/ItemHandler.cpp:1461-1465` |
| `SMSG_ITEM_TEXT_QUERY_RESPONSE` | `live` | probe flow `items-open` (`do=text`), exit 0: `0`, the letter's guid and its empty text, and the act returns the text | `Handlers/ItemHandler.cpp:1468-1474` |
| `CMSG_SET_AMMO` | `live` | eval `t8-items-ammo` round 21 replica 2, verdict `pass`: `CMSG_SET_AMMO` with entry 2512 (Rough Arrow), the update that sets `PLAYER_AMMO_ID` to 2512 and the `items/ammo` game-log row | `Handlers/ItemHandler.cpp:1014-1039` |
| `SMSG_ITEM_COOLDOWN` | `live` | probe flow `items-move` (`do=equip`, `slot=36`) on a `max80` priest with Medallion of the Horde (51378) staged in backpack slot 36, exit 0, `--expect SMSG_ITEM_COOLDOWN`: the move settles `confirmed` and the trace shows `SMSG_ITEM_COOLDOWN` `369d13000000004034a50000` (item guid `0x4000000000139d36`, spell 42292) | `Entities/Player/Player.cpp:12058-12061` |
| `SMSG_ITEM_TIME_UPDATE` | `live` | Fool's Stout (5806) added offline, login probe `--flow items-snapshot --expect SMSG_ITEM_TIME_UPDATE`, exit 0: the trace shows `SMSG_ITEM_TIME_UPDATE` `829d130000000040201c0000` twice (the staged copy's guid, 7200 s; truth reads `duration` 7200) | `Entities/Item/Item.cpp:1088-1091` |
| `SMSG_ITEM_ENCHANT_TIME_UPDATE` | `mock` | rig test in `packages/core/src/wow/areas/items/timers.test.ts` ("each timer opcode reaches the store and ends in state") injects a body built from the writer (item, slot, seconds, player) and asserts the event and state; not seen live: no realm-service endpoint can stage a timed temporary enchant | `Server/Packets/ItemPackets.cpp:125-133` |
| `SMSG_SET_PROFICIENCY` | `live` | the login trace of every probe run shows it: login sends one per class and mask built, and the login of `probe items-snapshot` on a `max80` priest drew 8 (`0200000800`, weapon one-handed maces until swords; `0402000000` and `0403000000`, armour leather and mail) | `Entities/Player/Player.cpp:10282-10285` |
| `SMSG_DURABILITY_DAMAGE_DEATH` | `live` | eval `t6-die-and-recover` round 315 replica 2, verdict `pass` 4/4 (`tmp/evals/315/t6-die-and-recover-2`, `result.json`): killed by a Springpaw Stalker (death, release, corpse reclaim at game-log seq 57/66/91, final alive), and `packets.jsonl` shows `SMSG_DURABILITY_DAMAGE_DEATH` size 0, outcome `handled`, at the death | `Server/Packets/MiscPackets.h:183-186` |
| `CMSG_SOCKET_GEMS` | `live` | eval `t8-items-socket` round 330 replica 2, verdict `pass` 2/2 (`tmp/evals/330/t8-items-socket-2`, `result.json`): one `gear do=socket` call (Grotto Mist Gloves 37230, Bold Scarlet Ruby 39996) after `journal bags`; `packets.jsonl` shows `CMSG_SOCKET_GEMS` out (size 32) then the two enchant logs and the result, all `handled` | `Server/Packets/ItemPackets.cpp:143-148` |
| `SMSG_SOCKET_GEMS_RESULT` | `live` | the eval's socketed item is guid `400000000013b0d5` (GL seq 36, `items/socketed`, entry 37230, sockets `[3446, 0, 0]`, bonus 2890); the same byte layout occurs with bodies in probe `tmp/probe/FAC6ABDAAA1CE-20261001T003542Z/packets.jsonl`, where `44ae130000000040760d000000000000000000004a0b0000` decodes to guid `400000000013ae44`, sockets `[3446, 0, 0]`, bonus 2890 | `Entities/Item/Item.cpp:1071-1077` |
| `SMSG_ENCHANTMENTLOG` | `live` | probe `tmp/probe/FAC6ABDAAA1CE-20261001T003542Z/packets.jsonl` shows two logs, both `handled`: `0367110367116e910000760d0000` (target and caster `0x1167`, entry 37230, enchant 3446) then `0367110367116e9100004a0b0000` (target and caster `0x1167`, entry 37230, enchant 2890); the eval's GL seq 34-35 shows the same 3446-then-2890 order for entry 37230, and its `packets.jsonl` shows the two log headers only | `Server/Packets/ItemPackets.cpp:115-123`, `Handlers/ItemHandler.cpp:1041-1048` |
| `CMSG_CANCEL_TEMP_ENCHANTMENT` | `accepted` | probe on a `max80` character with no temporary enchant, `--send CMSG_CANCEL_TEMP_ENCHANTMENT --body 0f000000` (slot 15), exit 0: trace `tmp/probe/FAC6ABDAAA1CE-20261001T003553Z/packets.jsonl` shows the send, no error packet, and the logout completes | `Server/Packets/ItemPackets.cpp:150-153` |
| `SMSG_EQUIPMENT_SET_LIST` | `live` | probe login on an `eversong10` priest, exit 0: trace `tmp/probe/FAC6ABDC346D0-20261001T021954Z/packets.jsonl` shows `SMSG_EQUIPMENT_SET_LIST` in (size 4, `handled`, empty list) right after the tutorial flags | `Entities/Player/Player.cpp:14897-14922` |
| `CMSG_EQUIPMENT_SET_SAVE` | `live` | probe flow `items-sets` (`do=save`, `index=0`, `name=Peon`), exit 0: trace `tmp/probe/FAC6ABDC346D0-20261001T022028Z/packets.jsonl` shows `CMSG_EQUIPMENT_SET_SAVE` out (size 70) with the worn guids, then `SMSG_EQUIPMENT_SET_SAVED` in (size 6, `handled`) | `Handlers/CharacterHandler.cpp:1778-1847` |
| `SMSG_EQUIPMENT_SET_SAVED` | `live` | same run: the saved reply carries index 0 and a new set guid, and the flow settles `saved` | `Entities/Player/Player.cpp:14956-14959` |
| `CMSG_EQUIPMENT_SET_USE` | `live` | probe flow `items-sets` (`do=use`, `index=0`), exit 0: trace `tmp/probe/FAC6ABDC346D0-20261001T022100Z/packets.jsonl` shows `CMSG_EQUIPMENT_SET_USE` out (size 97) then `SMSG_EQUIPMENT_SET_USE_RESULT` in (size 1, `handled`), and the act settles `ok` | `Handlers/CharacterHandler.cpp:1859-1950` |
| `SMSG_EQUIPMENT_SET_USE_RESULT` | `live` | same run: the one-byte result is 0 and the flow outcome is `ok` with no owned failures | `Handlers/CharacterHandler.cpp:1946-1948` |
| `CMSG_EQUIPMENT_SET_USE` | `live` | changed-outfit run (round 401) on a `fresh` priest, account `FAC6ABEC9F27E` (created and deleted), artifacts under `tmp/probe/FAC6ABEC9F27E-r401/`. Run 1 (`run1.json`, `run1/packets.jsonl`): flow `items-sets do=save index=0 name=OutfitA` sends `CMSG_EQUIPMENT_SET_SAVE` (`:89`, slot 15 guid `0x4000000000148f52`) and draws `SMSG_EQUIPMENT_SET_SAVED` (`:137`); flow `items-move do=unequip slot=15` sends `CMSG_AUTOSTORE_BAG_ITEM` (`:138`, body `ff0f00`). `soap truth` before (`truth-0.json`) holds the Neophyte's Mace, item guid `148f52`, in slot 15 and after logout (`truth-1.json`) holds it in backpack slot 26 with slot 15 empty. Run 2 (`run2.json`, `run2/packets.jsonl`): `SMSG_EQUIPMENT_SET_LIST` (`:37`, size 58) lists the saved set, flow `items-sets do=use index=0` sends `CMSG_EQUIPMENT_SET_USE` (`:89`, size 77) whose slot 15 entry is the packed guid `87528f1440` with bag `ff`, slot `1a` (26), then `SMSG_EQUIPMENT_SET_USE_RESULT` (`:113`, body `00`); the act settles `ok` with outgoing slot 15 `0x0` and no failures. `soap truth` after logout (`truth-2.json`) holds the same mace `148f52` in slot 15 again, so the use moved the item from slot 26 to 15 (a no-op use would leave it in 26) | `Handlers/CharacterHandler.cpp:1859-1950` |
| `SMSG_EQUIPMENT_SET_USE_RESULT` | `live` | same round 401 run 2 (`tmp/probe/FAC6ABEC9F27E-r401/run2/packets.jsonl:113`, `handled`): the one-byte result is 0 and the flow outcome is `ok` with no owned failures, and `truth-1.json` to `truth-2.json` shows slot 15 going from empty to the saved mace, so result 0 followed a real equip | `Handlers/CharacterHandler.cpp:1946-1948` |
| `CMSG_DELETEEQUIPMENT_SET` | `live` | probe flow `items-sets` (`do=delete`, `index=0`), exit 0: trace `tmp/probe/FAC6ABDC346D0-20261001T022127Z/packets.jsonl` shows `CMSG_DELETEEQUIPMENT_SET` out (size 2, the packed set guid) with no reply, and the second login `tmp/probe/FAC6ABDC346D0-20261001T022154Z/packets.jsonl` shows `SMSG_EQUIPMENT_SET_LIST` in (size 4, `handled`, empty again) | `Handlers/CharacterHandler.cpp:1849-1857` |
| `CMSG_ITEM_REFUND_INFO` | `live` | probe flow `items-refund` (`do=info`) on the bought Primal Nether `0x4000000000149868` (stackable, not refundable), account `FAC6ABECF92B7` (created and deleted): trace `tmp/probe/FAC6ABECF92B7-items10/info/packets.jsonl` shows `CMSG_ITEM_REFUND_INFO` out (size 8) with no reply, no error packet and a clean logout | `Handlers/ItemHandler.cpp:1424-1436` |
| `SMSG_ITEM_REFUND_INFO_RESPONSE` | `live` | same account, probe flow `items-refund` (`do=buy`, `npc=18525`, `slot=2`) buys gear 29266 into pack slot 29 as `0x4000000000149a24` (`SMSG_BUY_ITEM` in `tmp/probe/FAC6ABECF92B7-items10/buy7/packets.jsonl`), then `do=info`: trace `tmp/probe/FAC6ABECF92B7-items10/info2/packets.jsonl` shows the 68-byte reply `handled`, parsed as money, honor and arena 0, cost 33xBadge of Justice (29434) and delta 320 | `Entities/Player/Player.cpp:15989-16001` |
| `CMSG_ITEM_REFUND` | `live` | same account, probe flow `items-refund` (`do=refund`) on `0x4000000000149a24`: trace `tmp/probe/FAC6ABECF92B7-items10/refund/packets.jsonl` shows the 8-byte send answered with result 0 | `Server/Packets/ItemPackets.h:263` |
| `SMSG_ITEM_REFUND_RESULT` | `live` | same run: the 64-byte reply is `handled` with result 0 and the 33-badge cost block, `SMSG_DESTROY_OBJECT` follows twice, and the later `items-snapshot` (`tmp/probe/FAC6ABECF92B7-items10/inv3.txt`) shows slot 29 empty and badges back at 80 | `Entities/Player/Player.cpp:16094-16104` |
| `CMSG_WRAP_ITEM` | `live` | probe flow `items-wrap` (`do=wrap`, `gift=5042`, `item=25`) on an `eversong10` priest moved to Brill, account `FAC6ABEE00684` (created and deleted; two earlier accounts `FAC6ABEDECD70` and `FAC6ABEDF9D16` died at the Goldshire mailbox before the flow ran): the Red Ribboned Wrapping Paper and the Worn Shortsword came from `soap gm items 5042:1 25:1` and were taken with `CMSG_MAIL_TAKE_ITEM` (`tmp/probe/FAC6ABEE00684-items11/take/packets.jsonl`). `tmp/probe/FAC6ABEE00684-items11/wrap/packets.jsonl` shows `CMSG_WRAP_ITEM` out (`ff1cff1e`: bag 255 slot 28, bag 255 slot 30), the paper's `SMSG_DESTROY_OBJECT`, and the flow result `confirmed` with item `0x400000000014a353` now entry 5043, `wrapped` true. A second wrap of that item with another paper (`tmp/probe/FAC6ABEE00684-items11/wrapneg/packets.jsonl`) drew `SMSG_INVENTORY_CHANGE_FAILURE` result 45 naming the item, which the flow reports as `refused`, `wrapped_cant_be_wrapped` | `Handlers/ItemHandler.cpp:1085-1210` |
| `CMSG_ITEM_NAME_QUERY` | `live` | probe flow `items-wrap` (`do=name`, `entry=6473`, then `entry=25`), same account: `tmp/probe/FAC6ABEE00684-items11/name/packets.jsonl` shows both sends out (12 bytes, entry then a zero guid); entry 6473 is answered, entry 25 gets no reply and the flow reports `null` after 5 s | `Handlers/ItemHandler.cpp:1061-1065` |
| `SMSG_ITEM_NAME_QUERY_RESPONSE` | `live` | same run: the 26-byte reply is `handled` and parses as entry 6473, "Armor of the Fang", inventory type 5 | `Handlers/ItemHandler.cpp:1077-1081` |

# Opcode Stubs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add every known 3.3.5a world opcode to the codebase with stub handlers that surface "not yet implemented" feedback to users.

**Architecture:** Opcode constants in `opcodes.ts`, a single `stubs.ts` registry that registers first-hit notification handlers on the dispatch table, and command stubs in the TUI/IPC layers. Reference AzerothCore `Opcodes.h` for exact hex values.

**Tech Stack:** TypeScript, Bun, bun:test

---

### Task 1: Add `has()` method to OpcodeDispatch

**Files:**

- Modify: `src/wow/protocol/world.ts` (OpcodeDispatch class)
- Test: `src/wow/protocol/world.test.ts`

**Step 1: Write the failing test**

Add to `src/wow/protocol/world.test.ts`:

```ts
describe("OpcodeDispatch", () => {
  test("has() returns false for unregistered opcode", () => {
    const d = new OpcodeDispatch();
    expect(d.has(0x9999)).toBe(false);
  });

  test("has() returns true after on()", () => {
    const d = new OpcodeDispatch();
    d.on(0x42, () => {});
    expect(d.has(0x42)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/world.test.ts`
Expected: FAIL — `d.has is not a function`

**Step 3: Write minimal implementation**

In `src/wow/protocol/world.ts`, add to `OpcodeDispatch`:

```ts
has(opcode: number): boolean {
  return this.handlers.has(opcode);
}
```

**Step 4: Run test to verify it passes**

Run: `mise test src/wow/protocol/world.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add has() method to OpcodeDispatch

Needed by the stub registry to skip opcodes that already have
real handlers.
```

---

### Task 2: Add all 3.3.5a opcode constants to opcodes.ts

**Files:**

- Modify: `src/wow/protocol/opcodes.ts`
- Reference: `../azerothcore-wotlk-playerbots/src/server/game/Server/Protocol/Opcodes.h`

**Step 1: Read the reference file**

Read the full AzerothCore `Opcodes.h` enum (lines 30–1341). Extract every non-cheat,
non-debug, non-GM opcode that flows between a real client and server. Skip entries
containing: `_CHEAT`, `_GM_`, `CMSG_GM`, `SMSG_GM_` (except SMSG*GM_MESSAGECHAT
which we already have), `_DEBUG`, `CMSG_BOOTME`, `CMSG_DBLOOKUP`, `UMSG*`,
`OBSOLETE`, `\_DEPRECATED`.

**Step 2: Add opcode constants to GameOpcode**

Organize the existing entries and new entries into these groups, separated by blank
lines. Keep existing entries at the same names/values. Add new entries within each
group. The groups in order:

1. **Character screen** — CMSG_CHAR_CREATE (0x036), CMSG_CHAR_ENUM (0x037), CMSG_CHAR_DELETE (0x038), SMSG_CHAR_CREATE (0x03A), SMSG_CHAR_ENUM (0x03B), SMSG_CHAR_DELETE (0x03C), CMSG_PLAYER_LOGIN (0x03D), SMSG_CHARACTER_LOGIN_FAILED (0x041)

2. **Login/session** — SMSG_LOGIN_SETTIMESPEED (0x042), CMSG_LOGOUT_REQUEST (0x04B), SMSG_LOGOUT_RESPONSE (0x04C), SMSG_LOGOUT_COMPLETE (0x04D), CMSG_LOGOUT_CANCEL (0x04E), SMSG_AUTH_CHALLENGE (0x1EC), CMSG_AUTH_SESSION (0x1ED), SMSG_AUTH_RESPONSE (0x1EE), SMSG_LOGIN_VERIFY_WORLD (0x236), SMSG_MOTD (0x33D), SMSG_ACCOUNT_DATA_TIMES (0x209), CMSG_READY_FOR_ACCOUNT_DATA_TIMES (0x4FF), SMSG_FEATURE_SYSTEM_STATUS (0x3C9), SMSG_CLIENTCACHE_VERSION (0x4AB)

3. **Queries** — CMSG_NAME_QUERY (0x050), SMSG_NAME_QUERY_RESPONSE (0x051), CMSG_PET_NAME_QUERY (0x052), SMSG_PET_NAME_QUERY_RESPONSE (0x053), CMSG_GUILD_QUERY (0x054), SMSG_GUILD_QUERY_RESPONSE (0x055), CMSG_ITEM_QUERY_SINGLE (0x056), SMSG_ITEM_QUERY_SINGLE_RESPONSE (0x058), CMSG_PAGE_TEXT_QUERY (0x05A), SMSG_PAGE_TEXT_QUERY_RESPONSE (0x05B), CMSG_QUEST_QUERY (0x05C), SMSG_QUEST_QUERY_RESPONSE (0x05D), CMSG_GAMEOBJECT_QUERY (0x05E), SMSG_GAMEOBJECT_QUERY_RESPONSE (0x05F), CMSG_CREATURE_QUERY (0x060), SMSG_CREATURE_QUERY_RESPONSE (0x061), CMSG_WHO (0x062), SMSG_WHO (0x063), CMSG_WHOIS (0x064), SMSG_WHOIS (0x065), CMSG_PLAYED_TIME (0x1CC), SMSG_PLAYED_TIME (0x1CD), CMSG_QUERY_TIME (0x1CE), SMSG_QUERY_TIME_RESPONSE (0x1CF)

4. **Social** — CMSG_CONTACT_LIST (0x066), SMSG_CONTACT_LIST (0x067), SMSG_FRIEND_STATUS (0x068), CMSG_ADD_FRIEND (0x069), CMSG_DEL_FRIEND (0x06A), CMSG_SET_CONTACT_NOTES (0x06B), CMSG_ADD_IGNORE (0x06C), CMSG_DEL_IGNORE (0x06D)

5. **Group** — All existing group opcodes plus CMSG_GROUP_UNINVITE_GUID (0x076), CMSG_LOOT_METHOD (0x07A), CMSG_GROUP_CHANGE_SUB_GROUP (0x27E), CMSG_REQUEST_PARTY_MEMBER_STATS (0x27F), CMSG_GROUP_RAID_CONVERT (0x28E), CMSG_GROUP_ASSISTANT_LEADER (0x28F), MSG_RAID_TARGET_UPDATE (0x321), MSG_RAID_READY_CHECK (0x322), MSG_RAID_READY_CHECK_CONFIRM (0x3AE), MSG_RAID_READY_CHECK_FINISHED (0x3C6), MSG_PARTY_ASSIGNMENT (0x38E), SMSG_REAL_GROUP_UPDATE (0x397)

6. **Guild** — CMSG_GUILD_CREATE (0x081), CMSG_GUILD_INVITE (0x082), SMSG_GUILD_INVITE (0x083), CMSG_GUILD_ACCEPT (0x084), CMSG_GUILD_DECLINE (0x085), SMSG_GUILD_DECLINE (0x086), CMSG_GUILD_INFO (0x087), SMSG_GUILD_INFO (0x088), CMSG_GUILD_ROSTER (0x089), SMSG_GUILD_ROSTER (0x08A), CMSG_GUILD_PROMOTE (0x08B), CMSG_GUILD_DEMOTE (0x08C), CMSG_GUILD_LEAVE (0x08D), CMSG_GUILD_REMOVE (0x08E), CMSG_GUILD_DISBAND (0x08F), CMSG_GUILD_LEADER (0x090), CMSG_GUILD_MOTD (0x091), SMSG_GUILD_EVENT (0x092), SMSG_GUILD_COMMAND_RESULT (0x093), CMSG_GUILD_RANK (0x231), CMSG_GUILD_ADD_RANK (0x232), CMSG_GUILD_DEL_RANK (0x233), CMSG_GUILD_SET_PUBLIC_NOTE (0x234), CMSG_GUILD_SET_OFFICER_NOTE (0x235), CMSG_GUILD_INFO_TEXT (0x2FC), CMSG_GUILD_BANKER_ACTIVATE (0x3E6), CMSG_GUILD_BANK_QUERY_TAB (0x3E7), SMSG_GUILD_BANK_LIST (0x3E8), CMSG_GUILD_BANK_SWAP_ITEMS (0x3E9), CMSG_GUILD_BANK_BUY_TAB (0x3EA), CMSG_GUILD_BANK_UPDATE_TAB (0x3EB), CMSG_GUILD_BANK_DEPOSIT_MONEY (0x3EC), CMSG_GUILD_BANK_WITHDRAW_MONEY (0x3ED), MSG_GUILD_BANK_LOG_QUERY (0x3EE), MSG_GUILD_PERMISSIONS (0x3FD), MSG_GUILD_BANK_MONEY_WITHDRAWN (0x3FE), MSG_GUILD_EVENT_LOG_QUERY (0x3FF), MSG_QUERY_GUILD_BANK_TEXT (0x40A), CMSG_SET_GUILD_BANK_TEXT (0x40B), MSG_SAVE_GUILD_EMBLEM (0x1F1), MSG_TABARDVENDOR_ACTIVATE (0x1F2)

7. **Chat** — CMSG_MESSAGE_CHAT (0x095), SMSG_MESSAGE_CHAT (0x096), SMSG_GM_MESSAGECHAT (0x3B3), SMSG_CHAT_PLAYER_NOT_FOUND (0x2A9), SMSG_CHAT_PLAYER_AMBIGUOUS (0x32D), SMSG_CHAT_RESTRICTED (0x2FD), SMSG_CHAT_NOT_IN_PARTY (0x299), SMSG_CHAT_WRONG_FACTION (0x219), CMSG_CHAT_IGNORED (0x225), SMSG_CHAT_SERVER_MESSAGE (0x291), SMSG_SERVER_FIRST_ACHIEVEMENT (0x498)

8. **Channel** — CMSG_JOIN_CHANNEL (0x097), CMSG_LEAVE_CHANNEL (0x098), SMSG_CHANNEL_NOTIFY (0x099), CMSG_CHANNEL_LIST (0x09A), SMSG_CHANNEL_LIST (0x09B), CMSG_CHANNEL_PASSWORD (0x09C), CMSG_CHANNEL_SET_OWNER (0x09D), CMSG_CHANNEL_OWNER (0x09E), CMSG_CHANNEL_MODERATOR (0x09F), CMSG_CHANNEL_UNMODERATOR (0x0A0), CMSG_CHANNEL_MUTE (0x0A1), CMSG_CHANNEL_UNMUTE (0x0A2), CMSG_CHANNEL_INVITE (0x0A3), CMSG_CHANNEL_KICK (0x0A4), CMSG_CHANNEL_BAN (0x0A5), CMSG_CHANNEL_UNBAN (0x0A6), CMSG_CHANNEL_ANNOUNCEMENTS (0x0A7), CMSG_CHANNEL_MODERATE (0x0A8), CMSG_GET_CHANNEL_MEMBER_COUNT (0x3D4), SMSG_CHANNEL_MEMBER_COUNT (0x3D5), SMSG_USERLIST_ADD (0x3F0), SMSG_USERLIST_REMOVE (0x3F1), SMSG_USERLIST_UPDATE (0x3F2), CMSG_DECLINE_CHANNEL_INVITE (0x410)

9. **World objects** — SMSG_UPDATE_OBJECT (0x0A9), SMSG_DESTROY_OBJECT (0x0AA), SMSG_COMPRESSED_UPDATE_OBJECT (0x1F6)

10. **Movement** — MSG_MOVE_START_FORWARD (0x0B5), MSG_MOVE_START_BACKWARD (0x0B6), MSG_MOVE_STOP (0x0B7), MSG_MOVE_START_STRAFE_LEFT (0x0B8), MSG_MOVE_START_STRAFE_RIGHT (0x0B9), MSG_MOVE_STOP_STRAFE (0x0BA), MSG_MOVE_JUMP (0x0BB), MSG_MOVE_START_TURN_LEFT (0x0BC), MSG_MOVE_START_TURN_RIGHT (0x0BD), MSG_MOVE_STOP_TURN (0x0BE), MSG_MOVE_START_PITCH_UP (0x0BF), MSG_MOVE_START_PITCH_DOWN (0x0C0), MSG_MOVE_STOP_PITCH (0x0C1), MSG_MOVE_SET_RUN_MODE (0x0C2), MSG_MOVE_SET_WALK_MODE (0x0C3), MSG_MOVE_TELEPORT (0x0C5), MSG_MOVE_TELEPORT_ACK (0x0C7), MSG_MOVE_FALL_LAND (0x0C9), MSG_MOVE_START_SWIM (0x0CA), MSG_MOVE_STOP_SWIM (0x0CB), MSG_MOVE_SET_RUN_SPEED (0x0CD), MSG_MOVE_SET_RUN_BACK_SPEED (0x0CF), MSG_MOVE_SET_WALK_SPEED (0x0D1), MSG_MOVE_SET_SWIM_SPEED (0x0D3), MSG_MOVE_SET_SWIM_BACK_SPEED (0x0D5), MSG_MOVE_SET_TURN_RATE (0x0D8), MSG_MOVE_SET_FACING (0x0DA), MSG_MOVE_SET_PITCH (0x0DB), MSG_MOVE_WORLDPORT_ACK (0x0DC), MSG_MOVE_HEARTBEAT (0x0EE), MSG_MOVE_KNOCK_BACK (0x0F1), MSG_MOVE_HOVER (0x0F7), SMSG_MONSTER_MOVE (0x0DD), SMSG_MOVE_WATER_WALK (0x0DE), SMSG_MOVE_LAND_WALK (0x0DF), SMSG_FORCE_RUN_SPEED_CHANGE (0x0E2), SMSG_FORCE_RUN_BACK_SPEED_CHANGE (0x0E4), SMSG_FORCE_SWIM_SPEED_CHANGE (0x0E6), SMSG_FORCE_MOVE_ROOT (0x0E8), SMSG_FORCE_MOVE_UNROOT (0x0EA), SMSG_MOVE_KNOCK_BACK (0x0EF), SMSG_MOVE_FEATHER_FALL (0x0F2), SMSG_MOVE_NORMAL_FALL (0x0F3), SMSG_MOVE_SET_HOVER (0x0F4), SMSG_MOVE_UNSET_HOVER (0x0F5), MSG_MOVE_START_ASCEND (0x359), MSG_MOVE_STOP_ASCEND (0x35A), MSG_MOVE_START_DESCEND (0x3A7), SMSG_MOVE_SET_CAN_FLY (0x343), SMSG_MOVE_UNSET_CAN_FLY (0x344), SMSG_FORCE_WALK_SPEED_CHANGE (0x2DA), SMSG_FORCE_SWIM_BACK_SPEED_CHANGE (0x2DC), SMSG_FORCE_TURN_RATE_CHANGE (0x2DE), SMSG_FORCE_FLIGHT_SPEED_CHANGE (0x381), SMSG_FORCE_FLIGHT_BACK_SPEED_CHANGE (0x383), SMSG_COMPRESSED_MOVES (0x2FB)

11. **Emotes** — CMSG_EMOTE (0x102), SMSG_EMOTE (0x103), CMSG_TEXT_EMOTE (0x104), SMSG_TEXT_EMOTE (0x105), CMSG_STANDSTATECHANGE (0x101)

12. **Items** — CMSG_USE_ITEM (0x0AB), CMSG_OPEN_ITEM (0x0AC), CMSG_READ_ITEM (0x0AD), SMSG_READ_ITEM_OK (0x0AE), SMSG_READ_ITEM_FAILED (0x0AF), SMSG_ITEM_COOLDOWN (0x0B0), CMSG_AUTOEQUIP_ITEM (0x10A), CMSG_AUTOSTORE_BAG_ITEM (0x10B), CMSG_SWAP_ITEM (0x10C), CMSG_SWAP_INV_ITEM (0x10D), CMSG_SPLIT_ITEM (0x10E), CMSG_DESTROYITEM (0x111), SMSG_INVENTORY_CHANGE_FAILURE (0x112), SMSG_ITEM_PUSH_RESULT (0x166), SMSG_ITEM_TIME_UPDATE (0x1EA), SMSG_ITEM_ENCHANT_TIME_UPDATE (0x1EB), SMSG_EQUIPMENT_SET_LIST (0x4BC), CMSG_EQUIPMENT_SET_SAVE (0x4BD), CMSG_AUTOSTORE_LOOT_ITEM (0x108)

13. **Trade** — CMSG_INITIATE_TRADE (0x116), CMSG_BEGIN_TRADE (0x117), CMSG_ACCEPT_TRADE (0x11A), CMSG_UNACCEPT_TRADE (0x11B), CMSG_CANCEL_TRADE (0x11C), CMSG_SET_TRADE_ITEM (0x11D), CMSG_CLEAR_TRADE_ITEM (0x11E), CMSG_SET_TRADE_GOLD (0x11F), SMSG_TRADE_STATUS (0x120), SMSG_TRADE_STATUS_EXTENDED (0x121)

14. **Spells/Auras** — SMSG_INITIAL_SPELLS (0x12A), SMSG_LEARNED_SPELL (0x12B), CMSG_CAST_SPELL (0x12E), CMSG_CANCEL_CAST (0x12F), SMSG_CAST_FAILED (0x130), SMSG_SPELL_START (0x131), SMSG_SPELL_GO (0x132), SMSG_SPELL_FAILURE (0x133), SMSG_SPELL_COOLDOWN (0x134), SMSG_COOLDOWN_EVENT (0x135), CMSG_CANCEL_AURA (0x136), SMSG_CLEAR_COOLDOWN (0x1DE), SMSG_SPELL_DELAYED (0x1E2), SMSG_REMOVED_SPELL (0x203), SMSG_AURA_UPDATE_ALL (0x495), SMSG_AURA_UPDATE (0x496)

15. **Combat** — CMSG_ATTACKSWING (0x141), CMSG_ATTACKSTOP (0x142), SMSG_ATTACKSTART (0x143), SMSG_ATTACKSTOP (0x144), SMSG_ATTACKERSTATEUPDATE (0x14A), SMSG_CANCEL_COMBAT (0x14E), SMSG_SPELLHEALLOG (0x150), SMSG_SPELLENERGIZELOG (0x151), SMSG_SPELLNONMELEEDAMAGELOG (0x250), SMSG_PERIODICAURALOG (0x24E), SMSG_SPELLORDAMAGE_IMMUNE (0x263), SMSG_ENVIRONMENTAL_DAMAGE_LOG (0x1FC), SMSG_SPELL_FAILED_OTHER (0x2A6)

16. **Loot** — CMSG_LOOT (0x15D), CMSG_LOOT_MONEY (0x15E), CMSG_LOOT_RELEASE (0x15F), SMSG_LOOT_RESPONSE (0x160), SMSG_LOOT_RELEASE_RESPONSE (0x161), SMSG_LOOT_REMOVED (0x162), SMSG_LOOT_MONEY_NOTIFY (0x163), SMSG_LOOT_ITEM_NOTIFY (0x164), CMSG_LOOT_ROLL (0x2A0), SMSG_LOOT_START_ROLL (0x2A1), SMSG_LOOT_ROLL (0x2A2), SMSG_LOOT_ALL_PASSED (0x29E), SMSG_LOOT_ROLL_WON (0x29F), SMSG_LOOT_MASTER_LIST (0x2A4)

17. **Duel** — SMSG_DUEL_REQUESTED (0x167), SMSG_DUEL_OUTOFBOUNDS (0x168), SMSG_DUEL_INBOUNDS (0x169), SMSG_DUEL_COMPLETE (0x16A), SMSG_DUEL_WINNER (0x16B), CMSG_DUEL_ACCEPTED (0x16C), CMSG_DUEL_CANCELLED (0x16D), SMSG_DUEL_COUNTDOWN (0x2B7)

18. **Pet** — CMSG_PET_SET_ACTION (0x174), CMSG_PET_ACTION (0x175), CMSG_PET_ABANDON (0x176), CMSG_PET_RENAME (0x177), SMSG_PET_SPELLS (0x179), SMSG_PET_MODE (0x17A), CMSG_PET_STOP_ATTACK (0x2EA), CMSG_PET_SPELL_AUTOCAST (0x2F3)

19. **Gossip/NPC** — CMSG_GOSSIP_HELLO (0x17B), CMSG_GOSSIP_SELECT_OPTION (0x17C), SMSG_GOSSIP_MESSAGE (0x17D), SMSG_GOSSIP_COMPLETE (0x17E), CMSG_NPC_TEXT_QUERY (0x17F), SMSG_NPC_TEXT_UPDATE (0x180), SMSG_GOSSIP_POI (0x224)

20. **Quest** — CMSG_QUESTGIVER_STATUS_QUERY (0x182), SMSG_QUESTGIVER_STATUS (0x183), CMSG_QUESTGIVER_HELLO (0x184), SMSG_QUESTGIVER_QUEST_LIST (0x185), CMSG_QUESTGIVER_QUERY_QUEST (0x186), SMSG_QUESTGIVER_QUEST_DETAILS (0x188), CMSG_QUESTGIVER_ACCEPT_QUEST (0x189), CMSG_QUESTGIVER_COMPLETE_QUEST (0x18A), SMSG_QUESTGIVER_REQUEST_ITEMS (0x18B), CMSG_QUESTGIVER_REQUEST_REWARD (0x18C), SMSG_QUESTGIVER_OFFER_REWARD (0x18D), CMSG_QUESTGIVER_CHOOSE_REWARD (0x18E), SMSG_QUESTGIVER_QUEST_COMPLETE (0x191), SMSG_QUESTGIVER_QUEST_FAILED (0x192), CMSG_QUESTLOG_REMOVE_QUEST (0x194), SMSG_QUESTUPDATE_COMPLETE (0x198), SMSG_QUESTUPDATE_ADD_KILL (0x199), CMSG_PUSHQUESTTOPARTY (0x19D)

21. **Vendor** — CMSG_LIST_INVENTORY (0x19E), SMSG_LIST_INVENTORY (0x19F), CMSG_SELL_ITEM (0x1A0), SMSG_SELL_ITEM (0x1A1), CMSG_BUY_ITEM (0x1A2), SMSG_BUY_ITEM (0x1A4), SMSG_BUY_FAILED (0x1A5), CMSG_BUYBACK_ITEM (0x290), CMSG_REPAIR_ITEM (0x2A8)

22. **Taxi** — SMSG_SHOWTAXINODES (0x1A9), CMSG_ACTIVATETAXI (0x1AD), SMSG_ACTIVATETAXIREPLY (0x1AE), SMSG_NEW_TAXI_PATH (0x1AF), CMSG_ACTIVATETAXIEXPRESS (0x312)

23. **Trainer** — CMSG_TRAINER_LIST (0x1B0), SMSG_TRAINER_LIST (0x1B1), CMSG_TRAINER_BUY_SPELL (0x1B2), SMSG_TRAINER_BUY_SUCCEEDED (0x1B3), SMSG_TRAINER_BUY_FAILED (0x1B4)

24. **Bank** — CMSG_BANKER_ACTIVATE (0x1B7), SMSG_SHOW_BANK (0x1B8), CMSG_BUY_BANK_SLOT (0x1B9), SMSG_BUY_BANK_SLOT_RESULT (0x1BA), CMSG_AUTOSTORE_BANK_ITEM (0x282), CMSG_AUTOBANK_ITEM (0x283)

25. **Petition** — CMSG_PETITION_SHOWLIST (0x1BB), SMSG_PETITION_SHOWLIST (0x1BC), CMSG_PETITION_BUY (0x1BD), CMSG_PETITION_SHOW_SIGNATURES (0x1BE), SMSG_PETITION_SHOW_SIGNATURES (0x1BF), CMSG_PETITION_SIGN (0x1C0), SMSG_PETITION_SIGN_RESULTS (0x1C1), CMSG_TURN_IN_PETITION (0x1C4), SMSG_TURN_IN_PETITION_RESULTS (0x1C5), CMSG_PETITION_QUERY (0x1C6), SMSG_PETITION_QUERY_RESPONSE (0x1C7)

26. **Notifications** — SMSG_NOTIFICATION (0x1CB), SMSG_LOG_XPGAIN (0x1D0), SMSG_LEVELUP_INFO (0x1D4), SMSG_AREA_TRIGGER_MESSAGE (0x2B8)

27. **Keepalive** — CMSG_PING (0x1DC), SMSG_PONG (0x1DD), SMSG_TIME_SYNC_REQ (0x390), CMSG_TIME_SYNC_RESP (0x391), CMSG_KEEP_ALIVE (0x407)

28. **Cinematic** — SMSG_TRIGGER_CINEMATIC (0x0FA), CMSG_NEXT_CINEMATIC_CAMERA (0x0FB), CMSG_COMPLETE_CINEMATIC (0x0FC), SMSG_TRIGGER_MOVIE (0x464)

29. **Tutorial** — SMSG_TUTORIAL_FLAGS (0x0FD), CMSG_TUTORIAL_FLAG (0x0FE), CMSG_TUTORIAL_CLEAR (0x0FF), CMSG_TUTORIAL_RESET (0x100)

30. **Reputation/Proficiency** — SMSG_INITIALIZE_FACTIONS (0x122), SMSG_SET_FACTION_STANDING (0x124), SMSG_SET_PROFICIENCY (0x127)

31. **Action bar** — CMSG_SET_ACTION_BUTTON (0x128), SMSG_ACTION_BUTTONS (0x129)

32. **Talent** — CMSG_LEARN_TALENT (0x251), SMSG_TALENTS_INFO (0x4C0), CMSG_LEARN_PREVIEW_TALENTS (0x4C1)

33. **Death/Resurrect** — CMSG_REPOP_REQUEST (0x15A), SMSG_RESURRECT_REQUEST (0x15B), CMSG_RESURRECT_RESPONSE (0x15C), CMSG_RECLAIM_CORPSE (0x1D2), CMSG_SPIRIT_HEALER_ACTIVATE (0x21C), MSG_CORPSE_QUERY (0x216), SMSG_CORPSE_RECLAIM_DELAY (0x269), SMSG_PRE_RESURRECT (0x494)

34. **Mail** — CMSG_SEND_MAIL (0x238), SMSG_SEND_MAIL_RESULT (0x239), CMSG_GET_MAIL_LIST (0x23A), SMSG_MAIL_LIST_RESULT (0x23B), CMSG_MAIL_TAKE_MONEY (0x245), CMSG_MAIL_TAKE_ITEM (0x246), CMSG_MAIL_MARK_AS_READ (0x247), CMSG_MAIL_RETURN_TO_SENDER (0x248), CMSG_MAIL_DELETE (0x249), CMSG_MAIL_CREATE_TEXT_ITEM (0x24A), MSG_QUERY_NEXT_MAIL_TIME (0x284), SMSG_RECEIVED_MAIL (0x285), SMSG_SHOW_MAILBOX (0x297)

35. **Auction** — MSG_AUCTION_HELLO (0x255), CMSG_AUCTION_SELL_ITEM (0x256), CMSG_AUCTION_REMOVE_ITEM (0x257), CMSG_AUCTION_LIST_ITEMS (0x258), CMSG_AUCTION_LIST_OWNER_ITEMS (0x259), CMSG_AUCTION_PLACE_BID (0x25A), SMSG_AUCTION_COMMAND_RESULT (0x25B), SMSG_AUCTION_LIST_RESULT (0x25C), SMSG_AUCTION_OWNER_LIST_RESULT (0x25D), SMSG_AUCTION_BIDDER_NOTIFICATION (0x25E), SMSG_AUCTION_OWNER_NOTIFICATION (0x25F), CMSG_AUCTION_LIST_BIDDER_ITEMS (0x264), SMSG_AUCTION_BIDDER_LIST_RESULT (0x265), SMSG_AUCTION_REMOVED_NOTIFICATION (0x28D), CMSG_AUCTION_LIST_PENDING_SALES (0x48F), SMSG_AUCTION_LIST_PENDING_SALES (0x490)

36. **Battlefield/PvP** — CMSG_BATTLEFIELD_LIST (0x23C), SMSG_BATTLEFIELD_LIST (0x23D), CMSG_BATTLEFIELD_JOIN (0x23E), CMSG_BATTLEFIELD_STATUS (0x2D3), SMSG_BATTLEFIELD_STATUS (0x2D4), CMSG_BATTLEFIELD_PORT (0x2D5), CMSG_BATTLEMASTER_HELLO (0x2D7), CMSG_BATTLEMASTER_JOIN (0x2EE), CMSG_LEAVE_BATTLEFIELD (0x2E1), SMSG_GROUP_JOINED_BATTLEGROUND (0x2E8), MSG_BATTLEGROUND_PLAYER_POSITIONS (0x2E9), SMSG_BATTLEGROUND_PLAYER_JOINED (0x2EC), SMSG_BATTLEGROUND_PLAYER_LEFT (0x2ED), MSG_PVP_LOG_DATA (0x2E0), SMSG_JOINED_BATTLEGROUND_QUEUE (0x38A), SMSG_PVP_CREDIT (0x28C), SMSG_ZONE_UNDER_ATTACK (0x254), CMSG_TOGGLE_PVP (0x253)

37. **Random roll** — MSG_RANDOM_ROLL (0x1FB)

38. **Warden** — SMSG_WARDEN_DATA (0x2E6), CMSG_WARDEN_DATA (0x2E7)

39. **World state** — SMSG_INIT_WORLD_STATES (0x2C2), SMSG_UPDATE_WORLD_STATE (0x2C3)

40. **Weather** — SMSG_WEATHER (0x2F4)

41. **Sound/Visual** — SMSG_PLAY_SOUND (0x2D2), SMSG_PLAY_MUSIC (0x277), SMSG_PLAY_OBJECT_SOUND (0x278), SMSG_PLAY_SPELL_VISUAL (0x1F3), SMSG_PLAY_SPELL_IMPACT (0x1F7)

42. **Instance** — MSG_SET_DUNGEON_DIFFICULTY (0x329), SMSG_INSTANCE_DIFFICULTY (0x33B), SMSG_INSTANCE_RESET (0x31E), SMSG_UPDATE_LAST_INSTANCE (0x320), SMSG_RAID_INSTANCE_INFO (0x2CC), CMSG_REQUEST_RAID_INFO (0x2CD), SMSG_RAID_INSTANCE_MESSAGE (0x2FA), SMSG_UPDATE_INSTANCE_OWNERSHIP (0x32B), MSG_SET_RAID_DIFFICULTY (0x4EB)

43. **Arena** — CMSG_ARENA_TEAM_CREATE (0x348), SMSG_ARENA_TEAM_COMMAND_RESULT (0x349), CMSG_ARENA_TEAM_QUERY (0x34B), SMSG_ARENA_TEAM_QUERY_RESPONSE (0x34C), CMSG_ARENA_TEAM_ROSTER (0x34D), SMSG_ARENA_TEAM_ROSTER (0x34E), CMSG_ARENA_TEAM_INVITE (0x34F), SMSG_ARENA_TEAM_INVITE (0x350), CMSG_ARENA_TEAM_ACCEPT (0x351), CMSG_ARENA_TEAM_DECLINE (0x352), CMSG_ARENA_TEAM_LEAVE (0x353), CMSG_ARENA_TEAM_REMOVE (0x354), CMSG_ARENA_TEAM_DISBAND (0x355), CMSG_ARENA_TEAM_LEADER (0x356), SMSG_ARENA_TEAM_EVENT (0x357), SMSG_ARENA_TEAM_STATS (0x35B), CMSG_BATTLEMASTER_JOIN_ARENA (0x358)

44. **LFG** — CMSG_LFG_JOIN (0x35C), CMSG_LFG_LEAVE (0x35D), SMSG_LFG_PROPOSAL_UPDATE (0x361), CMSG_LFG_PROPOSAL_RESULT (0x362), SMSG_LFG_ROLE_CHECK_UPDATE (0x363), SMSG_LFG_JOIN_RESULT (0x364), SMSG_LFG_QUEUE_STATUS (0x365), CMSG_SET_LFG_COMMENT (0x366), SMSG_LFG_UPDATE_PLAYER (0x367), SMSG_LFG_UPDATE_PARTY (0x368), CMSG_LFG_SET_ROLES (0x36A), CMSG_LFG_SET_BOOT_VOTE (0x36C), SMSG_LFG_BOOT_PROPOSAL_UPDATE (0x36D), CMSG_LFD_PLAYER_LOCK_INFO_REQUEST (0x36E), SMSG_LFG_PLAYER_INFO (0x36F), CMSG_LFG_TELEPORT (0x370), SMSG_LFG_DISABLED (0x398), SMSG_LFG_PLAYER_REWARD (0x1FF), SMSG_LFG_TELEPORT_DENIED (0x200), SMSG_LFG_OFFER_CONTINUE (0x293)

45. **Calendar** — CMSG_CALENDAR_GET_CALENDAR (0x429), CMSG_CALENDAR_GET_EVENT (0x42A), CMSG_CALENDAR_ADD_EVENT (0x42D), CMSG_CALENDAR_UPDATE_EVENT (0x42E), CMSG_CALENDAR_REMOVE_EVENT (0x42F), CMSG_CALENDAR_EVENT_INVITE (0x431), CMSG_CALENDAR_EVENT_RSVP (0x432), CMSG_CALENDAR_EVENT_REMOVE_INVITE (0x433), CMSG_CALENDAR_GET_NUM_PENDING (0x447), SMSG_CALENDAR_SEND_CALENDAR (0x436), SMSG_CALENDAR_SEND_EVENT (0x437), SMSG_CALENDAR_EVENT_INVITE (0x43A), SMSG_CALENDAR_EVENT_INVITE_REMOVED (0x43B), SMSG_CALENDAR_EVENT_STATUS (0x43C), SMSG_CALENDAR_COMMAND_RESULT (0x43D), SMSG_CALENDAR_EVENT_INVITE_ALERT (0x440), SMSG_CALENDAR_SEND_NUM_PENDING (0x448)

46. **Achievement** — SMSG_ACHIEVEMENT_EARNED (0x468), SMSG_CRITERIA_UPDATE (0x46A), SMSG_ALL_ACHIEVEMENT_DATA (0x47D), SMSG_RESPOND_INSPECT_ACHIEVEMENTS (0x46C), CMSG_QUERY_INSPECT_ACHIEVEMENTS (0x46B)

47. **Vehicle** — CMSG_REQUEST_VEHICLE_EXIT (0x476), CMSG_REQUEST_VEHICLE_NEXT_SEAT (0x478), CMSG_REQUEST_VEHICLE_SWITCH_SEAT (0x479), CMSG_DISMISS_CONTROLLED_VEHICLE (0x46D)

48. **Misc** — SMSG_BINDPOINTUPDATE (0x155), SMSG_CLIENT_CONTROL_UPDATE (0x159), SMSG_SET_FLAT_SPELL_MODIFIER (0x266), SMSG_SET_PCT_SPELL_MODIFIER (0x267), SMSG_POWER_UPDATE (0x480), SMSG_HEALTH_UPDATE (0x47F), SMSG_SET_PHASE_SHIFT (0x47C), SMSG_ADDON_INFO (0x2EF), MSG_MINIMAP_PING (0x1D5), CMSG_ZONEUPDATE (0x1F4), CMSG_SET_ACTIVE_MOVER (0x26A), CMSG_SET_SHEATHED (0x1E0), CMSG_SET_ACTIONBAR_TOGGLES (0x2BF), SMSG_STANDSTATE_UPDATE (0x29D), SMSG_PARTYKILLLOG (0x1F5), SMSG_SUMMON_REQUEST (0x2AB), CMSG_SUMMON_RESPONSE (0x2AC), SMSG_EXPLORATION_EXPERIENCE (0x1F8), SMSG_INSPECT_TALENT (0x3F4)

The complete set is ~300 entries. Use the hex values shown above exactly — they are
from AzerothCore Opcodes.h (build 12340).

**Step 3: Run typecheck**

Run: `mise typecheck`
Expected: PASS (all entries are just numbers in a const object)

**Step 4: Commit**

```
feat: Add comprehensive 3.3.5a opcode constants

Complete enum of all client-facing world opcodes for build 12340,
sourced from AzerothCore Opcodes.h. Grouped by feature area.
```

---

### Task 3: Create stub registry

**Files:**

- Create: `src/wow/protocol/stubs.ts`
- Test: `src/wow/protocol/stubs.test.ts`

**Step 1: Write the failing test**

Create `src/wow/protocol/stubs.test.ts`:

```ts
import { test, expect, describe } from "bun:test";
import { OpcodeDispatch } from "wow/protocol/world";
import { GameOpcode } from "wow/protocol/opcodes";
import { STUBS, registerStubs } from "wow/protocol/stubs";

describe("registerStubs", () => {
  test("registers SMSG opcodes that aren't already handled", () => {
    const d = new OpcodeDispatch();
    d.on(GameOpcode.SMSG_MESSAGE_CHAT, () => {});
    const messages: string[] = [];
    registerStubs(d, (msg) => messages.push(msg));

    expect(d.has(GameOpcode.SMSG_CONTACT_LIST)).toBe(true);
    expect(d.has(GameOpcode.SMSG_GUILD_EVENT)).toBe(true);
  });

  test("skips opcodes already registered", () => {
    const d = new OpcodeDispatch();
    let realCalled = false;
    d.on(GameOpcode.SMSG_MESSAGE_CHAT, () => {
      realCalled = true;
    });
    registerStubs(d, () => {});

    const { PacketReader } = require("wow/protocol/packet");
    d.handle(GameOpcode.SMSG_MESSAGE_CHAT, new PacketReader(new Uint8Array(0)));
    expect(realCalled).toBe(true);
  });

  test("notifies on first receipt only", () => {
    const d = new OpcodeDispatch();
    const messages: string[] = [];
    registerStubs(d, (msg) => messages.push(msg));

    const { PacketReader } = require("wow/protocol/packet");
    d.handle(GameOpcode.SMSG_CONTACT_LIST, new PacketReader(new Uint8Array(0)));
    d.handle(GameOpcode.SMSG_CONTACT_LIST, new PacketReader(new Uint8Array(0)));

    const matching = messages.filter((m) => m.includes("Friends"));
    expect(matching).toHaveLength(1);
  });

  test("STUBS array contains metadata for all entries", () => {
    for (const stub of STUBS) {
      expect(stub.opcode).toBeGreaterThan(0);
      expect(stub.area).toBeTruthy();
      expect(stub.label).toBeTruthy();
      expect(["high", "medium", "low"]).toContain(stub.priority);
    }
  });

  test("does not register CMSG opcodes on dispatch", () => {
    const d = new OpcodeDispatch();
    registerStubs(d, () => {});
    expect(d.has(GameOpcode.CMSG_ADD_FRIEND)).toBe(false);
    expect(d.has(GameOpcode.CMSG_CAST_SPELL)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/stubs.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/wow/protocol/stubs.ts`:

```ts
import type { OpcodeDispatch } from "wow/protocol/world";
import { GameOpcode } from "wow/protocol/opcodes";

export type StubEntry = {
  opcode: number;
  area: string;
  label: string;
  priority: "high" | "medium" | "low";
};

export const STUBS: StubEntry[] = [
  // Social
  {
    opcode: GameOpcode.SMSG_CONTACT_LIST,
    area: "social",
    label: "Friends list",
    priority: "high",
  },
  {
    opcode: GameOpcode.SMSG_FRIEND_STATUS,
    area: "social",
    label: "Friend status updates",
    priority: "high",
  },
  {
    opcode: GameOpcode.CMSG_CONTACT_LIST,
    area: "social",
    label: "Request friends list",
    priority: "high",
  },
  {
    opcode: GameOpcode.CMSG_ADD_FRIEND,
    area: "social",
    label: "Add friend",
    priority: "high",
  },
  {
    opcode: GameOpcode.CMSG_DEL_FRIEND,
    area: "social",
    label: "Remove friend",
    priority: "high",
  },
  {
    opcode: GameOpcode.CMSG_ADD_IGNORE,
    area: "social",
    label: "Ignore player",
    priority: "high",
  },
  {
    opcode: GameOpcode.CMSG_DEL_IGNORE,
    area: "social",
    label: "Unignore player",
    priority: "high",
  },

  // Channel management
  {
    opcode: GameOpcode.CMSG_JOIN_CHANNEL,
    area: "channel",
    label: "Join channel",
    priority: "high",
  },
  {
    opcode: GameOpcode.CMSG_LEAVE_CHANNEL,
    area: "channel",
    label: "Leave channel",
    priority: "high",
  },
  {
    opcode: GameOpcode.CMSG_CHANNEL_LIST,
    area: "channel",
    label: "Channel member list",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_CHANNEL_LIST,
    area: "channel",
    label: "Channel member list",
    priority: "medium",
  },

  // Guild
  {
    opcode: GameOpcode.CMSG_GUILD_QUERY,
    area: "guild",
    label: "Guild name query",
    priority: "high",
  },
  {
    opcode: GameOpcode.SMSG_GUILD_QUERY_RESPONSE,
    area: "guild",
    label: "Guild name query",
    priority: "high",
  },
  {
    opcode: GameOpcode.CMSG_GUILD_ROSTER,
    area: "guild",
    label: "Guild roster",
    priority: "high",
  },
  {
    opcode: GameOpcode.SMSG_GUILD_ROSTER,
    area: "guild",
    label: "Guild roster",
    priority: "high",
  },
  {
    opcode: GameOpcode.SMSG_GUILD_EVENT,
    area: "guild",
    label: "Guild events",
    priority: "high",
  },
  {
    opcode: GameOpcode.SMSG_GUILD_COMMAND_RESULT,
    area: "guild",
    label: "Guild command result",
    priority: "high",
  },
  {
    opcode: GameOpcode.CMSG_GUILD_INVITE,
    area: "guild",
    label: "Guild invite",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_GUILD_INVITE,
    area: "guild",
    label: "Guild invite",
    priority: "medium",
  },
  {
    opcode: GameOpcode.CMSG_GUILD_ACCEPT,
    area: "guild",
    label: "Accept guild invite",
    priority: "medium",
  },
  {
    opcode: GameOpcode.CMSG_GUILD_DECLINE,
    area: "guild",
    label: "Decline guild invite",
    priority: "medium",
  },
  {
    opcode: GameOpcode.CMSG_GUILD_LEAVE,
    area: "guild",
    label: "Leave guild",
    priority: "medium",
  },
  {
    opcode: GameOpcode.CMSG_GUILD_REMOVE,
    area: "guild",
    label: "Guild kick",
    priority: "medium",
  },
  {
    opcode: GameOpcode.CMSG_GUILD_MOTD,
    area: "guild",
    label: "Set guild MOTD",
    priority: "medium",
  },
  {
    opcode: GameOpcode.CMSG_GUILD_PROMOTE,
    area: "guild",
    label: "Guild promote",
    priority: "low",
  },
  {
    opcode: GameOpcode.CMSG_GUILD_DEMOTE,
    area: "guild",
    label: "Guild demote",
    priority: "low",
  },
  {
    opcode: GameOpcode.CMSG_GUILD_LEADER,
    area: "guild",
    label: "Set guild leader",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_GUILD_INFO,
    area: "guild",
    label: "Guild info",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_GUILD_BANK_LIST,
    area: "guild",
    label: "Guild bank",
    priority: "low",
  },

  // Chat extras
  {
    opcode: GameOpcode.SMSG_CHAT_SERVER_MESSAGE,
    area: "chat",
    label: "Server broadcast message",
    priority: "high",
  },
  {
    opcode: GameOpcode.SMSG_CHAT_PLAYER_AMBIGUOUS,
    area: "chat",
    label: "Ambiguous player name",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_CHAT_RESTRICTED,
    area: "chat",
    label: "Chat restricted",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_CHAT_NOT_IN_PARTY,
    area: "chat",
    label: "Not in party",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_CHAT_WRONG_FACTION,
    area: "chat",
    label: "Wrong faction",
    priority: "medium",
  },

  // Mail
  {
    opcode: GameOpcode.CMSG_SEND_MAIL,
    area: "mail",
    label: "Send mail",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_SEND_MAIL_RESULT,
    area: "mail",
    label: "Mail result",
    priority: "medium",
  },
  {
    opcode: GameOpcode.CMSG_GET_MAIL_LIST,
    area: "mail",
    label: "Read mail",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_MAIL_LIST_RESULT,
    area: "mail",
    label: "Mail list",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_RECEIVED_MAIL,
    area: "mail",
    label: "New mail notification",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_SHOW_MAILBOX,
    area: "mail",
    label: "Mailbox opened",
    priority: "medium",
  },

  // Emotes
  {
    opcode: GameOpcode.CMSG_TEXT_EMOTE,
    area: "emote",
    label: "Text emote",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_TEXT_EMOTE,
    area: "emote",
    label: "Text emote",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_EMOTE,
    area: "emote",
    label: "Emote animation",
    priority: "medium",
  },

  // Random roll
  {
    opcode: GameOpcode.MSG_RANDOM_ROLL,
    area: "social",
    label: "Random roll",
    priority: "medium",
  },

  // Ready check
  {
    opcode: GameOpcode.MSG_RAID_READY_CHECK,
    area: "group",
    label: "Ready check",
    priority: "medium",
  },
  {
    opcode: GameOpcode.MSG_RAID_READY_CHECK_CONFIRM,
    area: "group",
    label: "Ready check confirm",
    priority: "medium",
  },
  {
    opcode: GameOpcode.MSG_RAID_READY_CHECK_FINISHED,
    area: "group",
    label: "Ready check finished",
    priority: "medium",
  },

  // Notifications
  {
    opcode: GameOpcode.SMSG_NOTIFICATION,
    area: "system",
    label: "Server notification",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_LEVELUP_INFO,
    area: "system",
    label: "Level up",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_LOG_XPGAIN,
    area: "system",
    label: "XP gain",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_AREA_TRIGGER_MESSAGE,
    area: "system",
    label: "Area trigger message",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_SERVER_FIRST_ACHIEVEMENT,
    area: "system",
    label: "Server first achievement",
    priority: "medium",
  },

  // Achievement
  {
    opcode: GameOpcode.SMSG_ACHIEVEMENT_EARNED,
    area: "achievement",
    label: "Achievement earned",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_CRITERIA_UPDATE,
    area: "achievement",
    label: "Achievement criteria",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_ALL_ACHIEVEMENT_DATA,
    area: "achievement",
    label: "Achievement data",
    priority: "low",
  },

  // Duel
  {
    opcode: GameOpcode.SMSG_DUEL_REQUESTED,
    area: "duel",
    label: "Duel request",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_DUEL_WINNER,
    area: "duel",
    label: "Duel result",
    priority: "medium",
  },
  {
    opcode: GameOpcode.SMSG_DUEL_COMPLETE,
    area: "duel",
    label: "Duel complete",
    priority: "medium",
  },

  // World objects
  {
    opcode: GameOpcode.SMSG_UPDATE_OBJECT,
    area: "world",
    label: "World object update",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_DESTROY_OBJECT,
    area: "world",
    label: "World object destroyed",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_COMPRESSED_UPDATE_OBJECT,
    area: "world",
    label: "Compressed world update",
    priority: "low",
  },

  // Movement
  {
    opcode: GameOpcode.SMSG_MONSTER_MOVE,
    area: "movement",
    label: "NPC movement",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_FORCE_RUN_SPEED_CHANGE,
    area: "movement",
    label: "Speed change",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_FORCE_MOVE_ROOT,
    area: "movement",
    label: "Rooted",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_FORCE_MOVE_UNROOT,
    area: "movement",
    label: "Unrooted",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_MOVE_KNOCK_BACK,
    area: "movement",
    label: "Knockback",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_MOVE_SET_CAN_FLY,
    area: "movement",
    label: "Flight enabled",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_MOVE_UNSET_CAN_FLY,
    area: "movement",
    label: "Flight disabled",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_COMPRESSED_MOVES,
    area: "movement",
    label: "Compressed movement",
    priority: "low",
  },

  // Spells
  {
    opcode: GameOpcode.SMSG_INITIAL_SPELLS,
    area: "spell",
    label: "Spellbook",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_LEARNED_SPELL,
    area: "spell",
    label: "Spell learned",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_SPELL_START,
    area: "spell",
    label: "Spell cast start",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_SPELL_GO,
    area: "spell",
    label: "Spell cast",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_SPELL_FAILURE,
    area: "spell",
    label: "Spell failed",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_CAST_FAILED,
    area: "spell",
    label: "Cast failed",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_SPELL_COOLDOWN,
    area: "spell",
    label: "Spell cooldown",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_AURA_UPDATE_ALL,
    area: "spell",
    label: "Aura updates",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_AURA_UPDATE,
    area: "spell",
    label: "Aura update",
    priority: "low",
  },

  // Combat
  {
    opcode: GameOpcode.SMSG_ATTACKSTART,
    area: "combat",
    label: "Combat started",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_ATTACKSTOP,
    area: "combat",
    label: "Combat stopped",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_ATTACKERSTATEUPDATE,
    area: "combat",
    label: "Damage dealt",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_SPELLHEALLOG,
    area: "combat",
    label: "Heal received",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_SPELLNONMELEEDAMAGELOG,
    area: "combat",
    label: "Spell damage",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_ENVIRONMENTAL_DAMAGE_LOG,
    area: "combat",
    label: "Environmental damage",
    priority: "low",
  },

  // Loot
  {
    opcode: GameOpcode.SMSG_LOOT_RESPONSE,
    area: "loot",
    label: "Loot window",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_LOOT_RELEASE_RESPONSE,
    area: "loot",
    label: "Loot released",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_LOOT_START_ROLL,
    area: "loot",
    label: "Loot roll",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_LOOT_ROLL_WON,
    area: "loot",
    label: "Won loot roll",
    priority: "low",
  },

  // Items
  {
    opcode: GameOpcode.SMSG_ITEM_PUSH_RESULT,
    area: "item",
    label: "Item received",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_INVENTORY_CHANGE_FAILURE,
    area: "item",
    label: "Inventory error",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_EQUIPMENT_SET_LIST,
    area: "item",
    label: "Equipment sets",
    priority: "low",
  },

  // Trade
  {
    opcode: GameOpcode.SMSG_TRADE_STATUS,
    area: "trade",
    label: "Trade window",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_TRADE_STATUS_EXTENDED,
    area: "trade",
    label: "Trade update",
    priority: "low",
  },

  // Vendor
  {
    opcode: GameOpcode.SMSG_LIST_INVENTORY,
    area: "vendor",
    label: "Vendor window",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_BUY_FAILED,
    area: "vendor",
    label: "Purchase failed",
    priority: "low",
  },

  // NPC/Gossip
  {
    opcode: GameOpcode.SMSG_GOSSIP_MESSAGE,
    area: "npc",
    label: "NPC dialogue",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_GOSSIP_COMPLETE,
    area: "npc",
    label: "NPC dialogue closed",
    priority: "low",
  },

  // Quest
  {
    opcode: GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS,
    area: "quest",
    label: "Quest details",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_QUESTGIVER_QUEST_COMPLETE,
    area: "quest",
    label: "Quest complete",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_QUESTUPDATE_ADD_KILL,
    area: "quest",
    label: "Quest progress",
    priority: "low",
  },

  // Taxi
  {
    opcode: GameOpcode.SMSG_SHOWTAXINODES,
    area: "taxi",
    label: "Flight master",
    priority: "low",
  },

  // Trainer
  {
    opcode: GameOpcode.SMSG_TRAINER_LIST,
    area: "trainer",
    label: "Trainer window",
    priority: "low",
  },

  // Auction
  {
    opcode: GameOpcode.SMSG_AUCTION_LIST_RESULT,
    area: "auction",
    label: "Auction results",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_AUCTION_OWNER_NOTIFICATION,
    area: "auction",
    label: "Auction sold",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_AUCTION_BIDDER_NOTIFICATION,
    area: "auction",
    label: "Auction outbid",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_AUCTION_COMMAND_RESULT,
    area: "auction",
    label: "Auction result",
    priority: "low",
  },

  // Battlefield/PvP
  {
    opcode: GameOpcode.SMSG_BATTLEFIELD_STATUS,
    area: "pvp",
    label: "Battleground status",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_BATTLEFIELD_LIST,
    area: "pvp",
    label: "Battleground list",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_ZONE_UNDER_ATTACK,
    area: "pvp",
    label: "Zone under attack",
    priority: "low",
  },

  // LFG
  {
    opcode: GameOpcode.SMSG_LFG_UPDATE_PLAYER,
    area: "lfg",
    label: "LFG status",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_LFG_PROPOSAL_UPDATE,
    area: "lfg",
    label: "LFG proposal",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_LFG_QUEUE_STATUS,
    area: "lfg",
    label: "LFG queue",
    priority: "low",
  },

  // Calendar
  {
    opcode: GameOpcode.SMSG_CALENDAR_SEND_CALENDAR,
    area: "calendar",
    label: "Calendar",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_CALENDAR_EVENT_INVITE_ALERT,
    area: "calendar",
    label: "Calendar invite",
    priority: "low",
  },

  // Arena
  {
    opcode: GameOpcode.SMSG_ARENA_TEAM_EVENT,
    area: "arena",
    label: "Arena team event",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_ARENA_TEAM_COMMAND_RESULT,
    area: "arena",
    label: "Arena command result",
    priority: "low",
  },

  // Weather
  {
    opcode: GameOpcode.SMSG_WEATHER,
    area: "weather",
    label: "Weather change",
    priority: "low",
  },

  // World state
  {
    opcode: GameOpcode.SMSG_INIT_WORLD_STATES,
    area: "world",
    label: "World states",
    priority: "low",
  },

  // Warden
  {
    opcode: GameOpcode.SMSG_WARDEN_DATA,
    area: "warden",
    label: "Warden anti-cheat",
    priority: "low",
  },

  // Login data (sent at login, safe to ignore)
  {
    opcode: GameOpcode.SMSG_LOGIN_SETTIMESPEED,
    area: "login",
    label: "Game time",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_ACCOUNT_DATA_TIMES,
    area: "login",
    label: "Account data",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_FEATURE_SYSTEM_STATUS,
    area: "login",
    label: "System features",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_TUTORIAL_FLAGS,
    area: "login",
    label: "Tutorial flags",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_INITIALIZE_FACTIONS,
    area: "login",
    label: "Factions",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_SET_PROFICIENCY,
    area: "login",
    label: "Proficiency",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_ACTION_BUTTONS,
    area: "login",
    label: "Action buttons",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_TALENTS_INFO,
    area: "login",
    label: "Talents",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_BINDPOINTUPDATE,
    area: "login",
    label: "Bind point",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_POWER_UPDATE,
    area: "login",
    label: "Power update",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_HEALTH_UPDATE,
    area: "login",
    label: "Health update",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_SET_PHASE_SHIFT,
    area: "login",
    label: "Phase shift",
    priority: "low",
  },

  // Sound/visual
  {
    opcode: GameOpcode.SMSG_PLAY_SOUND,
    area: "visual",
    label: "Sound effect",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_PLAY_MUSIC,
    area: "visual",
    label: "Music",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_PLAY_SPELL_VISUAL,
    area: "visual",
    label: "Spell visual",
    priority: "low",
  },

  // Death
  {
    opcode: GameOpcode.SMSG_RESURRECT_REQUEST,
    area: "death",
    label: "Resurrect request",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_CORPSE_RECLAIM_DELAY,
    area: "death",
    label: "Corpse reclaim",
    priority: "low",
  },

  // Instance
  {
    opcode: GameOpcode.SMSG_INSTANCE_DIFFICULTY,
    area: "instance",
    label: "Instance difficulty",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_RAID_INSTANCE_MESSAGE,
    area: "instance",
    label: "Instance message",
    priority: "low",
  },
];

export function registerStubs(
  dispatch: OpcodeDispatch,
  notify: (message: string) => void,
): void {
  for (const stub of STUBS) {
    const name = Object.entries(GameOpcode).find(
      ([, v]) => v === stub.opcode,
    )?.[0];
    if (!name || (!name.startsWith("SMSG") && !name.startsWith("MSG_")))
      continue;
    if (dispatch.has(stub.opcode)) continue;

    let fired = false;
    dispatch.on(stub.opcode, () => {
      if (!fired) {
        fired = true;
        notify(`[tuicraft] ${stub.label} is not yet implemented`);
      }
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `mise test src/wow/protocol/stubs.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add opcode stub registry

Single-file registry of all unimplemented opcodes with metadata. SMSG
stubs get dispatch handlers that notify users on first receipt.
```

---

### Task 4: Wire registerStubs into client.ts

**Files:**

- Modify: `src/wow/client.ts`

**Step 1: Add import**

Add to imports in `client.ts`:

```ts
import { registerStubs } from "wow/protocol/stubs";
```

**Step 2: Call registerStubs after real handlers**

In the `worldSession` function, after all the `conn.dispatch.on(...)` calls (after
the SMSG_PARTY_MEMBER_STATS_FULL handler, around line 708), add:

```ts
registerStubs(conn.dispatch, (msg) => {
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message: msg,
  });
});
```

**Step 3: Run full test suite**

Run: `mise test`
Expected: All existing tests PASS

**Step 4: Commit**

```
feat: Register opcode stubs in world session

Unimplemented opcodes now show a user-visible notification on first
receipt instead of being silently dropped.
```

---

### Task 5: Add TUI command stubs

**Files:**

- Modify: `src/ui/tui.ts`
- Test: `src/ui/tui.test.ts`

**Step 1: Write failing tests**

Add to the parseCommand tests in `src/ui/tui.test.ts`:

```ts
describe("unimplemented commands", () => {
  test("/friends returns unimplemented", () => {
    expect(parseCommand("/friends")).toEqual({
      type: "unimplemented",
      feature: "Friends list",
    });
  });
  test("/f returns unimplemented", () => {
    expect(parseCommand("/f")).toEqual({
      type: "unimplemented",
      feature: "Friends list",
    });
  });
  test("/ignore returns unimplemented", () => {
    expect(parseCommand("/ignore Foo")).toEqual({
      type: "unimplemented",
      feature: "Ignore list",
    });
  });
  test("/join returns unimplemented", () => {
    expect(parseCommand("/join Trade")).toEqual({
      type: "unimplemented",
      feature: "Channel join/leave",
    });
  });
  test("/ginvite returns unimplemented", () => {
    expect(parseCommand("/ginvite Foo")).toEqual({
      type: "unimplemented",
      feature: "Guild management",
    });
  });
  test("/gkick returns unimplemented", () => {
    expect(parseCommand("/gkick Foo")).toEqual({
      type: "unimplemented",
      feature: "Guild management",
    });
  });
  test("/gleave returns unimplemented", () => {
    expect(parseCommand("/gleave")).toEqual({
      type: "unimplemented",
      feature: "Guild management",
    });
  });
  test("/gpromote returns unimplemented", () => {
    expect(parseCommand("/gpromote Foo")).toEqual({
      type: "unimplemented",
      feature: "Guild management",
    });
  });
  test("/mail returns unimplemented", () => {
    expect(parseCommand("/mail")).toEqual({
      type: "unimplemented",
      feature: "Mail",
    });
  });
  test("/roll returns unimplemented", () => {
    expect(parseCommand("/roll")).toEqual({
      type: "unimplemented",
      feature: "Random roll",
    });
  });
  test("/dnd returns unimplemented", () => {
    expect(parseCommand("/dnd")).toEqual({
      type: "unimplemented",
      feature: "Player status",
    });
  });
  test("/afk returns unimplemented", () => {
    expect(parseCommand("/afk")).toEqual({
      type: "unimplemented",
      feature: "Player status",
    });
  });
  test("/e returns unimplemented", () => {
    expect(parseCommand("/e waves")).toEqual({
      type: "unimplemented",
      feature: "Text emotes",
    });
  });
  test("/emote returns unimplemented", () => {
    expect(parseCommand("/emote waves")).toEqual({
      type: "unimplemented",
      feature: "Text emotes",
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/ui/tui.test.ts`
Expected: FAIL

**Step 3: Implement**

Add `unimplemented` to the `Command` type:

```ts
| { type: "unimplemented"; feature: string }
```

Add cases to `parseCommand` switch (before the default case):

```ts
case "/friends":
case "/f":
  return { type: "unimplemented", feature: "Friends list" };
case "/ignore":
  return { type: "unimplemented", feature: "Ignore list" };
case "/join":
  return { type: "unimplemented", feature: "Channel join/leave" };
case "/ginvite":
case "/gkick":
case "/gleave":
case "/gpromote":
  return { type: "unimplemented", feature: "Guild management" };
case "/mail":
  return { type: "unimplemented", feature: "Mail" };
case "/roll":
  return { type: "unimplemented", feature: "Random roll" };
case "/dnd":
case "/afk":
  return { type: "unimplemented", feature: "Player status" };
case "/e":
case "/emote":
  return { type: "unimplemented", feature: "Text emotes" };
```

Add to `executeCommand` switch:

```ts
case "unimplemented":
  state.write(formatError(`${cmd.feature} is not yet implemented`) + "\n");
  break;
```

**Step 4: Run tests**

Run: `mise test src/ui/tui.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add TUI command stubs for unimplemented features

Typing /friends, /ignore, /join, /ginvite, /mail, /roll, /dnd, /afk,
or /emote now shows a "not yet implemented" message.
```

---

### Task 6: Add IPC command stubs

**Files:**

- Modify: `src/daemon/commands.ts`
- Test: `src/daemon/commands.test.ts`

**Step 1: Write failing tests**

Add to the parseIpcCommand tests:

```ts
describe("unimplemented IPC commands", () => {
  const cases = [
    ["FRIENDS", "Friends list"],
    ["IGNORE Foo", "Ignore list"],
    ["JOIN Trade", "Channel join/leave"],
    ["GINVITE Foo", "Guild management"],
    ["GKICK Foo", "Guild management"],
    ["GLEAVE", "Guild management"],
    ["GPROMOTE Foo", "Guild management"],
    ["MAIL", "Mail"],
    ["ROLL", "Random roll"],
    ["DND", "Player status"],
    ["AFK", "Player status"],
    ["EMOTE waves", "Text emotes"],
  ] as const;

  for (const [input, feature] of cases) {
    test(`${input.split(" ")[0]} returns unimplemented`, () => {
      expect(parseIpcCommand(input)).toEqual({
        type: "unimplemented",
        feature,
      });
    });
  }
});
```

Also add a test for `dispatchCommand` handling unimplemented:

```ts
test("dispatchCommand writes UNIMPLEMENTED for stub commands", async () => {
  const written: string[] = [];
  const socket = {
    write: (s: string) => {
      written.push(s);
      return s.length;
    },
    end: () => {},
  };
  // ... use minimal mocks for handle/events/cleanup
  await dispatchCommand(
    { type: "unimplemented", feature: "Friends list" },
    handle,
    events,
    socket,
    () => {},
  );
  expect(written.join("")).toContain("UNIMPLEMENTED Friends list");
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/daemon/commands.test.ts`
Expected: FAIL

**Step 3: Implement**

Add to `IpcCommand` type:

```ts
| { type: "unimplemented"; feature: string }
```

Add cases to `parseIpcCommand` switch:

```ts
case "FRIENDS":
  return { type: "unimplemented", feature: "Friends list" };
case "IGNORE":
  return { type: "unimplemented", feature: "Ignore list" };
case "JOIN":
  return { type: "unimplemented", feature: "Channel join/leave" };
case "GINVITE":
case "GKICK":
case "GLEAVE":
case "GPROMOTE":
  return { type: "unimplemented", feature: "Guild management" };
case "MAIL":
  return { type: "unimplemented", feature: "Mail" };
case "ROLL":
  return { type: "unimplemented", feature: "Random roll" };
case "DND":
case "AFK":
  return { type: "unimplemented", feature: "Player status" };
case "EMOTE":
  return { type: "unimplemented", feature: "Text emotes" };
```

Add to `dispatchCommand` switch:

```ts
case "unimplemented":
  writeLines(socket, [`UNIMPLEMENTED ${cmd.feature}`]);
  return false;
```

**Step 4: Run tests**

Run: `mise test src/daemon/commands.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add IPC command stubs for unimplemented features

Daemon commands FRIENDS, IGNORE, JOIN, GINVITE, MAIL, ROLL, DND, AFK,
and EMOTE now return UNIMPLEMENTED responses.
```

---

### Task 7: Delete bugs.md and final verification

**Files:**

- Delete: `docs/bugs.md`

**Step 1: Run full test suite**

Run: `mise ci`
Expected: All tests pass, typecheck clean, format clean

**Step 2: Delete bugs.md**

```bash
git rm docs/bugs.md
```

**Step 3: Run format fix**

Run: `mise format:fix`

**Step 4: Commit**

```
chore: Remove bugs.md

The opcode stub registry in stubs.ts is now the source of truth for
unimplemented features.
```

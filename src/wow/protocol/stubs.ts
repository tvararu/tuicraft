import type { OpcodeDispatch } from "wow/protocol/world";
import { GameOpcode } from "wow/protocol/opcodes";

export type StubEntry = {
  opcode: number;
  area: string;
  label: string;
  priority: "high" | "medium" | "low";
};

export const STUBS: StubEntry[] = [
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

  {
    opcode: GameOpcode.MSG_RANDOM_ROLL,
    area: "social",
    label: "Random roll",
    priority: "medium",
  },

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

  {
    opcode: GameOpcode.SMSG_SHOWTAXINODES,
    area: "taxi",
    label: "Flight master",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_TRAINER_LIST,
    area: "trainer",
    label: "Trainer window",
    priority: "low",
  },

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

  {
    opcode: GameOpcode.SMSG_WEATHER,
    area: "weather",
    label: "Weather change",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_INIT_WORLD_STATES,
    area: "world",
    label: "World states",
    priority: "low",
  },
  {
    opcode: GameOpcode.SMSG_WARDEN_DATA,
    area: "warden",
    label: "Warden anti-cheat",
    priority: "low",
  },

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

import { GameOpcode } from "#wow/protocol/opcodes";
import type { OpcodeDispatch } from "#wow/protocol/world";

export const STUBS: [opcode: number, label: string][] = [
  [GameOpcode.SMSG_CHANNEL_LIST, "Channel member list"],
  [GameOpcode.SMSG_GUILD_INFO, "Guild info"],
  [GameOpcode.SMSG_GUILD_BANK_LIST, "Guild bank"],
  [GameOpcode.SMSG_CHAT_PLAYER_AMBIGUOUS, "Ambiguous player name"],
  [GameOpcode.SMSG_CHAT_NOT_IN_PARTY, "Not in party"],
  [GameOpcode.SMSG_SEND_MAIL_RESULT, "Mail result"],
  [GameOpcode.SMSG_MAIL_LIST_RESULT, "Mail list"],
  [GameOpcode.SMSG_SHOW_MAILBOX, "Mailbox opened"],
  [GameOpcode.SMSG_TEXT_EMOTE, "Text emote"],
  [GameOpcode.SMSG_EMOTE, "Emote animation"],
  [GameOpcode.MSG_RAID_READY_CHECK, "Ready check"],
  [GameOpcode.MSG_RAID_READY_CHECK_CONFIRM, "Ready check confirm"],
  [GameOpcode.MSG_RAID_READY_CHECK_FINISHED, "Ready check finished"],
  [GameOpcode.SMSG_AREA_TRIGGER_MESSAGE, "Area trigger message"],
  [GameOpcode.SMSG_SERVER_FIRST_ACHIEVEMENT, "Server first achievement"],
  [GameOpcode.SMSG_ACHIEVEMENT_EARNED, "Achievement earned"],
  [GameOpcode.SMSG_CRITERIA_UPDATE, "Achievement criteria"],
  [GameOpcode.SMSG_ALL_ACHIEVEMENT_DATA, "Achievement data"],
  [GameOpcode.SMSG_ATTACKERSTATEUPDATE, "Damage dealt"],
  [GameOpcode.SMSG_SPELLHEALLOG, "Heal received"],
  [GameOpcode.SMSG_SPELLNONMELEEDAMAGELOG, "Spell damage"],
  [GameOpcode.SMSG_ENVIRONMENTAL_DAMAGE_LOG, "Environmental damage"],
  [GameOpcode.SMSG_EQUIPMENT_SET_LIST, "Equipment sets"],
  [GameOpcode.SMSG_TRADE_STATUS, "Trade window"],
  [GameOpcode.SMSG_TRADE_STATUS_EXTENDED, "Trade update"],
  [GameOpcode.SMSG_AUCTION_LIST_RESULT, "Auction results"],
  [GameOpcode.SMSG_AUCTION_OWNER_NOTIFICATION, "Auction sold"],
  [GameOpcode.SMSG_AUCTION_BIDDER_NOTIFICATION, "Auction outbid"],
  [GameOpcode.SMSG_AUCTION_COMMAND_RESULT, "Auction result"],
  [GameOpcode.SMSG_BATTLEFIELD_STATUS, "Battleground status"],
  [GameOpcode.SMSG_BATTLEFIELD_LIST, "Battleground list"],
  [GameOpcode.SMSG_ZONE_UNDER_ATTACK, "Zone under attack"],
  [GameOpcode.SMSG_LFG_UPDATE_PLAYER, "LFG status"],
  [GameOpcode.SMSG_LFG_PROPOSAL_UPDATE, "LFG proposal"],
  [GameOpcode.SMSG_LFG_QUEUE_STATUS, "LFG queue"],
  [GameOpcode.SMSG_CALENDAR_SEND_CALENDAR, "Calendar"],
  [GameOpcode.SMSG_CALENDAR_EVENT_INVITE_ALERT, "Calendar invite"],
  [GameOpcode.SMSG_ARENA_TEAM_EVENT, "Arena team event"],
  [GameOpcode.SMSG_ARENA_TEAM_COMMAND_RESULT, "Arena command result"],
  [GameOpcode.SMSG_WEATHER, "Weather change"],
  [GameOpcode.SMSG_INIT_WORLD_STATES, "World states"],
  [GameOpcode.SMSG_WARDEN_DATA, "Warden anti-cheat"],
  [GameOpcode.SMSG_LOGIN_SETTIMESPEED, "Game time"],
  [GameOpcode.SMSG_ACCOUNT_DATA_TIMES, "Account data"],
  [GameOpcode.SMSG_FEATURE_SYSTEM_STATUS, "System features"],
  [GameOpcode.SMSG_TUTORIAL_FLAGS, "Tutorial flags"],
  [GameOpcode.SMSG_INITIALIZE_FACTIONS, "Factions"],
  [GameOpcode.SMSG_SET_PROFICIENCY, "Proficiency"],
  [GameOpcode.SMSG_ACTION_BUTTONS, "Action buttons"],
  [GameOpcode.SMSG_TALENTS_INFO, "Talents"],
  [GameOpcode.SMSG_BINDPOINTUPDATE, "Bind point"],
  [GameOpcode.SMSG_POWER_UPDATE, "Power update"],
  [GameOpcode.SMSG_HEALTH_UPDATE, "Health update"],
  [GameOpcode.SMSG_SET_PHASE_SHIFT, "Phase shift"],
  [GameOpcode.SMSG_PLAY_SOUND, "Sound effect"],
  [GameOpcode.SMSG_PLAY_MUSIC, "Music"],
  [GameOpcode.SMSG_PLAY_SPELL_VISUAL, "Spell visual"],
  [GameOpcode.SMSG_INSTANCE_DIFFICULTY, "Instance difficulty"],
  [GameOpcode.SMSG_RAID_INSTANCE_MESSAGE, "Instance message"],
];

export function registerStubs(
  dispatch: OpcodeDispatch,
  notify: (message: string) => boolean,
): void {
  for (const [opcode, label] of STUBS) {
    if (dispatch.has(opcode)) continue;
    let fired = false;
    dispatch.on(opcode, () => {
      if (!fired) fired = notify(`[tuicraft] ${label} is not yet implemented`);
    });
  }
}

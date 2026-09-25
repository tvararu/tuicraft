import type { WorldConn } from "wow/client";
import { parseAuraUpdate, parseAuraUpdateAll } from "wow/protocol/aura";
import {
  ATTACK_SWING_ERRORS,
  parseAttackStart,
  parseAttackStop,
  parseXpGain,
} from "wow/protocol/combat";
import {
  parseCorpseQuery,
  parseCorpseReclaimDelay,
  parseDeathReleaseLocation,
  parseResurrectRequest,
} from "wow/protocol/death";
import { parseGossipMessage } from "wow/protocol/gossip";
import { parseInventoryChangeFailure } from "wow/protocol/inventory";
import {
  parseItemPushResult,
  parseLootMoneyNotify,
  parseLootReleaseResponse,
  parseLootRemoved,
  parseLootResponse,
} from "wow/protocol/loot";
import { parseMonsterMove } from "wow/protocol/monster-move";
import { GameOpcode } from "wow/protocol/opcodes";
import type { PacketReader } from "wow/protocol/packet";
import {
  parseQuestFailed,
  parseQuestInvalid,
  parseQuestUpdateAddItem,
  parseQuestUpdateAddKill,
  parseQuestUpdateComplete,
  parseQuestUpdateFailed,
  parseQuestUpdateFailedTimer,
} from "wow/protocol/quest-log";
import { parseQuestQueryResponse } from "wow/protocol/quest-query";
import {
  parseQuestgiverOfferReward,
  parseQuestgiverQuestComplete,
  parseQuestgiverQuestDetails,
  parseQuestgiverQuestList,
  parseQuestgiverRequestItems,
  parseQuestgiverStatus,
} from "wow/protocol/questgiver";
import {
  parseCastFailed,
  parseCooldownNotice,
  parseInitialSpells,
  parseLearnedSpell,
  parseRemovedSpell,
  parseSpellCooldown,
  parseSpellDelayed,
  parseSpellFailure,
  parseSpellGo,
  parseSpellStart,
  parseSupersededSpell,
} from "wow/protocol/spell";
import type { QuestDialog } from "wow/quests";

export function registerCombatHandlers(conn: WorldConn): void {
  registerSpellHandlers(conn);
  registerMeleeHandlers(conn);
}

function registerSpellHandlers(conn: WorldConn): void {
  const on = (opcode: number, handle: (r: PacketReader) => void) =>
    conn.dispatch.on(opcode, handle);
  on(GameOpcode.SMSG_INITIAL_SPELLS, (r) =>
    conn.combat?.applyInitialSpells(parseInitialSpells(r)),
  );
  on(GameOpcode.SMSG_LEARNED_SPELL, (r) =>
    conn.combat?.applyLearned(parseLearnedSpell(r)),
  );
  on(GameOpcode.SMSG_REMOVED_SPELL, (r) =>
    conn.combat?.applyRemoved(parseRemovedSpell(r)),
  );
  on(GameOpcode.SMSG_SUPERCEDED_SPELL, (r) =>
    conn.combat?.applySuperseded(parseSupersededSpell(r)),
  );
  on(GameOpcode.SMSG_SPELL_START, (r) =>
    conn.combat?.applySpellStart(parseSpellStart(r)),
  );
  on(GameOpcode.SMSG_SPELL_GO, (r) =>
    conn.combat?.applySpellGo(parseSpellGo(r)),
  );
  on(GameOpcode.SMSG_CAST_FAILED, (r) =>
    conn.combat?.applyCastFailed(parseCastFailed(r)),
  );
  on(GameOpcode.SMSG_SPELL_FAILURE, (r) =>
    conn.combat?.applySpellFailure(parseSpellFailure(r)),
  );
  on(GameOpcode.SMSG_SPELL_COOLDOWN, (r) =>
    conn.combat?.applyCooldown(parseSpellCooldown(r)),
  );
  on(GameOpcode.SMSG_CLEAR_COOLDOWN, (r) =>
    conn.combat?.applyClearCooldown(parseCooldownNotice(r)),
  );
  on(GameOpcode.SMSG_COOLDOWN_EVENT, (r) =>
    conn.combat?.applyCooldownEvent(parseCooldownNotice(r)),
  );
  on(GameOpcode.SMSG_SPELL_DELAYED, (r) =>
    conn.combat?.applySpellDelayed(parseSpellDelayed(r)),
  );
}

function registerMeleeHandlers(conn: WorldConn): void {
  const on = (opcode: number, handle: (r: PacketReader) => void) =>
    conn.dispatch.on(opcode, handle);
  on(GameOpcode.SMSG_CANCEL_COMBAT, () => conn.combat?.applyCancelCombat());
  for (const [opcode, error] of ATTACK_SWING_ERRORS)
    on(opcode, () => conn.combat?.applyAttackError(error));
  on(GameOpcode.SMSG_ATTACKSTART, (r) =>
    conn.combat?.applyAttackStart(parseAttackStart(r)),
  );
  on(GameOpcode.SMSG_ATTACKSTOP, (r) =>
    conn.combat?.applyAttackStop(parseAttackStop(r)),
  );
  on(GameOpcode.SMSG_AURA_UPDATE, (r) =>
    conn.combat?.applyAura(parseAuraUpdate(r)),
  );
  on(GameOpcode.SMSG_AURA_UPDATE_ALL, (r) =>
    conn.combat?.applyAuraAll(parseAuraUpdateAll(r)),
  );
  on(GameOpcode.SMSG_LOG_XPGAIN, (r) => conn.combat?.applyXp(parseXpGain(r)));
  on(GameOpcode.SMSG_MONSTER_MOVE, (r) =>
    conn.combat?.applyMonsterMove(
      parseMonsterMove(r),
      conn.control?.currentMapId() ?? 0,
    ),
  );
}

export function registerQuestHandlers(conn: WorldConn): void {
  const on = (opcode: number, handle: (r: PacketReader) => void) =>
    conn.dispatch.on(opcode, handle);
  const dialog = (opcode: number, read: (r: PacketReader) => QuestDialog) =>
    on(opcode, (r) => conn.quests?.openDialog(read(r)));
  dialog(GameOpcode.SMSG_GOSSIP_MESSAGE, (r) => ({
    kind: "gossip",
    data: parseGossipMessage(r),
  }));
  dialog(GameOpcode.SMSG_QUESTGIVER_QUEST_LIST, (r) => ({
    kind: "list",
    data: parseQuestgiverQuestList(r),
  }));
  dialog(GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS, (r) => ({
    kind: "details",
    data: parseQuestgiverQuestDetails(r),
  }));
  dialog(GameOpcode.SMSG_QUESTGIVER_REQUEST_ITEMS, (r) => ({
    kind: "requestItems",
    data: parseQuestgiverRequestItems(r),
  }));
  dialog(GameOpcode.SMSG_QUESTGIVER_OFFER_REWARD, (r) => ({
    kind: "offer",
    data: parseQuestgiverOfferReward(r),
  }));
  on(GameOpcode.SMSG_GOSSIP_COMPLETE, () => conn.quests?.closeDialog());
  on(GameOpcode.SMSG_QUEST_QUERY_RESPONSE, (r) =>
    conn.quests?.receiveQuery(parseQuestQueryResponse(r)),
  );
  registerQuestProgressHandlers(conn);
}

function registerQuestProgressHandlers(conn: WorldConn): void {
  const on = (opcode: number, handle: (r: PacketReader) => void) =>
    conn.dispatch.on(opcode, handle);
  on(GameOpcode.SMSG_QUESTGIVER_QUEST_COMPLETE, (r) =>
    conn.quests?.receiveReward(parseQuestgiverQuestComplete(r)),
  );
  on(GameOpcode.SMSG_QUESTGIVER_STATUS, (r) =>
    conn.quests?.receiveStatus(parseQuestgiverStatus(r)),
  );
  on(GameOpcode.SMSG_QUESTUPDATE_ADD_KILL, (r) =>
    conn.quests?.receiveProgress({
      kind: "kill",
      data: parseQuestUpdateAddKill(r),
    }),
  );
  on(GameOpcode.SMSG_QUESTUPDATE_ADD_ITEM, (r) =>
    conn.quests?.receiveProgress({
      kind: "item",
      data: parseQuestUpdateAddItem(r),
    }),
  );
  on(GameOpcode.SMSG_QUESTUPDATE_COMPLETE, (r) =>
    conn.quests?.receiveProgress({
      kind: "complete",
      ...parseQuestUpdateComplete(r),
    }),
  );
  on(GameOpcode.SMSG_QUESTGIVER_QUEST_INVALID, (r) =>
    conn.quests?.receiveError({ kind: "invalid", ...parseQuestInvalid(r) }),
  );
  on(GameOpcode.SMSG_QUESTGIVER_QUEST_FAILED, (r) =>
    conn.quests?.receiveError({ kind: "quest_failed", ...parseQuestFailed(r) }),
  );
  on(GameOpcode.SMSG_QUESTUPDATE_FAILED, (r) =>
    conn.quests?.receiveError({ kind: "failed", ...parseQuestUpdateFailed(r) }),
  );
  on(GameOpcode.SMSG_QUESTUPDATE_FAILEDTIMER, (r) =>
    conn.quests?.receiveError({
      kind: "timer_failed",
      ...parseQuestUpdateFailedTimer(r),
    }),
  );
  on(GameOpcode.SMSG_QUESTLOG_FULL, () =>
    conn.quests?.receiveError({ kind: "log_full" }),
  );
}

export function registerLootHandlers(conn: WorldConn): void {
  const on = (opcode: number, handle: (r: PacketReader) => void) =>
    conn.dispatch.on(opcode, handle);
  on(GameOpcode.SMSG_LOOT_RESPONSE, (r) =>
    conn.rewards?.receiveLootResponse(parseLootResponse(r)),
  );
  on(GameOpcode.SMSG_LOOT_REMOVED, (r) =>
    conn.rewards?.receiveLootRemoved(parseLootRemoved(r)),
  );
  on(GameOpcode.SMSG_LOOT_RELEASE_RESPONSE, (r) =>
    conn.rewards?.receiveLootRelease(parseLootReleaseResponse(r)),
  );
  on(GameOpcode.SMSG_LOOT_MONEY_NOTIFY, (r) =>
    conn.rewards?.receiveMoneyNotice(parseLootMoneyNotify(r)),
  );
  on(GameOpcode.SMSG_LOOT_CLEAR_MONEY, () =>
    conn.rewards?.receiveLootMoneyCleared(),
  );
  on(GameOpcode.SMSG_ITEM_PUSH_RESULT, (r) =>
    conn.rewards?.receiveItemPush(parseItemPushResult(r)),
  );
  on(GameOpcode.SMSG_INVENTORY_CHANGE_FAILURE, (r) =>
    conn.rewards?.receiveInventoryFailure(parseInventoryChangeFailure(r)),
  );
}

export function registerRecoveryHandlers(conn: WorldConn): void {
  const on = (opcode: number, handle: (r: PacketReader) => void) =>
    conn.dispatch.on(opcode, handle);
  on(GameOpcode.MSG_CORPSE_QUERY, (r) =>
    conn.recovery?.receiveCorpse(parseCorpseQuery(r)),
  );
  on(GameOpcode.SMSG_CORPSE_RECLAIM_DELAY, (r) =>
    conn.recovery?.receiveReclaimDelay(parseCorpseReclaimDelay(r)),
  );
  on(GameOpcode.SMSG_DEATH_RELEASE_LOC, (r) =>
    conn.recovery?.receiveGraveyard(parseDeathReleaseLocation(r)),
  );
  on(GameOpcode.SMSG_RESURRECT_REQUEST, (r) =>
    conn.recovery?.receiveResurrectRequest(parseResurrectRequest(r)),
  );
}

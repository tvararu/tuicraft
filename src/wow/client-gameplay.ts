import type { WorldConn, WorldHandle } from "wow/client";
import type { Runtimes } from "wow/runtime";

export function combatMethods(conn: WorldConn, rt: Runtimes) {
  const { combat, tactics, recovery } = rt;
  return {
    getCombatState() {
      return combat.snapshot();
    },
    async getSpellbook() {
      await rt.prepareCatalog();
      return combat.spellbook();
    },
    cast(spellId, targetGuid) {
      rt.override();
      combat.cast(spellId, targetGuid);
    },
    attack(targetGuid) {
      rt.override();
      combat.attack(targetGuid);
    },
    cancelCast() {
      tactics.stop("manual_override");
      combat.cancelCast();
    },
    stopAttack() {
      tactics.stop("manual_override");
      combat.stopAttack();
    },
    startTactics(targetGuid, instruction, signal, framing) {
      const life = recovery.snapshot().life;
      if (life === "dead" || life === "ghost")
        throw new Error("self_not_alive");
      return tactics.start({ targetGuid, instruction, framing }, signal);
    },
    getTacticsState() {
      return tactics.snapshot();
    },
    onCombatEvent(cb) {
      return conn.events.combat.subscribe(cb);
    },
    onTacticsEvent(cb) {
      return conn.events.tactics.subscribe(cb);
    },
  } satisfies Partial<WorldHandle>;
}

export function recoveryMethods(conn: WorldConn, rt: Runtimes) {
  const { recovery } = rt;
  return {
    getRecoveryState() {
      return recovery.snapshot();
    },
    queryCorpse() {
      recovery.queryCorpse();
    },
    releaseSpirit() {
      rt.override();
      recovery.releaseSpirit();
    },
    reclaimCorpse() {
      rt.override();
      recovery.reclaimCorpse();
    },
    activateSpiritHealer(guid) {
      rt.override();
      recovery.activateSpiritHealer(guid);
    },
    respondResurrection(accept) {
      rt.override();
      recovery.respondResurrection(accept);
    },
    onRecoveryEvent(cb) {
      return conn.events.recovery.subscribe(cb);
    },
  } satisfies Partial<WorldHandle>;
}

export function questMethods(conn: WorldConn, rt: Runtimes) {
  const { quests } = rt;
  return {
    getQuestState() {
      return quests.snapshot();
    },
    talk(guid) {
      rt.override();
      quests.talk(guid);
    },
    queryQuest(questId) {
      quests.query(questId);
    },
    selectGossipOption(optionId, code) {
      rt.override();
      quests.selectOption(optionId, code);
    },
    selectQuest(questId) {
      rt.override();
      quests.selectQuest(questId);
    },
    acceptQuest() {
      rt.override();
      quests.accept();
    },
    onQuestEvent(cb) {
      return conn.events.quest.subscribe(cb);
    },
  } satisfies Partial<WorldHandle>;
}

export function questRewardMethods(rt: Runtimes) {
  const { quests } = rt;
  return {
    completeQuest(questId) {
      rt.override();
      quests.complete(questId);
    },
    requestQuestReward() {
      rt.override();
      quests.requestReward();
    },
    chooseQuestReward(index) {
      rt.override();
      quests.chooseReward(index);
    },
    abandonQuest(slot) {
      rt.override();
      quests.abandon(slot);
    },
    cancelInteraction() {
      rt.override();
      quests.cancel();
    },
  } satisfies Partial<WorldHandle>;
}

export function rewardsMethods(conn: WorldConn, rt: Runtimes) {
  const { rewards } = rt;
  return {
    getInventoryState() {
      return rewards.snapshot().inventory;
    },
    getRewardsState() {
      return rewards.snapshot();
    },
    openLoot(guid) {
      rt.override();
      rewards.open(guid);
    },
    takeLoot(slot) {
      rt.override();
      rewards.take(slot);
    },
    takeLootMoney() {
      rt.override();
      rewards.takeMoney();
    },
    releaseLoot() {
      rt.override();
      rewards.close();
    },
    onRewardsEvent(cb) {
      return conn.events.rewards.subscribe(cb);
    },
  } satisfies Partial<WorldHandle>;
}

export function cycleMethods(conn: WorldConn, rt: Runtimes) {
  const { cycle } = rt;
  return {
    async startCycle(guids, instruction, maxStarts) {
      rt.override();
      await cycle.start({ guids, instruction, maxStarts });
    },
    stopCycle() {
      cycle.stop("manual_override");
    },
    getCycleState() {
      return cycle.snapshot();
    },
    onCycleEvent(cb) {
      return conn.events.cycle.subscribe(cb);
    },
  } satisfies Partial<WorldHandle>;
}

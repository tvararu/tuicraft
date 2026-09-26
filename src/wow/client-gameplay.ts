import type { WorldHandle } from "wow/client";
import { readExperience } from "wow/experience";
import { labelInventory, labelRewards } from "wow/item-labels";
import { useItem } from "wow/item-use";
import { questCycleObjective } from "wow/quest-cycle";
import type { Runtimes } from "wow/runtime";
import type { WorldConn } from "wow/world-conn";
import { selfGuid } from "wow/world-handlers";

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
  const { rewards, items, combat, cycle, tactics } = rt;
  return {
    getInventoryState() {
      return labelInventory(rewards.snapshot().inventory, (entry) =>
        items.label(entry),
      );
    },
    getExperienceState() {
      return readExperience(
        selfGuid(conn),
        (guid) => conn.entityStore.get(guid),
        rt.combat.snapshot(),
      );
    },
    getRewardsState() {
      return labelRewards(rewards.snapshot(), (entry) => items.label(entry));
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
    useItem(bag, slot) {
      const inventory = () => rewards.snapshot().inventory;
      const override = () => {
        const fought = tactics.stopAndDefend("manual_override");
        cycle.stop("manual_override");
        if (fought) combat.interruptCast();
      };
      return useItem(
        { inventory, templates: items, combat, override },
        bag,
        slot,
      );
    },
    rollLoot(guid, slot, vote) {
      rt.override();
      rewards.rolls.roll(guid, slot, vote);
    },
    onRewardsEvent(cb) {
      return conn.events.rewards.subscribe(cb);
    },
    destroyItem(bag, slot, count) {
      rt.override();
      rt.destroy.destroy(bag, slot, count);
    },
    getDestroyState() {
      return rt.destroy.snapshot();
    },
    onDestroyEvent(cb) {
      return conn.events.destroy.subscribe(cb);
    },
  } satisfies Partial<WorldHandle>;
}

export function defenseMethods(conn: WorldConn, rt: Runtimes) {
  const { defense } = rt;
  return {
    armDefense(instruction) {
      defense.arm(instruction);
    },
    disarmDefense() {
      defense.disarm("command");
    },
    getDefenseState() {
      return defense.snapshot();
    },
    onDefenseEvent(cb) {
      return conn.events.defense.subscribe(cb);
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
    async startQuestCycle(questId, sources, instruction, maxStarts) {
      const { objective, defaultMaxStarts } = await questCycleObjective(
        conn,
        rt,
        questId,
        sources,
      );
      rt.override();
      await cycle.start({
        guids: [],
        instruction,
        maxStarts: maxStarts ?? defaultMaxStarts,
        objective,
      });
    },
    async resumeCycle(instruction, maxStarts) {
      rt.override();
      await cycle.resume({ instruction, maxStarts });
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

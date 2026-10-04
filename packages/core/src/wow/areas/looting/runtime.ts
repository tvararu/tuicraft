import type { AreaRuntime, AreaRuntimeCtx } from "#wow/areas/contract";
import {
  buildLootMasterGive,
  buildLootMethod,
  buildOptOutOfLoot,
  LOOT_METHOD_NAMES,
  LOOT_THRESHOLD_NAMES,
  LOWEST_LOOT_THRESHOLD,
  type LootMethodName,
  type LootThresholdName,
  lootErrorName,
  SELF_MASTER,
} from "#wow/areas/looting/protocol";
import type { LootingEvent, LootingStore } from "#wow/areas/looting/store";
import { GameOpcode } from "#wow/protocol/opcodes";

export type LootMethodChoice = {
  method: LootMethodName;
  threshold: LootThresholdName;
  master: string;
};

export const GIVE_MASTER_LOOT_ANSWER_MS = 5000;

export type MasterLootResult = { status: "given"; slot: number };

export type LootingActs = {
  setPassOnLoot: (pass: boolean) => void;
  setLootMethod: (choice: LootMethodChoice) => void;
  giveMasterLoot: (
    lootGuid: bigint,
    slot: number,
    name: string,
  ) => Promise<MasterLootResult>;
};

function waitForGive(
  ctx: AreaRuntimeCtx<LootingEvent>,
  lootGuid: bigint,
  slot: number,
  scope: AbortController,
): Promise<LootingEvent> {
  const wait = ctx.until(
    (event) =>
      (event.type === "loot_removed" && event.slot === slot) ||
      (event.type === "loot_error" && event.guid === lootGuid),
    { timeoutMs: GIVE_MASTER_LOOT_ANSWER_MS, signal: scope.signal },
  );
  wait.catch(() => undefined);
  return wait;
}

function settleGive(event: LootingEvent): MasterLootResult {
  if (event.type === "loot_error")
    throw new Error(lootErrorName(event.error), { cause: event.error });
  if (event.type !== "loot_removed") throw new Error("timeout");
  return { status: "given", slot: event.slot };
}

function sendGive(
  ctx: AreaRuntimeCtx<LootingEvent>,
  lootGuid: bigint,
  slot: number,
  target: bigint,
): void {
  ctx.send(
    GameOpcode.CMSG_LOOT_MASTER_GIVE,
    buildLootMasterGive(lootGuid, slot, target),
  );
}

async function runGive(
  ctx: AreaRuntimeCtx<LootingEvent>,
  lootGuid: bigint,
  slot: number,
  target: bigint,
): Promise<MasterLootResult> {
  const scope = new AbortController();
  const wait = waitForGive(ctx, lootGuid, slot, scope);
  try {
    sendGive(ctx, lootGuid, slot, target);
  } catch (error) {
    scope.abort();
    await Promise.resolve(wait).catch(() => undefined);
    throw error;
  }
  try {
    return settleGive(await wait);
  } catch (error) {
    if (error instanceof Error && error.message === "timeout")
      throw new Error(
        `timed out waiting for slot ${slot} after ${GIVE_MASTER_LOOT_ANSWER_MS}ms`,
        { cause: error },
      );
    throw error;
  }
}

export function lootingRuntime(
  ctx: AreaRuntimeCtx<LootingEvent>,
  store: LootingStore,
): AreaRuntime<LootingActs> {
  function setPassOnLoot(pass: boolean): void {
    ctx.send(GameOpcode.CMSG_OPT_OUT_OF_LOOT, buildOptOutOfLoot(pass));
    store.setPassOnLoot(pass);
  }
  function partyGuid(name: string, silent: boolean): bigint {
    const found = ctx.legacy.party().members.find((m) => m.name === name);
    if (!found) {
      if (silent) return 0n;
      throw new Error("not in your party");
    }
    return found.guid;
  }
  function masterGuid(name: string): bigint {
    if (name === "") return 0n;
    if (name === SELF_MASTER) return ctx.selfGuid();
    return partyGuid(name, false);
  }
  function candidateGuid(lootGuid: bigint, name: string): bigint {
    const target =
      name === SELF_MASTER ? ctx.selfGuid() : partyGuid(name, true);
    if (!store.candidatesFor(lootGuid).includes(target))
      throw new Error(`${name} is not a candidate`);
    return target;
  }
  function giveMasterLoot(
    lootGuid: bigint,
    slot: number,
    name: string,
  ): Promise<MasterLootResult> {
    return runGive(ctx, lootGuid, slot, candidateGuid(lootGuid, name));
  }
  function setLootMethod(choice: LootMethodChoice): void {
    const method = LOOT_METHOD_NAMES.indexOf(choice.method);
    if (method < 0) throw new Error(`unknown loot method: ${choice.method}`);
    const rank = LOOT_THRESHOLD_NAMES.indexOf(choice.threshold);
    if (rank < 0)
      throw new Error(`unknown loot threshold: ${choice.threshold}`);
    const master = masterGuid(choice.master);
    ctx.send(
      GameOpcode.CMSG_LOOT_METHOD,
      buildLootMethod(method, master, rank + LOWEST_LOOT_THRESHOLD),
    );
  }
  const off = ctx.listen("entity", (event) => {
    if (event.type === "disappear") store.forget(event.guid);
  });
  function dispose(): void {
    off();
  }
  return {
    act: { giveMasterLoot, setLootMethod, setPassOnLoot },
    dispose,
  };
}

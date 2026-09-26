import { describe, expect, test } from "bun:test";
import {
  dialog,
  packet,
  questId,
  setup,
  show,
} from "#test-support/quest-fixtures";
import type { InventoryChangeFailure } from "#wow/protocol/inventory";
import { GameOpcode } from "#wow/protocol/opcodes";

const full: InventoryChangeFailure = {
  kind: "error",
  result: 50,
  item1: 0n,
  item2: 0n,
  bagType: 0,
  detail: { kind: "none" },
};

describe("quest rewards refused by full bags", () => {
  test("the refusal becomes the quest's last error and survives the reoffer", () => {
    const { runtime, events } = setup();
    show(runtime, "offer");
    runtime.chooseReward(0);
    runtime.receiveInventoryFailure(full);
    expect(runtime.snapshot().lastError).toEqual({
      kind: "inventory",
      at: 1000,
      questId,
      reason: 50,
      name: "inventory_full",
    });
    expect(events.at(-1)).toMatchObject({ type: "error", questId });
    packet(runtime, GameOpcode.SMSG_QUESTGIVER_OFFER_REWARD, dialog("offer"));
    expect(runtime.snapshot()).toMatchObject({
      dialog: { kind: "offer" },
      pending: undefined,
      lastError: { name: "inventory_full" },
    });
    runtime.chooseReward(0);
    expect(runtime.snapshot().lastError).toBeUndefined();
  });

  test("an acceptance blocked by bags is recorded the same way", () => {
    const { runtime } = setup();
    show(runtime, "details");
    runtime.accept();
    runtime.receiveInventoryFailure({ ...full, result: 4 });
    expect(runtime.snapshot().lastError).toMatchObject({
      kind: "inventory",
      name: "bag_full",
    });
  });

  test("inventory errors from other actions are not quest errors", () => {
    const { runtime } = setup();
    runtime.receiveInventoryFailure(full);
    show(runtime, "offer");
    runtime.receiveInventoryFailure(full);
    runtime.receiveInventoryFailure({ kind: "ok", result: 0 });
    expect(runtime.snapshot().lastError).toBeUndefined();
  });
});

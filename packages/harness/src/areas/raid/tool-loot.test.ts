import { describe, expect, jest, test } from "bun:test";
import { elapse, withFakeTimers } from "@peon/core/test-support/fake-time";
import { groupSpec } from "#harness/areas/raid/tool";
import type { GroupAfter } from "#harness/areas/raid/tool-shared";
import { toolCtx } from "#test-support/ops-fixtures";
import { runTool } from "#test-support/tool-harness";
import {
  CORPSE,
  FANG,
  LINEN,
  LINEN_TWO,
  MASTER_LOOT,
  OPEN_MS,
  ROLL_GUID,
  ROUND_ROBIN,
  giveRoll as roll,
  SELF,
  TOM,
  world,
} from "#test-support/tool-loot-world";

describe("group tool give", () => {
  test("refuses out of a group, without master loot and as a non-master", async () => {
    const none = await world({ inGroup: false });
    expect(
      (await runTool(none.tool, { do: "give", what: "Linen" })).text,
    ).toContain("REFUSED not_in_group");
    const robin = await world({
      group: { loot: { master: 0n, method: ROUND_ROBIN, threshold: 2 } },
    });
    expect(
      (await runTool(robin.tool, { do: "give", what: "Linen" })).text,
    ).toContain("REFUSED no_master_loot");
    const other = await world({
      group: { loot: { master: TOM, method: MASTER_LOOT, threshold: 2 } },
    });
    expect(
      (await runTool(other.tool, { do: "give", what: "Linen" })).text,
    ).toContain("REFUSED not_master");
    for (const t of [none, robin, other]) {
      expect(t.give).not.toHaveBeenCalled();
      expect(t.handle.openLoot).not.toHaveBeenCalled();
    }
  });

  test("refuses without an item name or with a stranger", async () => {
    const t = await world();
    expect((await runTool(t.tool, { do: "give" })).text).toContain(
      "REFUSED needs_item",
    );
    expect(
      (await runTool(t.tool, { do: "give", to: "Zed", what: "Linen" })).text,
    ).toContain("REFUSED not_a_member");
    expect(t.give).not.toHaveBeenCalled();
  });

  test("opens the corpse, gives the named item to a member and releases", async () => {
    const t = await world();
    const out = await runTool(t.tool, {
      do: "give",
      target: "Springpaw Lynx",
      to: "Tom",
      what: "linen",
    });
    expect(out.text).toContain("DONE");
    expect(out.text).toContain("Linen Cloth");
    expect(out.text).toContain("Tom");
    expect(t.handle.openLoot).toHaveBeenCalledWith(CORPSE);
    expect(t.give).toHaveBeenCalledWith(CORPSE, 1, "Tom");
    expect(t.release).toHaveBeenCalledTimes(1);
  });

  test("gives to yourself when no member is named, on the nearest corpse", async () => {
    const t = await world();
    const out = await runTool(t.tool, { do: "give", what: "Broken Fang" });
    expect(out.text).toContain("DONE");
    expect(t.give).toHaveBeenCalledWith(CORPSE, 0, "@self");
  });

  test("gives to yourself when the caller names its own character", async () => {
    const t = await world();
    const out = await runTool(t.tool, {
      do: "give",
      to: "Testchar",
      what: "Broken Fang",
    });
    expect(out.text).toContain("DONE");
    expect(t.give).toHaveBeenCalledWith(CORPSE, 0, "@self");
  });

  test("takes the lowest slot among items with the same label", async () => {
    const t = await world({ items: [FANG, LINEN_TWO, LINEN] });
    await runTool(t.tool, { do: "give", to: "Tom", what: "Linen Cloth" });
    expect(t.give).toHaveBeenCalledWith(CORPSE, 1, "Tom");
  });

  test("matches an unnamed cached item by numeric id", async () => {
    const unnamed = { itemId: 27_668, name: undefined, slot: 0 };
    const t = await world({ items: [unnamed] });
    const out = await runTool(t.tool, { do: "give", to: "Tom", what: "27668" });
    expect(out.text).toContain("DONE");
    expect(t.give).toHaveBeenCalledWith(CORPSE, 0, "Tom");
  });

  test("matches an unnamed cached item by 'item <id>' label", async () => {
    const unnamed = { itemId: 27_668, name: undefined, slot: 0 };
    const t = await world({ items: [unnamed] });
    const out = await runTool(t.tool, {
      do: "give",
      to: "Tom",
      what: "item 27668",
    });
    expect(out.text).toContain("DONE");
    expect(t.give).toHaveBeenCalledWith(CORPSE, 0, "Tom");
  });

  test("matches a named item by its numeric id", async () => {
    const t = await world();
    const out = await runTool(t.tool, {
      do: "give",
      to: "Tom",
      what: String(LINEN.itemId),
    });
    expect(out.text).toContain("DONE");
    expect(t.give).toHaveBeenCalledWith(CORPSE, 1, "Tom");
  });

  test("does not match an id fragment of another item", async () => {
    const t = await world();
    const out = await runTool(t.tool, {
      do: "give",
      to: "Tom",
      what: "589",
    });
    expect(out.text).toContain("REFUSED not_offered");
    expect(t.give).not.toHaveBeenCalled();
  });

  test("refuses an item the corpse does not hold and releases the window", async () => {
    const t = await world();
    const out = await runTool(t.tool, {
      do: "give",
      to: "Tom",
      what: "Thunderfury",
    });
    expect(out.text).toContain("REFUSED not_offered");
    expect(out.text).toContain("Broken Fang");
    expect(t.give).not.toHaveBeenCalled();
    expect(t.release).toHaveBeenCalledTimes(1);
  });

  test("uses the resolved name when the template arrives after open", async () => {
    const unnamed = { itemId: 20_772, name: undefined, slot: 0 };
    const t = await world({ items: [unnamed] });
    jest
      .spyOn(t.handle, "getItemTemplate")
      .mockImplementation(async (entry: number) =>
        entry === 20_772 ? ({ name: "Springpaw Pelt" } as never) : undefined,
      );
    const out = await runTool(t.tool, {
      do: "give",
      to: "Tom",
      what: "item 20772",
    });
    expect(out.text).toContain("DONE");
    expect(out.text).toContain("gave Springpaw Pelt to Tom");
    expect(t.give).toHaveBeenCalledWith(CORPSE, 0, "Tom");
  });

  test("names an unnamed item the same way in every refusal", async () => {
    const unnamed = { itemId: 20_772, name: undefined, slot: 0 };
    const t = await world({ items: [unnamed] });
    const first = await runTool(t.tool, {
      do: "give",
      to: "Tom",
      what: "Thunderfury",
    });
    expect(first.text).toContain("REFUSED not_offered");
    expect(first.text).toContain("item 20772");
    const second = await runTool(t.tool, {
      do: "give",
      to: "Tom",
      what: "item 20772",
    });
    expect(second.text).toContain("DONE");
    expect(t.give).toHaveBeenCalledWith(CORPSE, 0, "Tom");
  });
  test("a cancel while the item template is pending gives nothing and releases", async () => {
    const unnamed = { itemId: 20_772, name: undefined, slot: 0 };
    const t = await world({ items: [unnamed], rolls: [] });
    let resolveTemplate!: (value: { name: string }) => void;
    const template = new Promise<{ name: string }>((resolve) => {
      resolveTemplate = resolve;
    });
    const templateOf = jest
      .spyOn(t.handle, "getItemTemplate")
      .mockReturnValue(template as never);
    const controller = new AbortController();
    const run = groupSpec.run(
      { do: "give", to: "Tom", what: "item 20772" },
      toolCtx<GroupAfter>(t, controller.signal),
    );
    for (
      let round = 0;
      round < 100 && templateOf.mock.calls.length === 0;
      round += 1
    )
      await Promise.resolve();
    controller.abort(new Error("cancelled"));
    resolveTemplate({ name: "Springpaw Pelt" });
    const outcome = await run.then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : "?"),
    );
    expect(outcome).toBe("cancelled");
    expect(t.give).not.toHaveBeenCalled();
    expect(t.release).toHaveBeenCalled();
  });
  test("refuses a member the server does not list as a candidate", async () => {
    const t = await world({ candidates: [SELF] });
    const out = await runTool(t.tool, { do: "give", to: "Tom", what: "Linen" });
    expect(out.text).toContain("REFUSED not_candidate");
    expect(t.give).not.toHaveBeenCalled();
    expect(t.release).toHaveBeenCalledTimes(1);
  });

  test("reports the loot error and still releases", async () => {
    const t = await world();
    t.give.mockRejectedValue(new Error("LOOT_ERROR_INV_FULL"));
    const out = await runTool(t.tool, { do: "give", to: "Tom", what: "Linen" });
    expect(out.text).toContain("FAILED");
    expect(out.text).toContain("LOOT_ERROR_INV_FULL");
    expect(t.release).toHaveBeenCalledTimes(1);
  });

  test("fails when the loot window never opens", async () => {
    const t = await world({ opens: false });
    const out = await withFakeTimers(async () => {
      const run = runTool(t.tool, { do: "give", to: "Tom", what: "Linen" });
      await elapse(OPEN_MS);
      return await run;
    });
    expect(out.text).toContain("FAILED");
    expect(t.give).not.toHaveBeenCalled();
  });

  test("refuses a corpse out of reach and names the walk", async () => {
    const t = await world({ corpseDistance: 40 });
    const out = await runTool(t.tool, { do: "give", to: "Tom", what: "Linen" });
    expect(out.text).toContain("REFUSED too_far");
    expect(t.handle.openLoot).not.toHaveBeenCalled();
  });
});

describe("group tool pass_loot", () => {
  test("sends the opt-out flag and says it is only requested", async () => {
    const t = await world();
    const on = await runTool(t.tool, { do: "pass_loot", what: "on" });
    expect(t.pass).toHaveBeenLastCalledWith(true);
    expect(on.text).toContain("requested");
    await runTool(t.tool, { do: "pass_loot", what: "off" });
    expect(t.pass).toHaveBeenLastCalledWith(false);
  });

  test("refuses another word and a missing group", async () => {
    const t = await world();
    expect(
      (await runTool(t.tool, { do: "pass_loot", what: "maybe" })).text,
    ).toContain("REFUSED bad_choice");
    const none = await world({ inGroup: false });
    expect(
      (await runTool(none.tool, { do: "pass_loot", what: "on" })).text,
    ).toContain("REFUSED not_in_group");
    expect(t.pass).not.toHaveBeenCalled();
    expect(none.pass).not.toHaveBeenCalled();
  });
});

describe("group tool roll", () => {
  test("answers the open roll", async () => {
    const t = await world({ rolls: [roll()] });
    const out = await runTool(t.tool, { do: "roll", what: "greed" });
    expect(out.text).toContain("DONE");
    expect(out.text).toContain("Linen Cloth");
    expect(t.rollLoot).toHaveBeenCalledWith(ROLL_GUID, 1, "greed");
  });

  test("refuses when no roll is open or the only roll is answered", async () => {
    const none = await world();
    expect(
      (await runTool(none.tool, { do: "roll", what: "need" })).text,
    ).toContain("REFUSED no_roll");
    const done = await world({ rolls: [roll({ choice: "pass" })] });
    expect(
      (await runTool(done.tool, { do: "roll", what: "need" })).text,
    ).toContain("REFUSED no_roll");
    expect(none.rollLoot).not.toHaveBeenCalled();
    expect(done.rollLoot).not.toHaveBeenCalled();
  });

  test("refuses a vote the roll does not allow", async () => {
    const t = await world({ rolls: [roll({ allowed: ["pass", "greed"] })] });
    const out = await runTool(t.tool, { do: "roll", what: "need" });
    expect(out.text).toContain("REFUSED roll_not_allowed");
    expect(out.text).toContain("greed");
    expect(t.rollLoot).not.toHaveBeenCalled();
  });

  test("refuses an unknown vote", async () => {
    const t = await world({ rolls: [roll()] });
    expect(
      (await runTool(t.tool, { do: "roll", what: "maybe" })).text,
    ).toContain("REFUSED bad_choice");
    expect(t.rollLoot).not.toHaveBeenCalled();
  });

  test("with two open rolls it asks which, and an item name picks one", async () => {
    const second = roll({
      guid: 0x31n,
      itemId: FANG.itemId,
      slot: 0,
    });
    const t = await world({ rolls: [roll(), second] });
    const ask = await runTool(t.tool, { do: "roll", what: "pass" });
    expect(ask.text).toContain("REFUSED ambiguous_roll");
    expect(t.rollLoot).not.toHaveBeenCalled();
    const picked = await runTool(t.tool, {
      do: "roll",
      what: "pass",
      with: String(FANG.itemId),
    });
    expect(picked.text).toContain("DONE");
    expect(t.rollLoot).toHaveBeenCalledWith(0x31n, 0, "pass");
  });

  test("matches by name with the loot window closed", async () => {
    const second = roll({
      guid: 0x31n,
      itemId: FANG.itemId,
      slot: 0,
    });
    const t = await world({ closedLoot: true, rolls: [roll(), second] });
    const picked = await runTool(t.tool, {
      do: "roll",
      what: "pass",
      with: "linen cloth",
    });
    expect(picked.text).toContain("DONE");
    expect(t.rollLoot).toHaveBeenCalledWith(ROLL_GUID, 1, "pass");
  });

  test("matches an item id label", async () => {
    const second = roll({
      guid: 0x31n,
      itemId: FANG.itemId,
      slot: 0,
    });
    const t = await world({ closedLoot: true, rolls: [roll(), second] });
    const picked = await runTool(t.tool, {
      do: "roll",
      what: "need",
      with: `item ${LINEN.itemId}`,
    });
    expect(picked.text).toContain("DONE");
    expect(t.rollLoot).toHaveBeenCalledWith(ROLL_GUID, 1, "need");
  });

  test("refuses an unmatched item name without rolling", async () => {
    const t = await world({ closedLoot: true, rolls: [roll()] });
    const out = await runTool(t.tool, {
      do: "roll",
      what: "need",
      with: "Mithril Ore",
    });
    expect(out.text).toContain("REFUSED no_roll");
    expect(t.rollLoot).not.toHaveBeenCalled();
  });

  test("reports a refused send as FAILED", async () => {
    const t = await world({ rolls: [roll()] });
    t.rollLoot.mockImplementation(() => {
      throw new Error("Loot roll was already answered");
    });
    const out = await runTool(t.tool, { do: "roll", what: "need" });
    expect(out.text).toContain("FAILED");
    expect(out.text).toContain("already answered");
  });
});

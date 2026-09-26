import { expect, test } from "bun:test";
import { authHandshake, worldSession } from "@tuicraft/core/session";
import { must } from "@tuicraft/core/test-support/must";
import { type Spot, standAt, waitUntil } from "#test-support/live-helpers";

const config1 = {
  account: Bun.env["WOW_ACCOUNT_1"] ?? "",
  character: Bun.env["WOW_CHARACTER_1"] ?? "",
  host: Bun.env["WOW_HOST"] ?? "t1",
  language: Number.parseInt(Bun.env["WOW_LANGUAGE"] ?? "1", 10),
  password: Bun.env["WOW_PASSWORD_1"] ?? "",
  port: Number.parseInt(Bun.env["WOW_PORT"] ?? "3724", 10),
};

const MARNIEL_AMBERLIGHT = 15_397;
const REFRESHING_SPRING_WATER = 159;
const BESIDE_MARNIEL: Spot = { map: 530, x: 8703.9, y: -6640.7, z: 72.75 };

test("vendor: buy water and sell it back, each confirmed by coinage", async () => {
  const handle = await worldSession(config1, await authHandshake(config1));
  const settled = (action: string) =>
    waitUntil(() => {
      const { lastOutcome, pending } = handle.getVendorState();
      return pending === undefined && lastOutcome?.action === action;
    });
  let restore: (() => Promise<void>) | undefined;
  try {
    handle.sendWhisper(config1.character, ".modify money 100");
    await waitUntil(() => (handle.getInventoryState().coinage ?? 0) >= 100);
    const excursion = await standAt(handle, config1.character, BESIDE_MARNIEL);
    restore = excursion.restore;
    await waitUntil(() =>
      handle.getNearbyEntities().some((e) => e.entry === MARNIEL_AMBERLIGHT),
    );
    await Bun.sleep(2000);
    const vendor = must(
      handle.getNearbyEntities().find((e) => e.entry === MARNIEL_AMBERLIGHT),
    );

    handle.openVendor(vendor.guid);
    await settled("list");
    const water = must(
      handle
        .getVendorState()
        .window?.items.find((g) => g.itemId === REFRESHING_SPRING_WATER),
    );

    handle.buyItem(water.slot);
    await settled("buy");
    const bought = must(handle.getVendorState().lastOutcome);
    expect(bought).toMatchObject({ status: "confirmed" });
    expect(must(bought.moneyDelta)).toBeLessThan(0);

    const stack = must(
      handle
        .getInventoryState()
        .slots.find(
          (s) =>
            s.status === "occupied" &&
            s.item.entry === REFRESHING_SPRING_WATER &&
            s.region !== "equipment",
        ),
    );
    handle.sellItem(stack.bag, stack.slot);
    await settled("sell");
    const sold = must(handle.getVendorState().lastOutcome);
    expect(sold).toMatchObject({ status: "confirmed" });
    expect(must(sold.moneyDelta)).toBeGreaterThan(0);
  } finally {
    await restore?.();
    handle.close();
    await handle.closed;
  }
}, 60_000);

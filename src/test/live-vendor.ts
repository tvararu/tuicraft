import { expect, test } from "bun:test";
import { parseGps, waitUntil } from "test/live-helpers";
import { must } from "test/must";
import { authHandshake } from "wow/auth";
import { type ChatMessage, worldSession } from "wow/client";

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
const BESIDE_MARNIEL = ".go xyz 8703.9 -6640.7 72.75 530";

test("vendor: buy water and sell it back, each confirmed by coinage", async () => {
  const handle = await worldSession(config1, await authHandshake(config1));
  const chat: ChatMessage[] = [];
  handle.onMessage((m) => chat.push(m));
  handle.sendWhisper(config1.character, ".gps");
  await Bun.sleep(2500);
  const home = must(parseGps(chat));
  const settled = (action: string) =>
    waitUntil(() => {
      const { lastOutcome, pending } = handle.getVendorState();
      return pending === undefined && lastOutcome?.action === action;
    });
  try {
    handle.sendWhisper(config1.character, ".modify money 100");
    await waitUntil(() => (handle.getInventoryState().coinage ?? 0) >= 100);
    handle.sendWhisper(config1.character, BESIDE_MARNIEL);
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
    handle.sendWhisper(
      config1.character,
      `.go xyz ${home.x} ${home.y} ${home.z} ${home.map}`,
    );
    await Bun.sleep(2500);
    handle.close();
    await handle.closed;
  }
}, 60_000);

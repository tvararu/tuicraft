import { describe, expect, jest, test } from "bun:test";
import { dispatchCommand, type EventEntry } from "daemon/commands";
import { type IpcCommand, parseIpcCommand } from "daemon/parse";
import { RingBuffer } from "lib/ring-buffer";
import { attachControl, createMockSocket } from "test/commands-fixtures";
import { createMockHandle } from "test/mock-handle";
import type { NamedVendorState } from "wow";

async function run(command: IpcCommand, handle = createMockHandle()) {
  const socket = createMockSocket();
  await dispatchCommand(command, {
    cleanup: jest.fn(),
    events: new RingBuffer<EventEntry>(10),
    handle: attachControl(handle),
    socket,
  });
  return socket.written();
}

const VENDOR = 0xf130_003c_2500_09afn;
const sold: NamedVendorState = {
  coinage: 50_001,
  disposed: false,
  lastOutcome: {
    action: "sell",
    coinageAfter: 50_001,
    moneyDelta: 1,
    observedAt: 2000,
    reason: undefined,
    request: {
      action: "sell",
      bag: 255,
      coinageBefore: 50_000,
      count: 1,
      guid: VENDOR,
      itemGuid: 5n,
      itemId: 20_891,
      requestedAt: 1000,
      slot: 24,
      stackBefore: 1,
    },
    status: "confirmed",
  },
  pending: undefined,
  window: {
    emptyReason: undefined,
    guid: VENDOR,
    invalidatedReason: undefined,
    items: [
      {
        buyCount: 5,
        displayId: 18_084,
        extendedCost: 0,
        itemId: 159,
        maxDurability: 0,
        name: "Refreshing Spring Water",
        price: 23,
        quality: 1,
        slot: 2,
        stock: null,
      },
    ],
    openedAt: 900,
  },
};

describe("vendor IPC boundary", () => {
  test("parses vendor verbs with their operand ranges", () => {
    expect(parseIpcCommand("OPEN_VENDOR 0xf130003c250009af")).toEqual({
      guid: VENDOR,
      type: "open_vendor",
    });
    expect(parseIpcCommand("SELL 255 24")).toEqual({
      bag: 255,
      slot: 24,
      type: "sell",
    });
    expect(parseIpcCommand("SELL 19 3 2")).toEqual({
      bag: 19,
      count: 2,
      slot: 3,
      type: "sell",
    });
    expect(parseIpcCommand("BUY 2")).toEqual({
      count: 1,
      slot: 2,
      type: "buy",
    });
    expect(parseIpcCommand("BUY 2 5")).toEqual({
      count: 5,
      slot: 2,
      type: "buy",
    });
    expect(parseIpcCommand("REPAIR")).toEqual({ type: "repair" });
    expect(parseIpcCommand("VENDOR_JSON")).toEqual({ type: "vendor_json" });
    for (const line of [
      "OPEN_VENDOR 0",
      "SELL 255",
      "SELL 256 1",
      "SELL 255 1 0",
      "SELL 255 1 2 3",
      "BUY 0",
      "BUY 2 256",
      "BUY",
      "REPAIR all",
    ])
      expect(parseIpcCommand(line)?.type).toBe("invalid");
  });

  test("a local refusal is an error, not an acknowledgement", async () => {
    const handle = Object.assign(createMockHandle(), {
      repairAll: () => {
        throw new Error("Vendor does not repair");
      },
    });
    expect(await run({ type: "repair" }, handle)).toBe(
      "ERR Vendor does not repair\n\n",
    );
  });

  test("the text inspection names goods and the confirmed money change", async () => {
    const handle = Object.assign(createMockHandle(), {
      getVendorState: () => sold,
    });
    expect((await run({ type: "vendor" }, handle)).split("\n")).toEqual([
      "Vendor: 0xf130003c250009af, 1 goods",
      "Slot 2: item 159 Refreshing Spring Water x5 for 23 copper (stock unlimited)",
      "Last: sell item 20891 x1 from bag 255 slot 24: confirmed, +1 copper (coinage 50000 -> 50001)",
      "Carried coinage: 50001",
      "",
      "",
    ]);
  });

  test("the text inspection counts purchases and quotes the discounted range", async () => {
    const bought: NamedVendorState = {
      ...sold,
      coinage: 49_929,
      lastOutcome: {
        action: "buy",
        coinageAfter: 49_929,
        moneyDelta: -71,
        observedAt: 2000,
        reason: undefined,
        request: {
          action: "buy",
          answer: undefined,
          coinageBefore: 50_000,
          count: 3,
          guid: VENDOR,
          itemId: 159,
          maxPrice: 71,
          minPrice: 69,
          requestedAt: 1000,
          slot: 2,
        },
        status: "confirmed",
      },
    };
    const handle = Object.assign(createMockHandle(), {
      getVendorState: () => bought,
    });
    expect((await run({ type: "vendor" }, handle)).split("\n")[2]).toBe(
      "Last: buy 3 purchases of item 159 from slot 2 for 69-71 copper: confirmed, -71 copper (coinage 50000 -> 49929)",
    );
  });

  test("the JSON inspection keeps GUIDs as hex and unlimited stock as null", async () => {
    const handle = Object.assign(createMockHandle(), {
      getVendorState: () => sold,
    });
    const state = JSON.parse(await run({ type: "vendor_json" }, handle));
    expect(state.window.guid).toBe("0xf130003c250009af");
    expect(state.window.items[0].stock).toBeNull();
    expect(state.lastOutcome.request.itemGuid).toBe("0x5");
    expect(state.lastOutcome.moneyDelta).toBe(1);
  });
});

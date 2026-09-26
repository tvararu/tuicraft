import type { WorldHandle } from "#wow/client";
import type { ItemLabel } from "#wow/item-labels";
import type { VendorGood } from "#wow/protocol/vendor";
import type { Runtimes } from "#wow/runtime";
import type { VendorState, VendorWindow } from "#wow/vendor";
import type { WorldConn } from "#wow/world-conn";

export type NamedVendorGood = VendorGood & ItemLabel;
export type NamedVendorState = Omit<VendorState, "window"> & {
  window:
    | (Omit<VendorWindow, "items"> & { items: NamedVendorGood[] })
    | undefined;
};

export function vendorMethods(conn: WorldConn, rt: Runtimes) {
  const { vendor } = rt;
  return {
    getVendorState(): NamedVendorState {
      const state = vendor.snapshot();
      const { window } = state;
      if (!window) return { ...state, window };
      const items = window.items.map((good) => ({
        ...good,
        ...rt.items.label(good.itemId),
      }));
      return { ...state, window: { ...window, items } };
    },
    openVendor(guid) {
      rt.override();
      vendor.list(guid);
    },
    sellItem(bag, slot, count) {
      rt.override();
      vendor.sell(bag, slot, count);
    },
    buyItem(slot, count) {
      rt.override();
      vendor.buy(slot, count);
    },
    repairAll() {
      rt.override();
      vendor.repair();
    },
    onVendorEvent(cb) {
      return conn.events.vendor.subscribe(cb);
    },
  } satisfies Partial<WorldHandle>;
}

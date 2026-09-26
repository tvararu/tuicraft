import { bounded } from "lib/abort";
import type { CombatRuntime } from "wow/combat";
import type { InventoryState } from "wow/inventory";
import {
  buildItemQuery,
  type ItemQueryResponse,
  ItemSpellTrigger,
  type ItemTemplate,
} from "wow/protocol/item";
import { GameOpcode } from "wow/protocol/opcodes";

const QUERY_TIMEOUT_MS = 5000;

type TemplateDeps = {
  send: (opcode: number, body?: Uint8Array) => void;
  timeoutMs?: number;
};

export class ItemTemplates {
  private readonly deps: TemplateDeps;
  private readonly known = new Map<number, ItemTemplate | undefined>();
  private readonly waiting = new Map<
    number,
    PromiseWithResolvers<ItemTemplate | undefined>
  >();
  private readonly lifetime = new AbortController();

  constructor(deps: TemplateDeps) {
    this.deps = deps;
  }

  async lookup(entry: number): Promise<ItemTemplate | undefined> {
    if (this.known.has(entry)) return this.known.get(entry);
    let query = this.waiting.get(entry);
    if (!query) {
      query = Promise.withResolvers();
      this.waiting.set(entry, query);
      this.deps.send(GameOpcode.CMSG_ITEM_QUERY_SINGLE, buildItemQuery(entry));
    }
    const timeoutMs = this.deps.timeoutMs ?? QUERY_TIMEOUT_MS;
    try {
      return await bounded(
        query.promise,
        this.lifetime.signal,
        timeoutMs,
        "item_query_timeout",
      );
    } catch (error) {
      if (this.waiting.get(entry) === query) this.waiting.delete(entry);
      throw error;
    }
  }

  receive(response: ItemQueryResponse): void {
    this.known.set(response.entry, response.template);
    this.waiting.get(response.entry)?.resolve(response.template);
    this.waiting.delete(response.entry);
  }

  dispose(): void {
    this.lifetime.abort();
    this.waiting.clear();
  }
}

type UseDeps = {
  inventory: () => InventoryState;
  templates: Pick<ItemTemplates, "lookup">;
  combat: Pick<CombatRuntime, "useItem">;
  override: () => void;
};

export async function useItem(
  deps: UseDeps,
  bag: number,
  slot: number,
): Promise<void> {
  const occupied = occupiedSlot(deps.inventory(), bag, slot);
  const entry = occupied.item.entry;
  if (entry === undefined) throw new Error("item_entry_unobserved");
  const template = await deps.templates.lookup(entry);
  if (!template) throw new Error("unknown_item");
  const spell = template.spells.find(
    (candidate) => candidate.trigger === ItemSpellTrigger.ON_USE,
  );
  if (!spell) throw new Error("no_use_spell");
  if (occupiedSlot(deps.inventory(), bag, slot).guid !== occupied.guid)
    throw new Error("slot_changed");
  deps.override();
  deps.combat.useItem(spell.id, { entry, bag, slot, guid: occupied.guid });
}

function occupiedSlot(inventory: InventoryState, bag: number, slot: number) {
  const found = inventory.slots.find(
    (candidate) => candidate.bag === bag && candidate.slot === slot,
  );
  if (!found) throw new Error("unknown_slot");
  if (found.status === "unknown") throw new Error("slot_unobserved");
  if (found.status === "empty") throw new Error("empty_slot");
  return found;
}

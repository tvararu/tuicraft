import { formatGuid } from "ui/format";
import type {
  NamedVendorGood,
  NamedVendorState,
  VendorOutcome,
  VendorRequest,
} from "wow";

function describeGood(good: NamedVendorGood): string {
  const name = good.name === null ? "" : ` ${good.name}`;
  const stock = good.stock === null ? "unlimited" : String(good.stock);
  const cost = good.extendedCost ? `, extended cost ${good.extendedCost}` : "";
  return `Slot ${good.slot}: item ${good.itemId}${name} x${good.buyCount} for ${good.price} copper (stock ${stock}${cost})`;
}

function describeRequest(request: VendorRequest): string {
  switch (request.action) {
    case "list":
      return `list ${formatGuid(request.guid)}`;
    case "sell":
      return `sell item ${request.itemId ?? "unknown"} x${request.count} from bag ${request.bag} slot ${request.slot}`;
    case "buy":
      return `buy ${request.count} ${request.count === 1 ? "purchase" : "purchases"} of item ${request.itemId} from slot ${request.slot} for ${request.price} copper`;
    case "repair":
      return `repair ${request.damaged.length} damaged items`;
    default:
      return "unknown";
  }
}

function describeOutcome(outcome: VendorOutcome): string {
  const reason = outcome.reason ? ` ${outcome.reason}` : "";
  const before = outcome.request.coinageBefore ?? "unknown";
  const after = outcome.coinageAfter ?? "unknown";
  const delta = outcome.moneyDelta ?? 0;
  const money = `${delta >= 0 ? "+" : ""}${delta} copper (coinage ${before} -> ${after})`;
  return `Last: ${describeRequest(outcome.request)}: ${outcome.status}${reason}, ${money}`;
}

export function formatVendorState(state: NamedVendorState): string[] {
  const { window, pending, lastOutcome } = state;
  const lines: string[] = [];
  if (window) {
    const invalid = window.invalidatedReason
      ? ` (${window.invalidatedReason})`
      : "";
    lines.push(
      `Vendor: ${formatGuid(window.guid)}, ${window.items.length} goods${invalid}`,
    );
    if (window.emptyReason !== undefined)
      lines.push(`Vendor has no inventory (reason ${window.emptyReason})`);
    lines.push(...window.items.map(describeGood));
  } else lines.push("Vendor: none listed");
  if (pending) lines.push(`Request: ${describeRequest(pending)} unanswered`);
  if (lastOutcome) lines.push(describeOutcome(lastOutcome));
  lines.push(`Carried coinage: ${state.coinage ?? "unknown"}`);
  return lines;
}

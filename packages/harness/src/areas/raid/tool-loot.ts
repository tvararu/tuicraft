import type { RewardsEvent, RollVote } from "@peon/core";
import { ROLL_VOTES } from "@peon/core";
import { needGroup, resolveMember } from "#harness/areas/raid/tool-settle";
import {
  emptyGroup,
  type GroupAfter,
  type GroupArgs,
  type GroupCtx,
  type RaidGroup,
  sameName,
} from "#harness/areas/raid/tool-shared";
import type { ToolResult } from "#harness/contract/result";
import type { UnitView } from "#harness/contract/views";
import { LOOT_APPROACH_YD, LOOT_WALK_MAX_YD } from "#harness/ops/range";
import { Refusal } from "#harness/ops/refusal";
import { resolveUnit, unitRefusal } from "#harness/ops/resolve";
import { settle } from "#harness/ops/settle";
import { travelLeg } from "#harness/ops/travel-leg";
import { reachNext } from "#harness/ops/unreached";
import { unitViews } from "#harness/ops/views";
import { result } from "#harness/tools/define";
import { nextCall } from "#harness/tools/next-call";

const OPEN_MS = 5000;
const MASTER_METHOD = 2;
const SELF_MASTER = "@self";

const LOOK_LOOTABLE = nextCall("look", { find: "lootable" });

type NamedLoot = ReturnType<GroupCtx["handle"]["getRewardsState"]>["loot"];
type NamedOpen = NamedLoot & { phase: "open" };
type OpenRoll = ReturnType<
  GroupCtx["handle"]["getRewardsState"]
>["rolls"]["pending"][number];

function refuse(
  reason: string,
  detail: string,
  next = "end your turn.",
): never {
  throw new Refusal({ detail, next, reason });
}

function masterLoot(group: RaidGroup, ctx: GroupCtx): void {
  const loot = group.loot;
  if (loot === undefined || loot.method !== MASTER_METHOD || loot.master === 0n)
    refuse("no_master_loot", "the group does not run master loot.");
  if (loot.master !== ctx.handle.getControlState().selfGuid)
    refuse("not_master", "only the master looter gives items.");
}

function recipient(ctx: GroupCtx, to: string | undefined): string {
  const named = to?.trim() ?? "";
  if (named === "" || sameName(named, ctx.rt.profile.character))
    return SELF_MASTER;
  return resolveMember(ctx.handle.getPartyState().members, named).name;
}

function reachRefusal(unit: UnitView): never {
  refuse(
    "too_far",
    `${unit.name} is ${Math.round(unit.distance ?? 0)} yd away; walk within ${LOOT_WALK_MAX_YD} yd first.`,
    nextCall("travel", { to: unit.ref }),
  );
}

function nearestCorpse(ctx: GroupCtx): { guid: bigint; unit: UnitView } {
  const unit = unitViews(ctx).find((seen) => seen.lootable && !seen.alive);
  const guid = unit ? ctx.rt.refs.guidOf(unit.ref) : undefined;
  if (unit === undefined || guid === undefined)
    refuse("no_corpse", "no lootable corpse in sight.", LOOK_LOOTABLE);
  if ((unit.distance ?? Number.POSITIVE_INFINITY) > LOOT_WALK_MAX_YD)
    reachRefusal(unit);
  return { guid, unit };
}

function namedCorpse(
  ctx: GroupCtx,
  target: string,
): { guid: bigint; unit: UnitView } {
  const resolved = resolveUnit(ctx, { alive: false, text: target });
  if (resolved.kind !== "unit")
    throw unitRefusal({ param: "target", resolved, tool: "group" });
  if (!resolved.unit.lootable)
    refuse(
      "not_lootable",
      `${resolved.unit.name} has nothing for you (no lootable flag).`,
      LOOK_LOOTABLE,
    );
  if ((resolved.unit.distance ?? 0) > LOOT_WALK_MAX_YD)
    reachRefusal(resolved.unit);
  return { guid: resolved.guid, unit: resolved.unit };
}

async function approach(
  ctx: GroupCtx,
  guid: bigint,
  name: string,
): Promise<void> {
  const seen = unitViews(ctx).find(
    (unit) => ctx.rt.refs.guidOf(unit.ref) === guid,
  );
  const distance = seen?.distance ?? 0;
  if (distance <= LOOT_APPROACH_YD) return;
  const leg = await travelLeg(ctx, {
    goal: { guid, kind: "unit", name },
    within: LOOT_APPROACH_YD,
  });
  if (leg.status !== "arrived" || !seen)
    throw new Refusal({
      detail: `could not reach ${name}: ${leg.detail}.`,
      next: seen ? reachNext(leg, seen) : nextCall("look"),
      reason: leg.reason ?? leg.status,
      status: "FAILED",
    });
}

function opened(loot: NamedLoot): NamedOpen | undefined {
  if (loot.phase !== "open") return undefined;
  return loot as NamedOpen;
}

async function openCorpse(ctx: GroupCtx, guid: bigint): Promise<NamedOpen> {
  const here = opened(ctx.handle.getRewardsState().loot);
  if (here && here.guid === guid) return here;
  const settled = await settle<RewardsEvent>({
    match: (event) => {
      if (event.type === "loot_error" || event.type === "loot_open_failed")
        return true;
      return event.type === "loot_opened";
    },
    send: () => ctx.rt.mutex.run(() => ctx.handle.openLoot(guid)),
    signal: ctx.signal,
    subscribe: (cb) => ctx.handle.onRewardsEvent(cb),
    timeoutMs: OPEN_MS,
  });
  const window = settled ? opened(settled.state.loot as NamedLoot) : undefined;
  if (!window || window.guid !== guid)
    throw new Refusal({
      detail: "the corpse loot never opened.",
      next: LOOK_LOOTABLE,
      reason: "loot_closed",
      status: "FAILED",
    });
  return window;
}

async function nameOf(
  ctx: GroupCtx,
  item: NamedOpen["items"][number],
): Promise<string> {
  if (item.name) return item.name;
  const template = await ctx.handle
    .getItemTemplate(item.itemId)
    .catch(() => undefined);
  return template?.name ?? `item ${item.itemId}`;
}

function itemMatches(
  item: NamedOpen["items"][number],
  wanted: string,
): { exact: boolean } | undefined {
  const name = item.name?.toLowerCase();
  const id = String(item.itemId);
  if (name === wanted || id === wanted || `item ${id}` === wanted)
    return { exact: true };
  if (wanted !== "" && (name?.includes(wanted) ?? false))
    return { exact: false };
  return undefined;
}

async function itemSlot(
  ctx: GroupCtx,
  window: NamedOpen,
  what: string,
): Promise<{ label: string; slot: number }> {
  const wanted = what.trim().toLowerCase();
  const labeled = await Promise.all(
    window.items.map(async (item) => ({
      item,
      label: await nameOf(ctx, item),
    })),
  );
  const hits = labeled.flatMap(({ item, label }) => {
    const hit = itemMatches({ ...item, name: label }, wanted);
    return hit ? [{ exact: hit.exact, slot: item.slot }] : [];
  });
  const exact = hits
    .filter((hit) => hit.exact)
    .map((hit) => hit.slot)
    .sort((a, b) => a - b);
  const partial = hits
    .filter((hit) => !hit.exact)
    .map((hit) => hit.slot)
    .sort((a, b) => a - b);
  const slot = exact[0] ?? partial[0];
  if (slot === undefined)
    refuse(
      "not_offered",
      `the corpse holds no ${what.trim()}. It holds: ${labeled.map(({ label }) => label).join(", ") || "nothing"}.`,
    );
  const named = labeled.find(({ item }) => item.slot === slot);
  return { label: named ? named.label : "item 0", slot };
}

function candidateOf(ctx: GroupCtx, name: string): bigint {
  const selfGuid = ctx.handle.getControlState().selfGuid;
  if (name === SELF_MASTER) return selfGuid;
  if (sameName(name, ctx.rt.profile.character)) return selfGuid;
  return (
    ctx.handle
      .getPartyState()
      .members.find((member) => sameName(member.name, name))?.guid ?? 0n
  );
}

function needCandidate(ctx: GroupCtx, guid: bigint, name: string): void {
  const held = ctx.handle.looting.state().masterCandidates.get(guid) ?? [];
  if (!held.includes(candidateOf(ctx, name)))
    refuse(
      "not_candidate",
      `${name} is not a master loot candidate for this corpse.`,
    );
}

function lootAfter(
  doing: GroupAfter["do"],
  to: string | undefined,
): GroupAfter {
  return { ...emptyGroup(), confirmed: false, do: doing, to };
}

export async function giveTool(
  args: GroupArgs,
  ctx: GroupCtx,
): Promise<ToolResult<GroupAfter>> {
  const { group } = needGroup(ctx);
  const what = args.what?.trim() ?? "";
  if (!what) refuse("needs_item", "name the item to give with what.");
  const to = recipient(ctx, args.to);
  masterLoot(group, ctx);
  const corpse =
    args.target === undefined
      ? nearestCorpse(ctx)
      : namedCorpse(ctx, args.target);
  if ((corpse.unit.distance ?? 0) > LOOT_APPROACH_YD)
    await approach(ctx, corpse.guid, corpse.unit.name);
  const window = await openCorpse(ctx, corpse.guid);
  let found: { label: string; slot: number };
  try {
    found = await itemSlot(ctx, window, what);
  } catch (error) {
    await releaseCorpse(ctx);
    throw error;
  }
  const { label, slot } = found;
  try {
    needCandidate(ctx, corpse.guid, to);
  } catch (error) {
    await releaseCorpse(ctx);
    throw error;
  }
  try {
    await ctx.handle.looting.act.giveMasterLoot(corpse.guid, slot, to);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return result("FAILED", {
      after: lootAfter("give", to),
      detail: `giving ${label} to ${to} failed: ${detail}.`,
      next: LOOK_LOOTABLE,
      reason: "give_failed",
    });
  } finally {
    await releaseCorpse(ctx);
  }
  return result("DONE", {
    after: { ...lootAfter("give", to), confirmed: true },
    detail: `gave ${label} to ${to}.`,
  });
}

export function passTool(
  args: GroupArgs,
  ctx: GroupCtx,
): Promise<ToolResult<GroupAfter>> {
  needGroup(ctx);
  const choice = args.what?.trim().toLowerCase();
  if (choice !== "on" && choice !== "off")
    refuse("bad_choice", "pass_loot takes on or off.");
  ctx.handle.looting.act.setPassOnLoot(choice === "on");
  return Promise.resolve(
    result("DONE", {
      after: lootAfter("pass_loot", undefined),
      detail: `passing on loot ${choice} is requested; the server sends no reply.`,
    }),
  );
}

function rollChoice(what: string | undefined): RollVote {
  const choice = what?.trim().toLowerCase();
  if (
    choice === undefined ||
    !(ROLL_VOTES as readonly string[]).includes(choice)
  )
    refuse("bad_choice", "roll takes need, greed or pass.");
  return choice as RollVote;
}
function pendingRolls(ctx: GroupCtx): OpenRoll[] {
  return ctx.handle
    .getRewardsState()
    .rolls.pending.filter((roll) => roll.choice === undefined);
}

async function releaseCorpse(ctx: GroupCtx): Promise<void> {
  await ctx.rt.mutex.run(() => ctx.handle.releaseLoot());
}

function rollMatches(
  ctx: GroupCtx,
  open: NamedOpen | undefined,
  roll: OpenRoll,
  wanted: string,
): boolean {
  const id = String(roll.itemId);
  if (id === wanted || `item ${id}` === wanted) return true;
  if (
    open?.items.find((item) => item.slot === roll.slot)?.name?.toLowerCase() ===
    wanted
  )
    return true;
  return ctx.handle.itemLabel(roll.itemId).name?.toLowerCase() === wanted;
}

function namedRoll(
  ctx: GroupCtx,
  rolls: readonly OpenRoll[],
  named: string,
): OpenRoll {
  const wanted = named.trim().toLowerCase();
  const open = opened(ctx.handle.getRewardsState().loot);
  const hit = rolls.find((roll) => rollMatches(ctx, open, roll, wanted));
  if (!hit)
    refuse("no_roll", `no open roll matches ${named}.`, nextCall("look"));
  return hit as OpenRoll;
}

function onlyPending(pending: readonly OpenRoll[]): OpenRoll {
  if (pending.length > 1)
    refuse(
      "ambiguous_roll",
      `two rolls are open (${pending.map((roll) => `item ${roll.itemId} slot ${roll.slot}`).join("; ")}). Name one with the item name.`,
    );
  const only = pending[0];
  if (!only)
    refuse("no_roll", "no group roll is open right now.", nextCall("look"));
  return only;
}

export async function rollTool(
  args: GroupArgs,
  ctx: GroupCtx,
): Promise<ToolResult<GroupAfter>> {
  needGroup(ctx);
  const choice = rollChoice(args.what);
  const pending = pendingRolls(ctx);
  if (pending.length === 0)
    refuse("no_roll", "no group roll is open right now.", nextCall("look"));
  const with_ = args.with?.trim() ?? "";
  const picked =
    with_ === "" ? onlyPending(pending) : namedRoll(ctx, pending, with_);
  if (!picked.allowed.includes(choice))
    refuse(
      "roll_not_allowed",
      `this roll allows ${picked.allowed.join(", ")}, not ${choice}.`,
    );
  let rollFailure: string | undefined;
  try {
    await ctx.rt.mutex.run(() =>
      ctx.handle.rollLoot(picked.guid, picked.slot, choice),
    );
  } catch (error) {
    rollFailure = error instanceof Error ? error.message : String(error);
  }
  if (rollFailure !== undefined)
    throw new Refusal({
      detail: `the roll failed: ${rollFailure}.`,
      next: "end your turn.",
      reason: "roll_failed",
      status: "FAILED",
    });
  return result("DONE", {
    after: lootAfter("roll", undefined),
    detail: `rolled ${choice} on ${(() => {
      const open = opened(ctx.handle.getRewardsState().loot);
      return (
        open?.items.find((item) => item.slot === picked.slot)?.name ??
        `item ${picked.itemId}`
      );
    })()}.`,
  });
}

import {
  type ObjectRow,
  objectLine,
  objectRows,
  objectUnit,
} from "#harness/areas/objects/reads";
import { unitThreat } from "#harness/areas/threat/reads";
import type { LookAfter, LookFilter } from "#harness/contract/details";
import type { ToolResult } from "#harness/contract/result";
import type { HarnessRuntime, ToolCtx } from "#harness/contract/services";
import type { NowSnapshot, UnitView } from "#harness/contract/views";
import { dangerView, nameOf } from "#harness/ops/danger";
import { compassWord, exploreSummary } from "#harness/ops/explore";
import { LOOK_DEFAULT_YD } from "#harness/ops/range";
import { guidHex } from "#harness/ops/refs";
import { Refusal } from "#harness/ops/refusal";
import { nowSnapshot } from "#harness/ops/views";
import {
  defineGameTool,
  emptyPlace,
  emptySelf,
  result,
} from "#harness/tools/define";
import { findUnits, kindOf, rememberedRows } from "#harness/tools/look-find";
import { movementWords, withMovement } from "#harness/tools/look-movement";
import {
  headerLine,
  moreLine,
  nearestLine,
  nounOf,
  rowLine,
} from "#harness/tools/look-rows";
import { savesLine } from "#harness/tools/look-saves";
import {
  castViews,
  selfLine,
  statusLine,
  talentView,
} from "#harness/tools/look-self";
import { nextCall } from "#harness/tools/next-call";
import {
  type LookArgs,
  lookParams,
  prepareLookArgs,
} from "#harness/tools/params-look";
import { lookRenderers } from "#harness/ui/renderers/picture";

type Unchanged = { at: number; count: number; digest: string };

const UNCHANGED_AFTER = 3;
const UNCHANGED_WINDOW_MS = 60_000;
const unchangedLooks = new WeakMap<HarnessRuntime, Unchanged>();

function emptyLook(): LookAfter {
  return {
    danger: { attackers: [], hpPct: 100 },
    filter: "any",
    matched: 0,
    more: [],
    name: undefined,
    nearest: {},
    place: emptyPlace(),
    remembered: [],
    rows: [],
    run: undefined,
    seen: 0,
    self: emptySelf(),
    target: undefined,
    unchanged: 0,
    within: undefined,
  };
}

function lookSaves(ctx: ToolCtx<LookAfter>): string[] {
  try {
    return savesLine(
      ctx.handle.instances.state(),
      ctx.handle.lfg.state(),
      ctx.rt.clock.now(),
      ctx.handle.getPartyState(),
    );
  } catch {
    return [];
  }
}

function lookBody(
  ctx: ToolCtx<LookAfter>,
  after: LookAfter,
  objects: readonly ObjectRow[] = [],
): string[] {
  const calm =
    after.danger.attackers.length === 0 ? ["No unit is attacking you."] : [];
  const stale =
    after.unchanged >= UNCHANGED_AFTER && !after.run
      ? [
          `Nothing changed in ${after.unchanged} looks. Act, or end your turn to wait for events.`,
        ]
      : [];
  const lines =
    objects.length > 0
      ? [statusLine(after), ...objects.map(objectLine), nearestLine(after)]
      : [
          statusLine(after),
          headerLine(after),
          ...after.rows.map((unit) => rowLine(unit, after.self.level)),
          ...moreLine(after),
          ...after.remembered.map((unit) => rowLine(unit, after.self.level)),
          nearestLine(after),
        ];
  return [...lines, ...lookSaves(ctx), ...calm, ...stale];
}

function lookDigest(rows: readonly UnitView[], snapshot: NowSnapshot): string {
  const pose = snapshot.self.pose;
  const where = pose
    ? `${Math.floor(pose.x / 2)}:${Math.floor(pose.y / 2)}`
    : "-";
  const units = rows
    .map(
      (unit) =>
        `${unit.ref}:${unit.hpPct}:${Math.round(unit.distance ?? -1)}:${movementWords(unit.movement).join("+")}`,
    )
    .join(",");
  return `${snapshot.self.hp}|${where}|${units}`;
}

function countUnchanged(rt: HarnessRuntime, digest: string): number {
  const now = rt.clock.now();
  const last = unchangedLooks.get(rt);
  const next =
    last && last.digest === digest && now - last.at <= UNCHANGED_WINDOW_MS
      ? { ...last, count: last.count + 1 }
      : { at: now, count: 1, digest };
  unchangedLooks.set(rt, next);
  return next.count;
}

function withThreat(
  ctx: ToolCtx<LookAfter>,
  rows: readonly UnitView[],
): UnitView[] {
  const state = ctx.handle.threat.state();
  const self = ctx.handle.getControlState().selfGuid;
  const units = new Map(state.tables.map(({ unit }) => [guidHex(unit), unit]));
  const named = (guid: bigint) =>
    `${nameOf(ctx, guid)} ${ctx.rt.refs.refOf(guid)}`;
  return rows.map((row) => {
    const unit = units.get(row.guid);
    const threat = unit && unitThreat(state, unit, self, named);
    return threat ? { ...row, ...threat } : row;
  });
}

function objectAfter(
  args: LookArgs,
  ctx: ToolCtx<LookAfter>,
  snapshot: NowSnapshot,
): { after: LookAfter; objects: ObjectRow[] } {
  const rows = objectRows(ctx)
    .filter((row) =>
      args.name
        ? row.name.toLowerCase().includes(args.name.toLowerCase())
        : true,
    )
    .filter(
      (row) =>
        row.distance === undefined ||
        row.distance <= (args.within ?? LOOK_DEFAULT_YD),
    );
  const near = rows.map(objectUnit);
  const digest = near
    .map((row) => `${row.ref}:${Math.round(row.distance ?? -1)}`)
    .join(",");
  return {
    after: {
      ...castViews(ctx, snapshot.target),
      ...talentView(ctx),
      danger: dangerView(ctx),
      filter: "any",
      matched: 0,
      more: [],
      name: args.name,
      nearest: snapshot.nearest,
      place: snapshot.place,
      remembered: [],
      rows: near,
      run: snapshot.run,
      seen: 0,
      self: snapshot.self,
      target: snapshot.target,
      unchanged: countUnchanged(ctx.rt, `objects|${digest}`),
      within: args.within,
    },
    objects: rows,
  };
}

function lookAfter(
  args: LookArgs,
  ctx: ToolCtx<LookAfter>,
  snapshot: NowSnapshot,
): LookAfter {
  const found = findUnits(args, ctx);
  const rows = withMovement(
    withThreat(ctx, found.rows),
    ctx.handle.unitmotion.state(),
  );
  return {
    ...castViews(ctx, snapshot.target),
    ...talentView(ctx),
    danger: dangerView(ctx),
    filter: found.filter,
    matched: found.matched,
    more: found.more,
    name: args.name,
    nearest: snapshot.nearest,
    place: snapshot.place,
    remembered: rememberedRows(ctx, { filter: found.filter, name: args.name }),
    rows,
    run: snapshot.run,
    seen: found.seen,
    self: snapshot.self,
    target: snapshot.target,
    unchanged: countUnchanged(ctx.rt, lookDigest(rows, snapshot)),
    within: args.within,
  };
}

const KILLABLE: readonly LookFilter[] = ["hostile", "attackable"];

function exploreHint(ctx: ToolCtx<LookAfter>, filter: LookFilter): string[] {
  const summary = exploreSummary(ctx);
  const to = summary?.next ? `explore ${compassWord(summary.next)}` : "explore";
  const walk = nextCall("travel", { to });
  const hint = KILLABLE.includes(filter)
    ? `If your task needs one: ${nextCall("engage")} explores for one and fights it, or ${walk} looks first.`
    : `If your task needs one: ${walk}.`;
  if (!summary || summary.tried.length === 0) return [hint];
  return [
    `You explored ${summary.tried.join(", ")} up to ${summary.farthestYd} yd from here.`,
    hint,
  ];
}

function noneSeen(
  ctx: ToolCtx<LookAfter>,
  after: LookAfter,
): ToolResult<LookAfter> {
  const detail = `0 ${nounOf(after.filter)} seen at any distance in the last 30 min. The client sees about 100 yd around you.`;
  return result("DONE", {
    after,
    body: exploreHint(ctx, after.filter),
    detail,
  });
}

function look(args: LookArgs, ctx: ToolCtx<LookAfter>): ToolResult<LookAfter> {
  const snapshot = nowSnapshot(ctx.rt);
  if (!snapshot)
    throw new Refusal({
      detail: "the world is still loading.",
      next: "call look again in a few seconds.",
      reason: "not_ready",
    });
  if (args.find === "object") {
    const { after, objects } = objectAfter(args, ctx, snapshot);
    ctx.rt.snapshots.capture("look", args.within);
    if (objects.length === 0)
      return result("DONE", {
        after,
        body: [
          statusLine(after),
          `No objects within ${after.within ?? LOOK_DEFAULT_YD} yd.`,
          nearestLine(after),
          ...(after.danger.attackers.length === 0
            ? ["No unit is attacking you."]
            : []),
        ],
        detail: selfLine(after),
      });
    return result("DONE", {
      after,
      body: lookBody(ctx, after, objects),
      detail: selfLine(after),
    });
  }
  const after = lookAfter(args, ctx, snapshot);
  ctx.rt.snapshots.capture("look", args.within);
  const own = kindOf(after.filter);
  if (after.matched === 0 && own && !after.nearest[own])
    return noneSeen(ctx, after);
  return result("DONE", {
    after,
    body: lookBody(ctx, after),
    detail: selfLine(after),
  });
}

export const lookTool = defineGameTool({
  fallback: emptyLook,
  kind: "read",
  maxLines: 24,
  minimalArgs: {},
  name: "look",
  parameters: lookParams,
  prepareArguments: prepareLookArgs,
  renderers: lookRenderers,
  run: (args, ctx) => Promise.resolve(look(args, ctx)),
  text: {
    description:
      "Shows your health, place, target and running action, and the nearest units, each with a short id like u7. It does not move you or act. Use it to start a task and to answer questions about the world.",
    guidelines: [
      "Use find to filter. The Nearest line includes units out of view.",
      "Use within to list every unit near you, for example within: 30.",
      "Fighting you means the unit has you on its threat list; aggro names who it attacks now; your threat is your share of its top threat.",
    ],
    label: "Look",
  },
});

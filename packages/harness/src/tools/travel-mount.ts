import type { SpellDefinition } from "@peon/core";
import type { TravelAfter } from "#harness/contract/details";
import type { ToolResult } from "#harness/contract/result";
import type { ToolCtx } from "#harness/contract/services";
import { distanceTo } from "#harness/ops/range";
import { poseView } from "#harness/ops/views";
import { nextCall } from "#harness/tools/next-call";
import type { Goal } from "#harness/tools/travel-report";

export const MOUNT_HINT_YD = 100;

const APPLY_AURA_EFFECT = 6;
const MOUNTED_AURA = 78;
const FLIGHT_SPEED_AURA = 207;

const OPEN_WORLD_MAPS: readonly number[] = [0, 1, 530, 571];

function isGroundMount(definition: SpellDefinition): boolean {
  const auras = definition.effects
    .filter((effect) => effect.effect === APPLY_AURA_EFFECT)
    .map((effect) => effect.applyAura);
  return auras.includes(MOUNTED_AURA) && !auras.includes(FLIGHT_SPEED_AURA);
}

function mountSpeed(definition: SpellDefinition): number {
  const points = definition.effects
    .filter(
      (effect) =>
        effect.effect === APPLY_AURA_EFFECT && effect.applyAura === 32,
    )
    .map((effect) => effect.basePoints);
  return points.length > 0 ? Math.max(...points) : 0;
}

async function bestGroundMount(
  ctx: ToolCtx<TravelAfter>,
): Promise<SpellDefinition | undefined> {
  const book = await ctx.handle.getSpellbook();
  const learned = new Set(ctx.handle.getCombatState().learned);
  const ranks = book
    .filter((spell) => isGroundMount(spell) && learned.has(spell.id))
    .sort((a, b) => mountSpeed(b) - mountSpeed(a));
  return ranks.at(0);
}

function distanceOf(ctx: ToolCtx<TravelAfter>, goal: Goal): number | undefined {
  if (goal.kind === "unit") return distanceTo(ctx, goal.guid);
  if (goal.kind !== "point") return undefined;
  const pose = poseView(ctx);
  if (!pose) return undefined;
  return Math.hypot(pose.x - goal.x, pose.y - goal.y);
}

export async function mountHint(
  ctx: ToolCtx<TravelAfter>,
  goal: Goal,
): Promise<string | undefined> {
  if (ctx.handle.selfstate.state().mounted) return undefined;
  const pose = poseView(ctx);
  if (!(pose && OPEN_WORLD_MAPS.includes(pose.mapId))) return undefined;
  const distance = distanceOf(ctx, goal);
  if (distance === undefined || distance <= MOUNT_HINT_YD) return undefined;
  const spell = await bestGroundMount(ctx);
  if (!spell) return undefined;
  return `a ground mount is ready: ${nextCall("spell", { do: "mount", spell: spell.name })}.`;
}
export function withMountHint(
  report: ToolResult<TravelAfter>,
  hint: string | undefined,
): ToolResult<TravelAfter> {
  if (hint === undefined) return report;
  return { ...report, body: [hint, ...report.body] };
}

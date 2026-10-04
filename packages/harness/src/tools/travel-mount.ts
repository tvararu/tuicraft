import type { DbcSource, SpellDefinition } from "@peon/core";
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
const ONLY_OUTDOORS = 0x80_00;
const UINT32 = 2 ** 32;

const OPEN_WORLD_MAPS: readonly number[] = [0, 1, 530, 571];

const AREA_FILE = "AreaTable.dbc";
const AREA_FIELDS = 36;
const AREA_RECORD_BYTES = 144;
const AREA_HEADER_BYTES = 20;
const AREA_FLAGS_COLUMN = 4;
const AREA_FLAG_INSIDE = 0x02_00_00_00;
const AREA_FLAG_OUTSIDE = 0x04_00_00_00;

function flagged(value: number, mask: number): boolean {
  const unsigned = value < 0 ? value + UINT32 : value;
  return Math.floor(unsigned / mask) % 2 === 1;
}

function isGroundMount(definition: SpellDefinition): boolean {
  if (!flagged(definition.attributes.raw, ONLY_OUTDOORS)) return false;
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
  if (!(await areaOutdoors(ctx))) return undefined;
  const spell = await bestGroundMount(ctx);
  if (!spell) return undefined;
  return `a ground mount is ready: ${nextCall("spell", { do: "mount", spell: spell.name })}.`;
}

async function areaOutdoors(ctx: ToolCtx<TravelAfter>): Promise<boolean> {
  const areaId = ctx.handle.getPlaceState().areaId;
  if (areaId === undefined) return true;
  const source = ctx.rt.profile.client.dbc;
  if (!source) return true;
  const flags = await areaFlags(source, areaId).catch(() => undefined);
  if (flags === undefined) return true;
  return !flagged(flags, AREA_FLAG_INSIDE) || flagged(flags, AREA_FLAG_OUTSIDE);
}

async function areaFlags(
  source: DbcSource,
  areaId: number,
): Promise<number | undefined> {
  const bytes = await source(AREA_FILE);
  if (bytes.byteLength < AREA_HEADER_BYTES) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(8, true) !== AREA_FIELDS ||
    view.getUint32(12, true) !== AREA_RECORD_BYTES
  )
    return undefined;
  const count = view.getUint32(4, true);
  for (let row = 0; row < count; row++) {
    const base = AREA_HEADER_BYTES + row * AREA_RECORD_BYTES;
    if (base + AREA_RECORD_BYTES > bytes.byteLength) return undefined;
    if (view.getInt32(base, true) !== areaId) continue;
    return view.getUint32(base + AREA_FLAGS_COLUMN * 4, true);
  }
  return undefined;
}

export function withMountHint(
  report: ToolResult<TravelAfter>,
  hint: string | undefined,
): ToolResult<TravelAfter> {
  if (hint === undefined) return report;
  return { ...report, body: [hint, ...report.body] };
}

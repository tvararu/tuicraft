import type { LookAfter, LookFilter } from "#harness/contract/details";
import type { NearestKind, QuestMark, UnitView } from "#harness/contract/views";
import { grayLevel } from "#harness/loops/combat-actions-credit";
import { LOOK_DEFAULT_YD } from "#harness/ops/range";
import { LEVEL_CAP_ABOVE } from "#harness/tools/engage-choose";
import { kindOf } from "#harness/tools/look-find";
import { movementWords } from "#harness/tools/look-movement";
import { MORE_NAMES } from "#harness/tools/look-rank";
import { nextCall } from "#harness/tools/next-call";

const ALWAYS_NEAREST: readonly NearestKind[] = [
  "hostile",
  "lootable",
  "trainer",
];

export function ageText(ms: number): string {
  return ms < 60_000
    ? `${Math.round(ms / 1000)} s`
    : `${Math.round(ms / 60_000)} min`;
}

function distanceText({ compass, distance }: UnitView): string {
  if (distance === undefined) return "distance unknown";
  const yards = Math.round(distance);
  return yards > 0 && compass ? `${yards} yd ${compass}` : `${yards} yd`;
}

export function nounOf(filter: LookFilter): string {
  return filter === "any" ? "units" : `${filter.replace("_", " ")} units`;
}

export function headerLine({
  filter,
  matched,
  more,
  rows,
  within,
}: LookAfter): string {
  const range = within ?? LOOK_DEFAULT_YD;
  if (rows.length === 0) return `No ${nounOf(filter)} within ${range} yd.`;
  const order = more.length > 0 ? "most relevant first" : "nearest first";
  return `${rows.length} of ${matched} ${nounOf(filter)} within ${range} yd, ${order}:`;
}

export function grayLine({ filter, rows, self }: LookAfter): string[] {
  if (rows.length === 0) return [];
  if (filter !== "any" && filter !== "hostile" && filter !== "attackable")
    return [];
  const seen = rows.filter((unit) => unit.inView);
  const hostiles = seen.filter(
    (unit) => unit.relation === "hostile" && unit.kind === "creature",
  );
  if (hostiles.length === 0) return [];
  const gray = grayLevel(self.level);
  if (hostiles.some((unit) => unit.level > gray)) return [];
  return [
    `All ${hostiles.length === 1 ? "hostile" : "hostiles"} in view are gray and give no XP. Fight L${gray + 1}-${self.level + LEVEL_CAP_ABOVE} instead; ${nextCall("travel", { to: "explore" })} walks outward looking for one.`,
  ];
}

export function moreLine({ more, within }: LookAfter): string[] {
  if (more.length === 0) return [];
  const named = more
    .slice(0, MORE_NAMES)
    .map((unit) => `${unit.ref} ${unit.name} ${distanceText(unit)}`)
    .join(", ");
  return [
    `${more.length} more: ${named}. Use ${nextCall("look", { within: within ?? LOOK_DEFAULT_YD })} to list all.`,
  ];
}

function lastSeenText(unit: UnitView, then: readonly string[]): string {
  const was = then.length > 0 ? `, then ${then.join(", ")}` : "";
  return `last seen ${distanceText(unit)} ${ageText(unit.seenAgoMs)} ago${was} (not in view)`;
}

const QUEST_WORDS: Record<QuestMark, string> = {
  available: "quest available",
  available_low: "low-level quest",
  available_repeatable: "repeatable quest",
  incomplete: "quest in progress",
  reward: "quest to turn in",
};

function grayMark(selfLevel: number, unit: UnitView): string | undefined {
  return unit.kind === "creature" &&
    unit.relation === "hostile" &&
    unit.level <= grayLevel(selfLevel)
    ? "gray (no XP)"
    : undefined;
}

export function rowLine(unit: UnitView, selfLevel: number): string {
  const volatile = [
    unit.alive ? undefined : "dead",
    unit.lootable ? "lootable" : undefined,
    ...movementWords(unit.movement),
    unit.attackingMe ? "attacking you" : undefined,
    unit.targetsMe && !unit.attackingMe ? "targets you" : undefined,
    unit.fightingMe ? "fighting you" : undefined,
    unit.aggro === undefined ? undefined : `aggro on ${unit.aggro}`,
    unit.myThreatPct === undefined
      ? undefined
      : `your threat ${unit.myThreatPct}%`,
    unit.tappedByOther ? "tapped by another player" : undefined,
  ].filter((trait) => trait !== undefined);
  const traits = [
    unit.kind === "player" ? "player" : undefined,
    unit.relation,
    unit.roles.length > 0 ? unit.roles.join(" ") : undefined,
    unit.questMark === undefined ? undefined : QUEST_WORDS[unit.questMark],
    ...(unit.inView
      ? [...volatile, distanceText(unit)]
      : [lastSeenText(unit, volatile)]),
    grayMark(selfLevel, unit),
  ];
  return `- ${unit.ref} ${unit.name} L${unit.level} ${traits.filter((trait) => trait !== undefined).join(", ")}`;
}

function nearestText(
  kind: NearestKind,
  unit: UnitView | undefined,
  selfLevel: number,
): string {
  const label = `Nearest ${kind.replace("_", " ")}:`;
  if (!unit) return `${label} ${kind === "lootable" ? "none" : "none seen"}.`;
  const life = unit.alive ? "alive" : "dead";
  const gray =
    kind === "hostile" && grayMark(selfLevel, unit) !== undefined
      ? ", gray (no XP)"
      : "";
  if (!unit.inView)
    return `${label} ${unit.ref} ${unit.name} L${unit.level}, last seen ${distanceText(unit)} ${ageText(unit.seenAgoMs)} ago, then ${life}${gray}.`;
  return `${label} ${unit.ref} ${unit.name} L${unit.level} ${life}${gray}, ${distanceText(unit)} (seen now).`;
}

export function nearestLine({ filter, nearest, self }: LookAfter): string {
  const own = kindOf(filter);
  const kinds =
    own && !ALWAYS_NEAREST.includes(own)
      ? [...ALWAYS_NEAREST, own]
      : ALWAYS_NEAREST;
  return kinds
    .map((kind) => nearestText(kind, nearest[kind], self.level))
    .join(" ");
}

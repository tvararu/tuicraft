export type FramingVariant = "none" | "minimal" | "mechanics";

export const FRAMING_VARIANTS = ["none", "minimal", "mechanics"] as const;

export function isFramingVariant(value: unknown): value is FramingVariant {
  return (
    typeof value === "string" &&
    FRAMING_VARIANTS.includes(value as FramingVariant)
  );
}

export function parseFramingVariant(value: string | undefined): FramingVariant {
  if (value === undefined || value === "") return "none";
  if (isFramingVariant(value)) return value;
  throw new Error(
    `Unknown framing variant: "${value}". Must be one of: ${FRAMING_VARIANTS.join(", ")}`,
  );
}

export function buildFraming(
  variant: FramingVariant,
  observation: Readonly<Record<string, unknown>>,
  characterClass = "Priest",
): string | undefined {
  if (variant === "none") return undefined;
  const rawSelf = observation["self"];
  const self =
    typeof rawSelf === "object" && rawSelf !== null
      ? (rawSelf as Record<string, unknown>)
      : undefined;
  const rawLevel = self?.["level"];
  const level = typeof rawLevel === "number" ? rawLevel : undefined;
  const levelPart =
    level !== undefined
      ? `a level ${level} ${characterClass}`
      : `a ${characterClass}`;
  const minimal = `In World of Warcraft 3.3.5a, you are ${levelPart} fighting a hostile creature.`;
  if (variant === "minimal") return minimal;
  return `${minimal} The resource pool does not refill during the fight. Some actions apply effects over time. Some actions take time and can be disrupted.`;
}

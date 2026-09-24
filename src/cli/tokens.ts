import { messageOf } from "lib/errors";
import type { MovementDirection } from "wow/control";
import type { WalkTarget } from "wow/client";
import { parseFramingVariant, type FramingVariant } from "wow/framing";
import { DEFAULT_FIGHT_INSTRUCTION } from "wow/tactics";

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const MAX_GUID = 0xffff_ffff_ffff_ffffn;
const MAX_UINT32 = 0xffff_ffff;
const DEFAULT_MOVE_MS = 1000;
const MAX_MOVE_MS = 10_000;
const MAX_WALK_YARDS = 20;
const DIRECTIONS: readonly string[] = ["forward", "backward", "left", "right"];
const CYCLE_FLAGS = ["--max", "--instruction"];

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(reason: string): Parsed<T> => ({ ok: false, reason });

export function tokenize(rest: string): string[] {
  return rest.split(/\s+/).filter(Boolean);
}

export function parseGuid(raw: string): bigint | undefined {
  if (!/^(0[xX][0-9a-fA-F]+|[0-9]+)$/.test(raw)) return undefined;
  const guid = BigInt(raw);
  return guid <= MAX_GUID ? guid : undefined;
}

export function parseUnsigned(
  raw: string,
  min: number,
  max: number,
): number | undefined {
  if (!/^[0-9]+$/.test(raw)) return undefined;
  const value = Number(raw);
  return value >= min && value <= max ? value : undefined;
}

export function parseFiniteNumber(raw: string): number | undefined {
  const value = Number(raw);
  return raw.trim() !== "" && Number.isFinite(value) ? value : undefined;
}

function isDirection(raw: string): raw is MovementDirection {
  return DIRECTIONS.includes(raw);
}

export function parseBare(
  tokens: string[],
  name: string,
): Parsed<Record<string, never>> {
  return tokens.length === 0 ? ok({}) : fail(`invalid ${name}`);
}

export function parseGuidArg(
  tokens: string[],
  nonzero = false,
): Parsed<{ guid: bigint }> {
  const guid = tokens.length === 1 ? parseGuid(tokens[0]!) : undefined;
  if (guid === undefined || (nonzero && guid === 0n))
    return fail("invalid guid");
  return ok({ guid });
}

export function parseBoundedArg(
  tokens: string[],
  min: number,
  max: number,
  reason: string,
): Parsed<number> {
  const value =
    tokens.length === 1 ? parseUnsigned(tokens[0]!, min, max) : undefined;
  return value === undefined ? fail(reason) : ok(value);
}

export function parseQuestId(tokens: string[]): Parsed<{ questId: number }> {
  const parsed = parseBoundedArg(tokens, 1, MAX_UINT32, "invalid quest id");
  return parsed.ok ? ok({ questId: parsed.value }) : parsed;
}

export function parseMove(
  tokens: string[],
): Parsed<{ direction: MovementDirection; durationMs: number }> {
  if (tokens.length < 1 || tokens.length > 2) return fail("invalid move");
  const direction = tokens[0]!.toLowerCase();
  if (!isDirection(direction)) return fail("invalid direction");
  const raw = tokens[1];
  const durationMs =
    raw === undefined ? DEFAULT_MOVE_MS : parseUnsigned(raw, 1, MAX_MOVE_MS);
  if (durationMs === undefined) return fail("invalid duration");
  return ok({ direction, durationMs });
}

export function parseFace(tokens: string[]): Parsed<{ orientation: number }> {
  const orientation =
    tokens.length === 1 ? parseFiniteNumber(tokens[0]!) : undefined;
  return orientation === undefined
    ? fail("invalid facing")
    : ok({ orientation });
}

export function parsePoint(
  tokens: string[],
): { x: number; y: number; z: number } | undefined {
  if (tokens.length !== 3) return undefined;
  const [x, y, z] = tokens.map(parseFiniteNumber);
  if (x === undefined || y === undefined || z === undefined) return undefined;
  return { x, y, z };
}

export function parseGoto(
  tokens: string[],
): Parsed<{ x: number; y: number; z: number }> {
  const point = parsePoint(tokens);
  return point ? ok(point) : fail("invalid goto");
}

export function parseWalkToward(
  tokens: string[],
): Parsed<{ yards: number; target: WalkTarget }> {
  const yards = parseFiniteNumber(tokens[0] ?? "");
  if (yards === undefined || yards <= 0 || yards > MAX_WALK_YARDS)
    return fail("invalid walk distance");
  const rest = tokens.slice(1);
  if (rest.length === 1) {
    const guid = parseGuidArg(rest, true);
    if (!guid.ok) return guid;
    return ok({ yards, target: { kind: "guid", guid: guid.value.guid } });
  }
  const point = parsePoint(rest);
  if (!point) return fail("invalid walk target");
  return ok({ yards, target: { kind: "point", ...point } });
}

export function parseCast(
  tokens: string[],
): Parsed<{ spellId: number; guid: bigint }> {
  if (tokens.length !== 2) return fail("invalid cast");
  const spellId = parseUnsigned(tokens[0]!, 1, MAX_UINT32);
  if (spellId === undefined) return fail("invalid spell");
  const guid = parseGuid(tokens[1]!);
  if (guid === undefined) return fail("invalid guid");
  return ok({ spellId, guid });
}

export function parseResurrect(tokens: string[]): Parsed<{ accept: boolean }> {
  const decision = tokens.length === 1 ? tokens[0] : undefined;
  if (decision !== "accept" && decision !== "decline")
    return fail("invalid resurrect");
  return ok({ accept: decision === "accept" });
}

export function parseOptionId(raw: string | undefined): number | undefined {
  return raw === undefined ? undefined : parseUnsigned(raw, 0, MAX_UINT32);
}

function oneLine(instruction: string): Parsed<string> {
  return /[\r\n]/.test(instruction)
    ? fail("instruction must not contain line breaks")
    : ok(instruction || DEFAULT_FIGHT_INSTRUCTION);
}

function parseFraming(raw: string | undefined): Parsed<FramingVariant> {
  if (!raw) return fail("missing framing variant");
  try {
    return ok(parseFramingVariant(raw));
  } catch (error) {
    return fail(messageOf(error, "invalid framing"));
  }
}

export type FightArgs = {
  guid: bigint;
  instruction: string;
  framing?: FramingVariant;
};

export function parseFight(tokens: string[]): Parsed<FightArgs> {
  let framing: FramingVariant | undefined;
  const words: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const inline = token.startsWith("--framing=");
    if (token !== "--framing" && !inline) {
      words.push(token);
      continue;
    }
    const parsed = parseFraming(
      inline ? token.slice("--framing=".length) : tokens[++i],
    );
    if (!parsed.ok) return parsed;
    framing = parsed.value;
  }
  const guid = parseGuid(words[0] ?? "");
  if (guid === undefined)
    return fail(words.length ? "invalid guid" : "invalid fight");
  const instruction = oneLine(words.slice(1).join(" "));
  if (!instruction.ok) return instruction;
  return ok({ guid, instruction: instruction.value, framing });
}

export type CycleArgs = {
  guids: bigint[];
  instruction: string;
  maxStarts?: number;
};

function isCycleFlag(token: string): boolean {
  return CYCLE_FLAGS.some(
    (flag) => token === flag || token.startsWith(`${flag}=`),
  );
}

function parseCycleMax(raw: string | undefined): number | undefined {
  return raw === undefined
    ? undefined
    : parseUnsigned(raw, 1, Number.MAX_SAFE_INTEGER);
}

export function parseCycle(tokens: string[]): Parsed<CycleArgs> {
  let maxStarts: number | undefined;
  let words: string[] = [];
  const guids: bigint[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "--max" || token.startsWith("--max=")) {
      const raw =
        token === "--max" ? tokens[++i] : token.slice("--max=".length);
      maxStarts = parseCycleMax(raw);
      if (maxStarts === undefined) return fail("invalid cycle max");
    } else if (token.startsWith("--instruction=")) {
      words = [token.slice("--instruction=".length)];
    } else if (token === "--instruction") {
      words = [];
      while (i + 1 < tokens.length && !isCycleFlag(tokens[i + 1]!))
        words.push(tokens[++i]!);
    } else {
      const guid = parseGuid(token);
      if (guid === undefined || guid === 0n) return fail("invalid guid");
      guids.push(guid);
    }
  }
  if (guids.length === 0) return fail("invalid cycle");
  const instruction = oneLine(words.join(" "));
  if (!instruction.ok) return instruction;
  return ok({ guids, instruction: instruction.value, maxStarts });
}

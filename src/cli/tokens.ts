import { messageOf } from "lib/errors";
import {
  DEFAULT_FIGHT_INSTRUCTION,
  type FramingVariant,
  type MovementDirection,
  parseFramingVariant,
  type WalkTarget,
} from "wow";

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const MAX_GUID = 0xffff_ffff_ffff_ffffn;
const MAX_UINT32 = 0xff_ff_ff_ff;
const DEFAULT_MOVE_MS = 1000;
const MAX_MOVE_MS = 10_000;
const MAX_WALK_YARDS = 20;
const DIRECTIONS: readonly string[] = ["forward", "backward", "left", "right"];
const CYCLE_FLAGS = ["--max", "--instruction", "--resume"];
const WHITESPACE = /\s+/;
const GUID_PATTERN = /^(0[xX][0-9a-fA-F]+|[0-9]+)$/;
const DIGITS = /^[0-9]+$/;
const LINE_BREAK = /[\r\n]/;

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(reason: string): Parsed<T> => ({ ok: false, reason });

export function tokenize(rest: string): string[] {
  return rest.split(WHITESPACE).filter(Boolean);
}

function parseGuid(raw: string): bigint | undefined {
  if (!GUID_PATTERN.test(raw)) return undefined;
  const guid = BigInt(raw);
  return guid <= MAX_GUID ? guid : undefined;
}

export function parseUnsigned(
  raw: string,
  min: number,
  max: number,
): number | undefined {
  if (!DIGITS.test(raw)) return undefined;
  const value = Number(raw);
  return value >= min && value <= max ? value : undefined;
}

function parseFiniteNumber(raw: string): number | undefined {
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
  const [raw] = tokens;
  const guid =
    tokens.length === 1 && raw !== undefined ? parseGuid(raw) : undefined;
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
  const [raw] = tokens;
  const value =
    tokens.length === 1 && raw !== undefined
      ? parseUnsigned(raw, min, max)
      : undefined;
  return value === undefined ? fail(reason) : ok(value);
}

export function parseQuestId(tokens: string[]): Parsed<{ questId: number }> {
  const parsed = parseBoundedArg(tokens, 1, MAX_UINT32, "invalid quest id");
  return parsed.ok ? ok({ questId: parsed.value }) : parsed;
}

export function parseMove(
  tokens: string[],
): Parsed<{ direction: MovementDirection; durationMs: number }> {
  const [first] = tokens;
  if (first === undefined || tokens.length > 2) return fail("invalid move");
  const direction = first.toLowerCase();
  if (!isDirection(direction)) return fail("invalid direction");
  const raw = tokens[1];
  const durationMs =
    raw === undefined ? DEFAULT_MOVE_MS : parseUnsigned(raw, 1, MAX_MOVE_MS);
  if (durationMs === undefined) return fail("invalid duration");
  return ok({ direction, durationMs });
}

export function parseFace(tokens: string[]): Parsed<{ orientation: number }> {
  const [raw] = tokens;
  const orientation =
    tokens.length === 1 && raw !== undefined
      ? parseFiniteNumber(raw)
      : undefined;
  return orientation === undefined
    ? fail("invalid facing")
    : ok({ orientation });
}

function parsePoint(
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
    return ok({ target: { guid: guid.value.guid, kind: "guid" }, yards });
  }
  const point = parsePoint(rest);
  if (!point) return fail("invalid walk target");
  return ok({ target: { kind: "point", ...point }, yards });
}

export function parseCast(
  tokens: string[],
): Parsed<{ spellId: number; guid: bigint }> {
  const [rawSpell, rawGuid] = tokens;
  if (tokens.length !== 2 || rawSpell === undefined || rawGuid === undefined)
    return fail("invalid cast");
  const spellId = parseUnsigned(rawSpell, 1, MAX_UINT32);
  if (spellId === undefined) return fail("invalid spell");
  const guid = parseGuid(rawGuid);
  if (guid === undefined) return fail("invalid guid");
  return ok({ guid, spellId });
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
  return LINE_BREAK.test(instruction)
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
  const queue = [...tokens];
  for (let token = queue.shift(); token !== undefined; token = queue.shift()) {
    const inline = token.startsWith("--framing=");
    if (token !== "--framing" && !inline) {
      words.push(token);
      continue;
    }
    const parsed = parseFraming(
      inline ? token.slice("--framing=".length) : queue.shift(),
    );
    if (!parsed.ok) return parsed;
    framing = parsed.value;
  }
  const guid = parseGuid(words[0] ?? "");
  if (guid === undefined)
    return fail(words.length > 0 ? "invalid guid" : "invalid fight");
  const instruction = oneLine(words.slice(1).join(" "));
  if (!instruction.ok) return instruction;
  return ok({ framing, guid, instruction: instruction.value });
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

type CycleDraft = {
  guids: bigint[];
  maxStarts?: number;
  resume: boolean;
  words: string[];
};

function takeInstructionWords(queue: string[]): string[] {
  const words: string[] = [];
  for (
    let next = queue[0];
    next !== undefined && !isCycleFlag(next);
    next = queue[0]
  ) {
    words.push(next);
    queue.shift();
  }
  return words;
}

function readCycleToken(
  token: string,
  queue: string[],
  draft: CycleDraft,
): string | null {
  if (token === "--resume") {
    draft.resume = true;
    return null;
  }
  if (token === "--max" || token.startsWith("--max=")) {
    const raw =
      token === "--max" ? queue.shift() : token.slice("--max=".length);
    draft.maxStarts = parseCycleMax(raw);
    return draft.maxStarts === undefined ? "invalid cycle max" : null;
  }
  if (token.startsWith("--instruction=")) {
    draft.words = [token.slice("--instruction=".length)];
    return null;
  }
  if (token === "--instruction") {
    draft.words = takeInstructionWords(queue);
    return null;
  }
  const guid = parseGuid(token);
  if (guid === undefined || guid === 0n) return "invalid guid";
  draft.guids.push(guid);
  return null;
}

function readCycleDraft(tokens: string[]): Parsed<CycleDraft> {
  const draft: CycleDraft = { guids: [], resume: false, words: [] };
  const queue = [...tokens];
  for (let token = queue.shift(); token !== undefined; token = queue.shift()) {
    const reason = readCycleToken(token, queue, draft);
    if (reason !== null) return fail(reason);
  }
  return ok(draft);
}

export function parseCycle(tokens: string[]): Parsed<CycleArgs> {
  const draft = readCycleDraft(tokens);
  if (!draft.ok) return draft;
  const { guids, maxStarts, resume, words } = draft.value;
  if (resume || guids.length === 0) return fail("invalid cycle");
  const instruction = oneLine(words.join(" "));
  if (!instruction.ok) return instruction;
  return ok({ guids, instruction: instruction.value, maxStarts });
}

export type CycleResumeArgs = { instruction?: string; maxStarts?: number };

export function parseCycleResume(tokens: string[]): Parsed<CycleResumeArgs> {
  const draft = readCycleDraft(tokens);
  if (!draft.ok) return draft;
  const { guids, maxStarts, words } = draft.value;
  if (guids.length > 0) return fail("cycle --resume takes no guids");
  if (words.length === 0) return ok({ maxStarts });
  const instruction = oneLine(words.join(" "));
  if (!instruction.ok) return instruction;
  return ok({ instruction: instruction.value, maxStarts });
}

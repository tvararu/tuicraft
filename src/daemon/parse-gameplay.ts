import {
  type Parsed,
  parseBare,
  parseBoundedArg,
  parseBuy,
  parseCast,
  parseCycle,
  parseCycleResume,
  parseFace,
  parseFight,
  parseGoto,
  parseGuidArg,
  parseItemSlot,
  parseMove,
  parseOptionId,
  parseQuestId,
  parseResurrect,
  parseSell,
  parseSpellId,
  parseWalkToward,
  tokenize,
} from "cli/tokens";
import type { IpcCommand } from "daemon/parse";

const INSPECTIONS = new Map<string, IpcCommand>(
  (
    [
      "control",
      "combat",
      "spells",
      "tactics",
      "cycling",
      "navigation",
      "recovery",
      "quests",
      "inventory",
      "experience",
      "loot",
      "group",
      "trainer",
      "vendor",
    ] as const
  ).flatMap((view): [string, IpcCommand][] => [
    [view.toUpperCase(), { type: view }],
    [`${view.toUpperCase()}_JSON`, { type: `${view}_json` }],
  ]),
);

const ACTIONS = new Map<string, IpcCommand>([
  ["HALT", { type: "halt" }],
  ["CANCEL_CAST", { type: "cancel_cast" }],
  ["STOP_ATTACK", { type: "stop_attack" }],
]);

const STRICT = new Map<string, IpcCommand>(
  (
    [
      "query_corpse",
      "release_spirit",
      "reclaim_corpse",
      "accept_quest",
      "request_reward",
      "cancel_interaction",
      "take_money",
      "release_loot",
      "repair",
    ] as const
  ).map((type): [string, IpcCommand] => [type.toUpperCase(), { type }]),
);

function from<T>(
  parsed: Parsed<T>,
  build: (value: T) => IpcCommand,
): IpcCommand {
  return parsed.ok
    ? build(parsed.value)
    : { reason: parsed.reason, type: "invalid" };
}

function parseSelectOption(tokens: string[], rest: string): IpcCommand {
  const [first] = tokens;
  const optionId = parseOptionId(first);
  if (first === undefined || optionId === undefined)
    return { reason: "invalid gossip option id", type: "invalid" };
  const raw = rest.trim().slice(first.length).trim();
  let code: unknown = null;
  try {
    if (raw) code = JSON.parse(raw);
  } catch {
    return { reason: "invalid gossip code JSON", type: "invalid" };
  }
  if (code !== null && (typeof code !== "string" || code.includes("\0")))
    return { reason: "invalid gossip code", type: "invalid" };
  return { code: code ?? undefined, optionId, type: "select_option" };
}

type GuidIpcType =
  | "face_guid"
  | "target"
  | "attack"
  | "spirit_healer"
  | "talk"
  | "open_loot"
  | "open_trainer"
  | "open_vendor";

const GUID_VERBS = new Map<string, { nonzero: boolean; type: GuidIpcType }>([
  ["FACE_GUID", { nonzero: true, type: "face_guid" }],
  ["TARGET", { nonzero: false, type: "target" }],
  ["ATTACK", { nonzero: false, type: "attack" }],
  ["SPIRIT_HEALER", { nonzero: true, type: "spirit_healer" }],
  ["TALK", { nonzero: true, type: "talk" }],
  ["OPEN_LOOT", { nonzero: true, type: "open_loot" }],
  ["OPEN_TRAINER", { nonzero: true, type: "open_trainer" }],
  ["OPEN_VENDOR", { nonzero: true, type: "open_vendor" }],
]);

const QUEST_VERBS = new Map<
  string,
  Extract<IpcCommand, { questId: number }>["type"]
>([
  ["QUERY_QUEST", "query_quest"],
  ["SELECT_QUEST", "select_quest"],
  ["COMPLETE_QUEST", "complete_quest"],
]);

function parseIndexed(verb: string, tokens: string[]): IpcCommand | undefined {
  const guidVerb = GUID_VERBS.get(verb);
  if (guidVerb) {
    const { nonzero, type } = guidVerb;
    return from(parseGuidArg(tokens, nonzero), (v) => ({ type, ...v }));
  }
  const questType = QUEST_VERBS.get(verb);
  if (questType)
    return from(parseQuestId(tokens), (v) => ({ type: questType, ...v }));
  switch (verb) {
    case "CHOOSE_REWARD":
      return from(
        parseBoundedArg(tokens, 0, 5, "invalid reward index"),
        (index) => ({ index, type: "choose_reward" }),
      );
    case "ABANDON_QUEST":
      return from(
        parseBoundedArg(tokens, 0, 24, "invalid quest slot"),
        (slot) => ({ slot, type: "abandon_quest" }),
      );
    case "TAKE_LOOT":
      return from(
        parseBoundedArg(tokens, 0, 255, "invalid loot slot"),
        (slot) => ({ slot, type: "take_loot" }),
      );
    case "USE":
      return from(parseItemSlot(tokens), (at) => ({ ...at, type: "use" }));
    case "TRAIN":
      return from(parseSpellId(tokens), (v) => ({ type: "train", ...v }));
    case "SELL":
      return from(parseSell(tokens), (v) => ({ type: "sell", ...v }));
    case "BUY":
      return from(parseBuy(tokens), (v) => ({ type: "buy", ...v }));
    default:
      return;
  }
}

function parseMotion(
  verb: string,
  tokens: string[],
  rest: string,
): IpcCommand | undefined {
  switch (verb) {
    case "MOVE":
      return from(parseMove(tokens), (v) => ({ type: "move", ...v }));
    case "FACE":
      return from(parseFace(tokens), (v) => ({ type: "face", ...v }));
    case "WALK_TOWARD":
      return from(parseWalkToward(tokens), (v) => ({
        type: "walk_toward",
        ...v,
      }));
    case "CAST":
      return from(parseCast(tokens), (v) => ({ type: "cast", ...v }));
    case "FIGHT":
      return from(parseFight(tokens), (v) => ({ type: "fight", ...v }));
    case "CYCLE":
      return from(parseCycle(tokens), (v) => ({ type: "cycle", ...v }));
    case "CYCLE_RESUME":
      return from(parseCycleResume(tokens), (v) => ({
        type: "cycle_resume",
        ...v,
      }));
    case "GOTO":
      return from(parseGoto(tokens), (v) => ({ type: "goto", ...v }));
    case "RESURRECT":
      return from(parseResurrect(tokens), (v) => ({ type: "resurrect", ...v }));
    case "SELECT_OPTION":
      return parseSelectOption(tokens, rest);
    default:
      return;
  }
}

export function parseGameplay(
  verb: string,
  rest: string,
): IpcCommand | undefined {
  const tokens = tokenize(rest);
  const fixed = INSPECTIONS.get(verb) ?? ACTIONS.get(verb);
  if (fixed) return fixed;
  const strict = STRICT.get(verb);
  if (strict)
    return from(
      parseBare(tokens, verb.toLowerCase().replaceAll("_", "-")),
      () => strict,
    );
  return parseIndexed(verb, tokens) ?? parseMotion(verb, tokens, rest);
}

import type { CliAction } from "cli/args";
import { formatGuid } from "ui/format";
import type { GotoTarget } from "wow";

const INSPECTIONS = [
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
] as const;

const LOCAL = [
  "interactive",
  "daemon",
  "setup",
  "help",
  "version",
  "say",
  "yell",
  "guild",
  "party",
  "slash",
  "whisper",
  "read",
  "tail",
  "start",
  "status",
  "stop",
  "who",
  "nearby",
  "skill",
  "logs",
  "record",
] as const;

export type Inspection = Extract<
  CliAction,
  { mode: (typeof INSPECTIONS)[number] }
>;
export type Request = Exclude<
  CliAction,
  { mode: (typeof LOCAL)[number] } | Inspection
>;

type Arg = string | number | bigint;

export function isInspection(action: CliAction): action is Inspection {
  return INSPECTIONS.some((mode) => mode === action.mode);
}

export function isRequest(action: CliAction): action is Request {
  return !(isInspection(action) || LOCAL.some((mode) => mode === action.mode));
}

export function inspectionLine(action: Inspection): string {
  return `${action.mode.toUpperCase()}${action.json ? "_JSON" : ""}`;
}

function cycleArgs(
  action: Extract<Request, { mode: "cycle" | "cycle_resume" }>,
): Arg[] {
  const max = action.maxStarts ? ["--max", action.maxStarts] : [];
  if (action.mode === "cycle") {
    const quest = action.questId ? ["--quest", action.questId] : [];
    const sources = (action.sources ?? []).flatMap((entry) => [
      "--source",
      entry,
    ]);
    return [
      ...action.guids,
      ...quest,
      ...sources,
      ...max,
      "--instruction",
      action.instruction,
    ];
  }
  const { instruction } = action;
  return [
    ...max,
    ...(instruction === undefined ? [] : ["--instruction", instruction]),
  ];
}

function gotoArgs(target: GotoTarget): Arg[] {
  if (target.kind === "guid") return [target.guid];
  return target.z === undefined
    ? [target.x, target.y]
    : [target.x, target.y, target.z];
}

function fightArgs(action: Extract<Request, { mode: "fight" }>): Arg[] {
  const framing =
    action.framing && action.framing !== "none"
      ? ["--framing", action.framing]
      : [];
  return [...framing, action.guid, action.instruction];
}

function requestArgs(action: Request): Arg[] {
  switch (action.mode) {
    case "move":
      return [action.direction, action.durationMs];
    case "face":
      return [action.orientation];
    case "face_guid":
    case "target":
    case "attack":
    case "talk":
    case "open_loot":
    case "open_trainer":
    case "spirit_healer":
      return [action.guid];
    case "walk_toward": {
      const { target } = action;
      if (target.kind === "guid") return [action.yards, target.guid];
      return [action.yards, target.x, target.y, target.z];
    }
    case "cast":
      return [action.spellId, action.guid];
    case "fight":
      return fightArgs(action);
    case "cycle":
    case "cycle_resume":
      return cycleArgs(action);
    case "goto":
      return gotoArgs(action.target);
    case "query_quest":
    case "select_quest":
    case "complete_quest":
      return [action.questId];
    case "select_option":
      return [action.optionId, JSON.stringify(action.code ?? null)];
    case "choose_reward":
      return [action.index];
    case "abandon_quest":
    case "take_loot":
      return [action.slot];
    case "use":
      return [action.bag, action.slot];
    case "train":
      return [action.spellId];
    case "resurrect":
      return [action.accept ? "accept" : "decline"];
    default:
      return [];
  }
}

export function requestLine(action: Request): string {
  const args = requestArgs(action).map((arg) =>
    typeof arg === "bigint" ? formatGuid(arg) : String(arg),
  );
  return [action.mode.toUpperCase(), ...args].join(" ");
}

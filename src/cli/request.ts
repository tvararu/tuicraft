import type { CliAction } from "cli/args";
import { formatGuid } from "ui/format";

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
  "loot",
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
    case "spirit_healer":
      return [action.guid];
    case "walk_toward": {
      const { target } = action;
      if (target.kind === "guid") return [action.yards, target.guid];
      return [action.yards, target.x, target.y, target.z];
    }
    case "cast":
      return [action.spellId, action.guid];
    case "fight": {
      const framing =
        action.framing && action.framing !== "none"
          ? ["--framing", action.framing]
          : [];
      return [...framing, action.guid, action.instruction];
    }
    case "cycle": {
      const max = action.maxStarts ? ["--max", action.maxStarts] : [];
      return [...action.guids, ...max, "--instruction", action.instruction];
    }
    case "goto":
      return [action.x, action.y, action.z];
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

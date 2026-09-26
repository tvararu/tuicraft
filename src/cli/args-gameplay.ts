import type { CliAction } from "cli/args";
import {
  type Parsed,
  parseBoundedArg,
  parseCast,
  parseCycle,
  parseCycleResume,
  parseFace,
  parseFight,
  parseGoto,
  parseGuidArg,
  parseMove,
  parseOptionId,
  parseQuestId,
  parseResurrect,
  parseWalkToward,
} from "cli/tokens";
import { parseFramingVariant } from "wow/framing";

export function take<T>(parsed: Parsed<T>): T {
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.value;
}

function parseFightArgs(rest: string[]): CliAction {
  const fight = take(parseFight(rest));
  const framing =
    fight.framing ?? parseFramingVariant(Bun.env["WOW_JEV_FRAMING"]);
  return { mode: "fight", ...fight, framing };
}

function parseSelectOption(rest: string[]): CliAction {
  const optionId = rest.length <= 2 ? parseOptionId(rest[0]) : undefined;
  if (optionId === undefined) throw new Error("invalid gossip option id");
  const code = rest[1];
  if (code?.includes("\0")) throw new Error("invalid gossip code");
  return { code, mode: "select_option", optionId };
}

export function parseGameplay(
  cmd: string,
  rest: string[],
): CliAction | undefined {
  switch (cmd) {
    case "move":
      return { mode: "move", ...take(parseMove(rest)) };
    case "face":
      return { mode: "face", ...take(parseFace(rest)) };
    case "face-guid":
      return { mode: "face_guid", ...take(parseGuidArg(rest, true)) };
    case "walk-toward":
      return { mode: "walk_toward", ...take(parseWalkToward(rest)) };
    case "target":
      return { mode: "target", ...take(parseGuidArg(rest)) };
    case "cast":
      return { mode: "cast", ...take(parseCast(rest)) };
    case "attack":
      return { mode: "attack", ...take(parseGuidArg(rest)) };
    case "fight":
      return parseFightArgs(rest);
    case "cycle":
      return rest.includes("--resume")
        ? { mode: "cycle_resume", ...take(parseCycleResume(rest)) }
        : { mode: "cycle", ...take(parseCycle(rest)) };
    case "goto":
      return { mode: "goto", ...take(parseGoto(rest)) };
    case "spirit-healer":
      return { mode: "spirit_healer", ...take(parseGuidArg(rest, true)) };
    case "resurrect":
      return { mode: "resurrect", ...take(parseResurrect(rest)) };
    case "talk":
      return { mode: "talk", ...take(parseGuidArg(rest, true)) };
    case "query-quest":
      return { mode: "query_quest", ...take(parseQuestId(rest)) };
    case "select-quest":
      return { mode: "select_quest", ...take(parseQuestId(rest)) };
    case "complete-quest":
      return { mode: "complete_quest", ...take(parseQuestId(rest)) };
    case "choose-reward": {
      const index = take(parseBoundedArg(rest, 0, 5, "invalid reward index"));
      return { index, mode: "choose_reward" };
    }
    case "abandon-quest": {
      const slot = take(parseBoundedArg(rest, 0, 24, "invalid quest slot"));
      return { mode: "abandon_quest", slot };
    }
    case "select-option":
      return parseSelectOption(rest);
    case "open-loot":
      return { mode: "open_loot", ...take(parseGuidArg(rest, true)) };
    case "take-loot": {
      const slot = take(parseBoundedArg(rest, 0, 255, "invalid loot slot"));
      return { mode: "take_loot", slot };
    }
    default:
      return undefined;
  }
}

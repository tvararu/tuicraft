import { describe, expect, test } from "bun:test";
import { parseArgs } from "cli/args";
import {
  inspectionLine,
  isRequest,
  type Request,
  requestLine,
} from "cli/request";
import { parseIpcCommand } from "daemon/parse";

function request(argv: string[]): Request {
  const action = parseArgs(argv);
  if (!isRequest(action)) throw new Error(`not a request: ${action.mode}`);
  return action;
}

describe("requestLine", () => {
  test.each([
    [["move", "left", "250"], "MOVE left 250"],
    [["face-guid", "0xA"], "FACE_GUID 0xa"],
    [["walk-toward", "3", "0xa"], "WALK_TOWARD 3 0xa"],
    [["walk-toward", "2", "1", "-2", "3"], "WALK_TOWARD 2 1 -2 3"],
    [["cast", "133", "0xa"], "CAST 133 0xa"],
    [
      ["fight", "--framing", "minimal", "0xa", "hold"],
      "FIGHT --framing minimal 0xa hold",
    ],
    [
      ["cycle", "0xa", "0xb", "--max", "2"],
      "CYCLE 0xa 0xb --max 2 --instruction defeat the selected target while keeping the character alive",
    ],
    [["cycle", "--resume"], "CYCLE_RESUME"],
    [["defend", "off"], "DEFEND off"],
    [["defend", "on", "stay", "alive"], "DEFEND on stay alive"],
    [
      ["cycle", "--resume", "--instruction", "kite", "--max", "2"],
      "CYCLE_RESUME --max 2 --instruction kite",
    ],
    [["select-option", "1", "a b"], 'SELECT_OPTION 1 "a b"'],
    [["resurrect", "decline"], "RESURRECT decline"],
    [["take-money"], "TAKE_MONEY"],
  ])("%p sends %p", (argv, line) => {
    expect(requestLine(request(argv))).toBe(line);
  });

  test.each<[string[]]>([
    [["move", "backward"]],
    [["target", "0"]],
    [["walk-toward", "20", "0xa"]],
    [["goto", "1.5", "-2", "3"]],
    [["goto", "1.5", "-2"]],
    [["goto", "0xa"]],
    [["fight", "--framing", "mechanics", "0xa", "stay", "alive"]],
    [["cycle", "0xa", "--instruction", "hold", "aggro"]],
    [["cycle", "--resume", "--max", "3", "--instruction", "hold", "aggro"]],
    [["cycle", "--resume"]],
    [["defend", "on"]],
    [["defend", "off"]],
    [["select-option", "0"]],
    [["abandon-quest", "24"]],
    [["spirit-healer", "0x1"]],
  ])("the daemon reads %p as the CLI parsed it", (argv) => {
    const { mode, ...fields } = request(argv);
    const cmd = parseIpcCommand(requestLine(request(argv)));
    expect(cmd?.type).toBe(mode);
    expect(cmd).toMatchObject(fields);
  });
});

describe("inspectionLine", () => {
  test("adds the JSON suffix only when requested", () => {
    expect(inspectionLine({ json: false, mode: "loot" })).toBe("LOOT");
    expect(inspectionLine({ json: true, mode: "cycling" })).toBe(
      "CYCLING_JSON",
    );
  });
});

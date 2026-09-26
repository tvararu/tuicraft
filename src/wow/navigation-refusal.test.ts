import { describe, expect, test } from "bun:test";
import { classifyNavigationRefusal } from "wow/navigation";

describe("classifyNavigationRefusal", () => {
  test("maps ground refusals to a next step", () => {
    expect(
      classifyNavigationRefusal("position disagrees with ground height"),
    ).toBe("wait");
    expect(
      classifyNavigationRefusal("ambiguous ground column at destination"),
    ).toBe("pick_destination");
    expect(classifyNavigationRefusal("ambiguous ground column at start")).toBe(
      "stop",
    );
    expect(classifyNavigationRefusal("ambiguous ground column at route")).toBe(
      "stop",
    );
    expect(classifyNavigationRefusal("ground corridor collision")).toBe("stop");
    for (const reason of [
      "pathfind_find_path failed (UNKNOWN_PATH)",
      "end snapped off the requested ground position",
      "native path omits destination",
    ])
      expect(classifyNavigationRefusal(reason)).toBe("unreachable");
    expect(
      classifyNavigationRefusal(
        "start snapped off the requested ground position",
      ),
    ).toBe("stop");
  });
});

import { describe, expect, test } from "bun:test";
import type { Entity } from "wow/entity-store";
import { readLife, readSelfField } from "wow/player-state";
import { ObjectType } from "wow/protocol/entity-fields";

function player(fields: [number, number][], createComplete: boolean): Entity {
  return {
    guid: 1n,
    objectType: ObjectType.PLAYER,
    entry: 0,
    scale: 1,
    position: undefined,
    rawFields: new Map(fields),
    name: undefined,
    createComplete,
  };
}

describe("self field authority", () => {
  test("ghost flag overrides positive ghost health; absence is not automatically dead", () => {
    expect(
      readLife(1n, () =>
        player(
          [
            [0x18, 1],
            [0x96, 0x10],
          ],
          true,
        ),
      ),
    ).toEqual({ life: "ghost", health: 1, flags: 0x10 });
    expect(readLife(1n, () => player([], false)).life).toBe("unknown");
    expect(readLife(1n, () => player([], true)).life).toBe("dead");
    expect(readLife(1n, () => player([[0x18, 99]], true)).life).toBe("alive");
  });

  test("does not zero hidden or unrecognized fields from a complete self CREATE", () => {
    const self = player([], true);
    expect(readSelfField(1n, self, 0x492)).toBe(0);
    expect(readSelfField(1n, self, 0x9e)).toBeUndefined();
    expect(readSelfField(1n, self, 0xdead)).toBeUndefined();
    expect(readSelfField(2n, self, 0x492)).toBeUndefined();
  });
});

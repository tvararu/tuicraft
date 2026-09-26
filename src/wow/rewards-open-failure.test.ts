import { describe, expect, jest, test } from "bun:test";
import { bytes } from "test/hex";
import type { Entity, EntityEvent } from "wow/entity-store";
import { ObjectType } from "wow/protocol/entity-fields";
import { parseLootReleaseResponse, parseLootResponse } from "wow/protocol/loot";
import { PacketReader } from "wow/protocol/packet";
import { RELEASE_ONLY_MS, RewardsRuntime } from "wow/rewards";

const cub = 0xf1_30_00_3c_06_07_6d_c1n;
const next = 0xf1_30_00_3c_06_07_6d_73n;

const releaseOnly = "c16d07063c0030f1 01";
const offer = `
  c16d07063c0030f1 01 00000000 03
  00 1c520000 01000000 ab1a0000 00000000 00000000 04
  01 4c510000 01000000 c6810000 00000000 00000000 04
  02 4d510000 01000000 72170000 00000000 00000000 04
`;

function unit(guid: bigint, fields: [number, number][]): Entity {
  return {
    createComplete: true,
    entry: 0,
    guid,
    name: undefined,
    objectType: guid === 1n ? ObjectType.PLAYER : ObjectType.UNIT,
    position: undefined,
    rawFields: new Map(fields),
    scale: 1,
  };
}

function opening() {
  const entities = new Map([
    [1n, unit(1n, [[0x18, 100]])],
    [cub, unit(cub, [[0x4f, 1]])],
    [next, unit(next, [[0x4f, 1]])],
  ]);
  const runtime = new RewardsRuntime({
    getEntity: (guid) => entities.get(guid),
    now: () => 1000,
    selfGuid: () => 1n,
    send: () => undefined,
  });
  runtime.open(cub);
  runtime.receiveLootRelease(
    parseLootReleaseResponse(new PacketReader(bytes(releaseOnly))),
  );
  return runtime;
}

describe("release-only loot opening", () => {
  test("a full response after the release still opens the window", () => {
    jest.useFakeTimers();
    try {
      const runtime = opening();
      runtime.receiveLootResponse(
        parseLootResponse(new PacketReader(bytes(offer))),
      );
      jest.advanceTimersByTime(RELEASE_ONLY_MS);
      expect(runtime.snapshot()).toMatchObject({
        lastOpenFailure: undefined,
        loot: { guid: cub, money: 0, phase: "open" },
        pending: undefined,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test("the corpse despawning closes the opening and frees the next open", () => {
    const runtime = opening();
    const gone: EntityEvent = { guid: cub, type: "disappear" };
    runtime.observeEntity(gone);
    expect(runtime.snapshot()).toMatchObject({
      lastOpenFailure: {
        guid: cub,
        reason: "loot_source_unavailable",
      },
      loot: { phase: "closed" },
      pending: undefined,
    });
    expect(runtime.open(next).loot).toMatchObject({
      guid: next,
      phase: "opening",
    });
    expect(runtime.snapshot().lastOpenFailure).toBeUndefined();
  });

  test("no full response within the bound closes it as release_only", () => {
    jest.useFakeTimers();
    try {
      const runtime = opening();
      jest.advanceTimersByTime(RELEASE_ONLY_MS - 1);
      expect(runtime.snapshot().loot.phase).toBe("opening");
      jest.advanceTimersByTime(1);
      expect(runtime.snapshot()).toMatchObject({
        lastOpenFailure: { guid: cub, reason: "release_only" },
        loot: { phase: "closed" },
        pending: undefined,
      });
      expect(runtime.open(next).loot.phase).toBe("opening");
    } finally {
      jest.useRealTimers();
    }
  });
});

import { describe, expect, test } from "bun:test";
import { PacketReader } from "wow/protocol/packet";
import { bytes } from "test/hex";
import {
  buildQuestLogRemoveQuest,
  parseQuestUpdateAddKill,
  parseQuestUpdateAddItem,
  parseQuestUpdateComplete,
  parseQuestInvalid,
  parseQuestFailed,
  parseQuestUpdateFailed,
  parseQuestUpdateFailedTimer,
} from "wow/protocol/quest-log";

const guid = 0x0102030405060708n;

describe("buildQuestLogRemoveQuest", () => {
  test("writes the log slot", () => {
    expect(buildQuestLogRemoveQuest(24)).toEqual(bytes("18"));
  });
});

describe("quest log notifications", () => {
  test("retains uint32 counters and decodes gameobject credit without two's-complement corruption", () => {
    expect(
      parseQuestUpdateAddKill(
        new PacketReader(
          bytes("2a000000 41010080 00000100 01000100 0807060504030201"),
        ),
      ),
    ).toEqual({
      questId: 42,
      encodedNpcOrGoId: 0x80000141,
      npcOrGoId: -321,
      currentCount: 65536,
      requiredCount: 65537,
      guid,
    });
  });

  test("distinguishes empty item invalidation from explicit item counts", () => {
    expect(parseQuestUpdateAddItem(new PacketReader(bytes("")))).toEqual({
      kind: "notification",
    });
    const r = new PacketReader(bytes("e9030000 03000000"));
    expect(parseQuestUpdateAddItem(r)).toEqual({
      kind: "item",
      itemId: 1001,
      count: 3,
    });
    expect(r.remaining).toBe(0);
  });

  test("keeps failure reason distinct from quest identity and preserves unknown reasons", () => {
    expect(parseQuestInvalid(new PacketReader(bytes("01000080")))).toEqual({
      reason: 0x80000001,
    });
    expect(
      parseQuestFailed(new PacketReader(bytes("2a000000 32000000"))),
    ).toEqual({ questId: 42, reason: 50 });
    expect(
      parseQuestUpdateComplete(new PacketReader(bytes("2a000000"))),
    ).toEqual({ questId: 42 });
    expect(parseQuestUpdateFailed(new PacketReader(bytes("2a000000")))).toEqual(
      { questId: 42 },
    );
    expect(
      parseQuestUpdateFailedTimer(new PacketReader(bytes("2a000000"))),
    ).toEqual({ questId: 42 });
  });
});

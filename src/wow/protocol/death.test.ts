import { describe, expect, test } from "bun:test";
import { bytes } from "test/hex";
import {
  buildReclaimCorpse,
  buildRepopRequest,
  buildResurrectResponse,
  buildSpiritHealerActivate,
  parseCorpseQuery,
  parseCorpseReclaimDelay,
  parseDeathReleaseLocation,
  parseResurrectRequest,
  parseSpiritHealerConfirm,
} from "wow/protocol/death";
import { PacketReader } from "wow/protocol/packet";

const guid = 0x0102030405060708n;
const guidBytes = [8, 7, 6, 5, 4, 3, 2, 1];

const corpse = bytes(
  "01 12 02 00 00 00 00 c0 3f 00 00 10 c0 00 00 40 40 21 00 00 00 78 56 34 12",
);
const location = bytes("12 02 00 00 00 00 c0 3f 00 00 10 c0 00 00 40 40");
const cleared = bytes("ff ff ff ff 00 00 00 00 00 00 00 00 00 00 00 00");
const resurrection = bytes(
  "08 07 06 05 04 03 02 01 03 00 00 00 c3 85 00 00 01 00 00 00 00",
);

describe("death requests", () => {
  test("release carries its source-required byte and corpse reclaim carries the raw GUID", () => {
    expect([...buildRepopRequest(0)]).toEqual([0]);
    expect([...buildRepopRequest(255)]).toEqual([255]);
    expect([...buildReclaimCorpse(guid)]).toEqual(guidBytes);
  });

  test("resurrection acceptance and rejection are explicit wire decisions", () => {
    expect([...buildResurrectResponse(guid, true)]).toEqual([...guidBytes, 1]);
    expect([...buildResurrectResponse(guid, false)]).toEqual([...guidBytes, 0]);
  });

  test("spirit-healer activation carries the observed healer GUID", () => {
    expect([...buildSpiritHealerActivate(guid)]).toEqual(guidBytes);
  });
});

describe("corpse and recovery responses", () => {
  test("absent corpse is a complete one-byte response with no invented location", () => {
    expect(parseCorpseQuery(new PacketReader(bytes("00")))).toEqual({
      found: false,
    });
  });

  test("corpse query preserves entrance map separately from corpse map and its final scalar", () => {
    const r = new PacketReader(corpse);
    expect(parseCorpseQuery(r)).toEqual({
      found: true,
      mapId: 530,
      position: { x: 1.5, y: -2.25, z: 3 },
      corpseMapId: 33,
      unknown: 0x12_34_56_78,
    });
    expect(r.remaining).toBe(0);
  });

  test("reclaim delay is retained in milliseconds", () => {
    expect(
      parseCorpseReclaimDelay(new PacketReader(bytes("30 75 00 00"))),
    ).toEqual({ delayMs: 30_000 });
  });

  test("captured spirit-healer confirmation carries the raw healer GUID", () => {
    expect(
      parseSpiritHealerConfirm(new PacketReader(bytes("f109005b190030f1"))),
    ).toEqual({ guid: 0xf13000195b0009f1n });
  });

  test("spirit-healer marker clearing is distinct from a location at zero", () => {
    expect(parseDeathReleaseLocation(new PacketReader(cleared))).toEqual({
      kind: "clear",
    });
    expect(parseDeathReleaseLocation(new PacketReader(location))).toEqual({
      kind: "location",
      mapId: 530,
      position: { x: 1.5, y: -2.25, z: 3 },
    });
  });

  test("NPC resurrection preserves UTF-8 name, extra byte, sickness and zero delay override", () => {
    const r = new PacketReader(resurrection);
    expect(parseResurrectRequest(r)).toEqual({
      guid,
      name: "Å",
      reserved: 0,
      sickness: 1,
      delayMs: 0,
    });
    expect(r.remaining).toBe(0);
  });

  test("absent resurrection delay override is not fabricated as zero", () => {
    const player = bytes("08 07 06 05 04 03 02 01 01 00 00 00 00 00 00");
    expect(parseResurrectRequest(new PacketReader(player))).toEqual({
      guid,
      name: "",
      reserved: 0,
      sickness: 0,
      delayMs: undefined,
    });
    expect(
      parseResurrectRequest(new PacketReader(resurrection.subarray(0, 17))),
    ).toEqual({
      guid,
      name: "Å",
      reserved: 0,
      sickness: 1,
      delayMs: undefined,
    });
  });
});

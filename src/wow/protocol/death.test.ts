import { describe, expect, test } from "bun:test";
import { PacketReader } from "wow/protocol/packet";
import {
  buildReclaimCorpse,
  buildRepopRequest,
  buildResurrectResponse,
  buildSpiritHealerActivate,
  parseCorpseQuery,
  parseCorpseReclaimDelay,
  parseDeathReleaseLocation,
  parseResurrectRequest,
} from "wow/protocol/death";

const guid = 0x0102030405060708n;
const guidBytes = [8, 7, 6, 5, 4, 3, 2, 1];

function bytes(hex: string): Uint8Array {
  return Buffer.from(hex.replace(/\s/g, ""), "hex");
}

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
    expect(() => buildSpiritHealerActivate(-1n)).toThrow(RangeError);
    expect(() => buildSpiritHealerActivate(1n << 64n)).toThrow(RangeError);
  });

  test("invalid request fields cannot wrap into a different corpse or flag", () => {
    expect(() => buildRepopRequest(256)).toThrow(RangeError);
    expect(() => buildRepopRequest(-1)).toThrow(RangeError);
    expect(() => buildRepopRequest(0.5)).toThrow(RangeError);
    expect(() => buildReclaimCorpse(-1n)).toThrow(RangeError);
    expect(() => buildResurrectResponse(1n << 64n, true)).toThrow(RangeError);
  });
});

describe("corpse and recovery responses", () => {
  test("absent corpse is a complete one-byte response with no invented location", () => {
    expect(parseCorpseQuery(new PacketReader(bytes("00")))).toEqual({
      found: false,
    });
  });

  test("corpse query preserves entrance map separately from corpse map and its final scalar", () => {
    expect(parseCorpseQuery(new PacketReader(corpse))).toEqual({
      found: true,
      mapId: 530,
      position: { x: 1.5, y: -2.25, z: 3 },
      corpseMapId: 33,
      unknown: 0x12345678,
    });
  });

  test("reclaim delay is retained in milliseconds", () => {
    expect(
      parseCorpseReclaimDelay(new PacketReader(bytes("30 75 00 00"))),
    ).toEqual({ delayMs: 30000 });
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
    expect(parseResurrectRequest(new PacketReader(resurrection))).toEqual({
      guid,
      name: "Å",
      reserved: 0,
      sickness: 1,
      delayMs: 0,
    });
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

  test("truncated conditional corpse and marker packets reject", () => {
    const cases = [
      { data: corpse, parse: parseCorpseQuery },
      { data: location, parse: parseDeathReleaseLocation },
      { data: cleared, parse: parseDeathReleaseLocation },
      { data: bytes("30 75 00 00"), parse: parseCorpseReclaimDelay },
    ];
    for (const { data, parse } of cases) {
      for (let length = 0; length < data.length; length++) {
        expect(() => parse(new PacketReader(data.subarray(0, length)))).toThrow(
          RangeError,
        );
      }
    }
    expect(() =>
      parseCorpseQuery(new PacketReader(bytes("00 00 00 00 00"))),
    ).toThrow(RangeError);
  });

  test("name and optional resurrection delay truncation cannot appear valid", () => {
    for (let length = 0; length < resurrection.length; length++) {
      if (length === 17) continue;
      expect(() =>
        parseResurrectRequest(
          new PacketReader(resurrection.subarray(0, length)),
        ),
      ).toThrow(RangeError);
    }
  });

  test("resurrection names must end at their declared terminator", () => {
    const missingTerminator = resurrection.slice();
    missingTerminator[14] = 65;
    const zeroLength = resurrection.slice();
    zeroLength[8] = 0;
    expect(() =>
      parseResurrectRequest(new PacketReader(missingTerminator)),
    ).toThrow(RangeError);
    expect(() => parseResurrectRequest(new PacketReader(zeroLength))).toThrow(
      RangeError,
    );
  });
});

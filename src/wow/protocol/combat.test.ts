import { test, expect, describe } from "bun:test";
import { PacketReader } from "wow/protocol/packet";
import {
  buildAttackSwing,
  parseAttackStart,
  parseAttackStop,
  parseXpGain,
} from "wow/protocol/combat";

function reader(bytes: number[]): PacketReader {
  return new PacketReader(Uint8Array.from(bytes));
}

describe("buildAttackSwing", () => {
  test("writes unpacked little-endian guid 100", () => {
    expect([...buildAttackSwing(100n)]).toEqual([
      0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
  });

  test("writes high guid bytes", () => {
    expect([...buildAttackSwing(0x0100000002n)]).toEqual([
      0x02, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
    ]);
  });
});

describe("parseAttackStart", () => {
  test("reads unpacked attacker and victim", () => {
    const result = parseAttackStart(
      reader([
        0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
      ]),
    );
    expect(result).toEqual({ attacker: 0x17n, victim: 0x64n });
  });
});

describe("parseAttackStop", () => {
  test("reads packed identities and dead uint32", () => {
    const result = parseAttackStop(
      reader([0x01, 0x17, 0x01, 0x64, 0x01, 0x00, 0x00, 0x00]),
    );
    expect(result).toEqual({ attacker: 0x17n, victim: 0x64n, dead: 1 });
  });
});

describe("parseXpGain", () => {
  test("kill credit includes victim, original xp, and group rate", () => {
    const result = parseXpGain(
      reader([
        0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc8, 0x00, 0x00, 0x00,
        0x00, 0x96, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x3f, 0x00,
      ]),
    );
    expect(result).toEqual({
      victim: 0x64n,
      total: 200,
      kind: "kill",
      original: 150,
      groupRate: 1,
      recruitAFriend: false,
    });
  });

  test("non-kill xp has no original fields", () => {
    const result = parseXpGain(
      reader([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x32, 0x00, 0x00, 0x00,
        0x01, 0x01,
      ]),
    );
    expect(result.kind).toBe("other");
    expect(result.total).toBe(50);
    expect(result.original).toBeUndefined();
    expect(result.recruitAFriend).toBe(true);
  });
});

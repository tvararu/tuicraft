import { test, expect, describe } from "bun:test";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import {
  buildGuidBody,
  buildBigintGuidBody,
  buildRepopRequest,
  buildAutostoreLootItem,
  buildStandStateChange,
  buildItemQuery,
  buildResurrectResponse,
  parseAttackStart,
  parseAttackStop,
  parseAttackerStateUpdate,
  parseLootResponse,
  parseItemPushResult,
  parseLootMoneyNotify,
  parseXpGain,
  parseLevelUp,
  parseHealthUpdate,
  parsePowerUpdate,
  parseCorpseQueryResponse,
  parseDeathReleaseLoc,
  parseResurrectRequest,
  parseItemQueryResponse,
} from "wow/protocol/combat";

describe("builders", () => {
  test("guid bodies", () => {
    const r = new PacketReader(buildGuidBody(0x764, 0xf130));
    expect(r.uint32LE()).toBe(0x764);
    expect(r.uint32LE()).toBe(0xf130);
    const r2 = new PacketReader(buildBigintGuidBody(0xf13000400d000764n));
    expect(r2.uint64LE()).toBe(0xf13000400d000764n);
  });

  test("repop is one zero byte", () => {
    expect([...buildRepopRequest()]).toEqual([0]);
  });

  test("autostore slot and stand state", () => {
    expect([...buildAutostoreLootItem(2)]).toEqual([2]);
    const r = new PacketReader(buildStandStateChange(1));
    expect(r.uint32LE()).toBe(1);
  });

  test("item query and resurrect response", () => {
    const r = new PacketReader(buildItemQuery(20772));
    expect(r.uint32LE()).toBe(20772);
    const r2 = new PacketReader(buildResurrectResponse(77n, true));
    expect(r2.uint64LE()).toBe(77n);
    expect(r2.uint8()).toBe(1);
  });
});

describe("melee parsers", () => {
  test("attack start uses full guids", () => {
    const w = new PacketWriter();
    w.uint64LE(0x42n);
    w.uint64LE(100n);
    expect(parseAttackStart(new PacketReader(w.finish()))).toEqual({
      attacker: 0x42n,
      victim: 100n,
    });
  });

  test("attack stop with dead flag", () => {
    const w = new PacketWriter();
    w.packedGuid(0x42, 0);
    w.packedGuid(100, 0);
    w.uint32LE(1);
    const stop = parseAttackStop(new PacketReader(w.finish()));
    expect(stop).toEqual({ attacker: 0x42n, victim: 100n, dead: true });
  });

  function writeSwing(hitInfo: number, extras: (w: PacketWriter) => void) {
    const w = new PacketWriter();
    w.uint32LE(hitInfo);
    w.packedGuid(100, 0);
    w.packedGuid(0x42, 0);
    w.uint32LE(9);
    w.uint32LE(0);
    w.uint8(1);
    w.uint32LE(1);
    w.floatLE(9);
    w.uint32LE(9);
    extras(w);
    return w.finish();
  }

  test("plain swing", () => {
    const body = writeSwing(0x2, (w) => {
      w.uint8(1);
      w.uint32LE(0);
      w.uint32LE(0);
    });
    const swing = parseAttackerStateUpdate(new PacketReader(body));
    expect(swing).toMatchObject({
      attacker: 100n,
      victim: 0x42n,
      damage: 9,
      miss: false,
      crit: false,
      victimState: 1,
    });
  });

  test("crit with absorb and block", () => {
    const body = writeSwing(0x2 | 0x200 | 0x60 | 0x2000, (w) => {
      w.uint32LE(4);
      w.uint8(1);
      w.uint32LE(0);
      w.uint32LE(0);
      w.uint32LE(3);
    });
    const swing = parseAttackerStateUpdate(new PacketReader(body));
    expect(swing.crit).toBe(true);
    expect(swing.absorbed).toBe(4);
    expect(swing.blocked).toBe(3);
  });

  test("miss", () => {
    const body = writeSwing(0x10, (w) => {
      w.uint8(0);
      w.uint32LE(0);
      w.uint32LE(0);
    });
    expect(parseAttackerStateUpdate(new PacketReader(body)).miss).toBe(true);
  });

  test("truncated swing throws", () => {
    const w = new PacketWriter();
    w.uint32LE(0x2);
    w.packedGuid(100, 0);
    expect(() =>
      parseAttackerStateUpdate(new PacketReader(w.finish())),
    ).toThrow();
  });
});

describe("loot parsers", () => {
  test("loot response with gold and items", () => {
    const w = new PacketWriter();
    w.uint64LE(100n);
    w.uint8(1);
    w.uint32LE(13);
    w.uint8(2);
    w.uint8(0);
    w.uint32LE(20772);
    w.uint32LE(1);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint8(0);
    w.uint8(1);
    w.uint32LE(20402);
    w.uint32LE(2);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint8(0);
    const loot = parseLootResponse(new PacketReader(w.finish()));
    expect(loot.gold).toBe(13);
    expect(loot.items).toEqual([
      { slot: 0, itemId: 20772, count: 1, slotType: 0 },
      { slot: 1, itemId: 20402, count: 2, slotType: 0 },
    ]);
  });

  test("loot error response", () => {
    const w = new PacketWriter();
    w.uint64LE(100n);
    w.uint8(0);
    w.uint8(4);
    const loot = parseLootResponse(new PacketReader(w.finish()));
    expect(loot.lootError).toBe(4);
    expect(loot.items).toEqual([]);
  });

  test("item push result", () => {
    const w = new PacketWriter();
    w.uint64LE(0x42n);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(1);
    w.uint8(0xff);
    w.uint32LE(0xffffffff);
    w.uint32LE(20772);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(1);
    w.uint32LE(3);
    const push = parseItemPushResult(new PacketReader(w.finish()));
    expect(push).toMatchObject({
      itemId: 20772,
      count: 1,
      totalCount: 3,
      looted: true,
    });
  });

  test("money notify", () => {
    const w = new PacketWriter();
    w.uint32LE(13);
    w.uint8(1);
    expect(parseLootMoneyNotify(new PacketReader(w.finish()))).toEqual({
      copper: 13,
      alone: true,
    });
  });
});

describe("progress parsers", () => {
  test("kill xp has the raw block", () => {
    const w = new PacketWriter();
    w.uint64LE(100n);
    w.uint32LE(38);
    w.uint8(0);
    w.uint32LE(38);
    w.floatLE(1);
    w.uint8(0);
    const xp = parseXpGain(new PacketReader(w.finish()));
    expect(xp).toMatchObject({
      victim: 100n,
      totalXp: 38,
      kill: true,
      rawXp: 38,
    });
  });

  test("non-kill xp has no raw block", () => {
    const w = new PacketWriter();
    w.uint64LE(0n);
    w.uint32LE(250);
    w.uint8(1);
    w.uint8(0);
    const xp = parseXpGain(new PacketReader(w.finish()));
    expect(xp.kill).toBe(false);
    expect(xp.rawXp).toBeUndefined();
  });

  test("level up deltas", () => {
    const w = new PacketWriter();
    w.uint32LE(11);
    w.uint32LE(14);
    w.uint32LE(21);
    for (let i = 0; i < 11; i++) w.uint32LE(0);
    expect(parseLevelUp(new PacketReader(w.finish()))).toEqual({
      level: 11,
      healthGained: 14,
      manaGained: 21,
    });
  });

  test("vitals updates", () => {
    const w = new PacketWriter();
    w.packedGuid(0x42, 0);
    w.uint32LE(150);
    expect(parseHealthUpdate(new PacketReader(w.finish()))).toEqual({
      unit: 0x42n,
      health: 150,
    });
    const w2 = new PacketWriter();
    w2.packedGuid(0x42, 0);
    w2.uint8(0);
    w2.uint32LE(400);
    expect(parsePowerUpdate(new PacketReader(w2.finish()))).toEqual({
      unit: 0x42n,
      powerType: 0,
      amount: 400,
    });
  });
});

describe("death parsers", () => {
  test("corpse query response", () => {
    const w = new PacketWriter();
    w.uint8(1);
    w.uint32LE(530);
    w.floatLE(8700);
    w.floatLE(-6640);
    w.floatLE(70);
    w.uint32LE(530);
    expect(parseCorpseQueryResponse(new PacketReader(w.finish()))).toEqual({
      found: true,
      mapId: 530,
      x: 8700,
      y: -6640,
      z: 70,
    });
  });

  test("corpse query miss", () => {
    const w = new PacketWriter();
    w.uint8(0);
    expect(parseCorpseQueryResponse(new PacketReader(w.finish()))).toEqual({
      found: false,
    });
  });

  test("death release loc", () => {
    const w = new PacketWriter();
    w.uint32LE(530);
    w.floatLE(1);
    w.floatLE(2);
    w.floatLE(3);
    expect(parseDeathReleaseLoc(new PacketReader(w.finish()))).toEqual({
      mapId: 530,
      x: 1,
      y: 2,
      z: 3,
    });
  });

  test("resurrect request", () => {
    const w = new PacketWriter();
    w.uint64LE(77n);
    w.uint32LE(6);
    w.rawBytes(new TextEncoder().encode("Deity"));
    w.uint8(0);
    w.uint8(0);
    const req = parseResurrectRequest(new PacketReader(w.finish()));
    expect(req).toEqual({ resurrector: 77n, name: "Deity" });
  });
});

describe("item query response", () => {
  test("parses name and quality prefix", () => {
    const w = new PacketWriter();
    w.uint32LE(20772);
    w.uint32LE(15);
    w.uint32LE(0);
    w.uint32LE(0xffffffff);
    w.cString("Springpaw Pelt");
    w.cString("");
    w.cString("");
    w.cString("");
    w.uint32LE(123);
    w.uint32LE(1);
    w.uint32LE(0);
    expect(parseItemQueryResponse(new PacketReader(w.finish()))).toEqual({
      entry: 20772,
      name: "Springpaw Pelt",
      quality: 1,
    });
  });

  test("unknown item returns undefined", () => {
    const w = new PacketWriter();
    w.uint32LE((20772 | 0x80000000) >>> 0);
    expect(
      parseItemQueryResponse(new PacketReader(w.finish())),
    ).toBeUndefined();
  });
});

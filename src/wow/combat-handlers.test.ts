import { test, expect, describe } from "bun:test";
import {
  worldSession,
  type CombatFeedEvent,
  type WorldHandle,
} from "wow/client";
import type { AuthResult } from "wow/auth";
import { startMockWorldServer } from "test/mock-world-server";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { GameOpcode } from "wow/protocol/opcodes";
import {
  UpdateFlag,
  OBJECT_FIELDS,
  UNIT_FIELDS,
} from "wow/protocol/entity-fields";
import {
  FIXTURE_ACCOUNT,
  FIXTURE_PASSWORD,
  FIXTURE_CHARACTER,
  clientPrivateKey,
  clientSeed,
  sessionKey,
} from "test/fixtures";

const base = {
  account: FIXTURE_ACCOUNT,
  password: FIXTURE_PASSWORD,
  character: FIXTURE_CHARACTER,
  srpPrivateKey: clientPrivateKey,
  clientSeed,
  combatTickMs: 20,
  moveTickMs: 10,
};

function fakeAuth(port: number): AuthResult {
  return { sessionKey, realmHost: "127.0.0.1", realmPort: port, realmId: 1 };
}

type Session = {
  handle: WorldHandle;
  ws: Awaited<ReturnType<typeof startMockWorldServer>>;
  events: CombatFeedEvent[];
  waitFor(pred: (e: CombatFeedEvent) => boolean): Promise<CombatFeedEvent>;
};

async function startSession(): Promise<Session> {
  const ws = await startMockWorldServer();
  const handle = await worldSession(
    { ...base, host: "127.0.0.1", port: ws.port },
    fakeAuth(ws.port),
  );
  const events: CombatFeedEvent[] = [];
  let waiters: Array<{
    pred: (e: CombatFeedEvent) => boolean;
    resolve: (e: CombatFeedEvent) => void;
  }> = [];
  handle.onCombatEvent((e) => {
    events.push(e);
    waiters = waiters.filter((w) => {
      if (!w.pred(e)) return true;
      w.resolve(e);
      return false;
    });
  });
  return {
    handle,
    ws,
    events,
    waitFor(pred) {
      const existing = events.find(pred);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => {
        waiters.push({ pred, resolve });
      });
    },
  };
}

async function endSession(s: Session): Promise<void> {
  s.handle.close();
  await s.handle.closed;
  s.ws.stop();
}

function writePackedGuid(w: PacketWriter, guid: bigint) {
  w.packedGuid(Number(guid & 0xffffffffn), Number((guid >> 32n) & 0xffffffffn));
}

function writeLivingBlock(w: PacketWriter, x: number, y: number, z: number) {
  w.uint16LE(UpdateFlag.LIVING);
  w.uint32LE(0);
  w.uint16LE(0);
  w.uint32LE(0);
  w.floatLE(x);
  w.floatLE(y);
  w.floatLE(z);
  w.floatLE(0);
  w.floatLE(0);
  for (let i = 0; i < 9; i++) w.floatLE(0);
}

function writeUpdateMask(w: PacketWriter, fields: Map<number, number>) {
  const maxOffset = Math.max(...fields.keys());
  const blockCount = Math.floor(maxOffset / 32) + 1;
  w.uint8(blockCount);
  const mask = new Array(blockCount).fill(0);
  for (const offset of fields.keys()) {
    mask[Math.floor(offset / 32)] |= 1 << (offset % 32);
  }
  for (const m of mask) w.uint32LE(m >>> 0);
  const sorted = [...fields.entries()].sort((a, b) => a[0] - b[0]);
  for (const [, value] of sorted) w.uint32LE(value);
}

function buildCreateUnit(
  guid: bigint,
  entry: number,
  x: number,
  y: number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(1);
  w.uint8(3);
  writePackedGuid(w, guid);
  w.uint8(3);
  writeLivingBlock(w, x, y, 0);
  writeUpdateMask(
    w,
    new Map<number, number>([
      [OBJECT_FIELDS.ENTRY.offset, entry],
      [UNIT_FIELDS.HEALTH.offset, 137],
      [UNIT_FIELDS.MAXHEALTH.offset, 137],
    ]),
  );
  return w.finish();
}

async function spawnMob(s: Session, name: string, x = 3, y = 0) {
  s.ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, buildCreateUnit(200n, 555, x, y));
  const resp = new PacketWriter();
  resp.uint32LE(555);
  resp.cString(name);
  s.ws.inject(GameOpcode.SMSG_CREATURE_QUERY_RESPONSE, resp.finish());
  await new Promise<void>((resolve) => {
    const check = () => {
      if (s.handle.getNearbyEntities().some((e) => e.name === name)) resolve();
      else setTimeout(check, 5);
    };
    check();
  });
}

describe("combat primitives", () => {
  test("spellbook loads from SMSG_INITIAL_SPELLS", async () => {
    const s = await startSession();
    try {
      const w = new PacketWriter();
      w.uint8(0);
      w.uint16LE(3);
      for (const id of [585, 589, 5019]) {
        w.uint32LE(id);
        w.uint16LE(0);
      }
      w.uint16LE(0);
      s.ws.inject(GameOpcode.SMSG_INITIAL_SPELLS, w.finish());
      await s.waitFor((e) => e.type === "spellbook");
      expect(s.handle.getSpellbook()).toEqual([585, 589, 5019]);
    } finally {
      await endSession(s);
    }
  });

  test("target and attack send selection then swing", async () => {
    const s = await startSession();
    try {
      await spawnMob(s, "Springpaw Stalker");
      expect(s.handle.targetByName("springpaw stalker")).toBe(true);
      const selection = await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_SET_SELECTION,
      );
      expect(new PacketReader(selection.body).uint64LE()).toBe(200n);

      expect(s.handle.attackTarget()).toBe(true);
      const swing = await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_ATTACKSWING,
      );
      expect(new PacketReader(swing.body).uint64LE()).toBe(200n);
    } finally {
      await endSession(s);
    }
  });

  test("cast at target faces it and sends UNIT-flagged cast", async () => {
    const s = await startSession();
    try {
      await spawnMob(s, "Springpaw Stalker");
      s.handle.targetByName("Springpaw Stalker");
      expect(s.handle.castSpell(589, false)).toBe(true);
      const cast = await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_CAST_SPELL,
      );
      const r = new PacketReader(cast.body);
      r.uint8();
      expect(r.uint32LE()).toBe(589);
      r.uint8();
      expect(r.uint32LE()).toBe(0x2);
      expect(r.packedGuid()).toEqual({ low: 200, high: 0 });
    } finally {
      await endSession(s);
    }
  });

  test("cast failure event carries the named result", async () => {
    const s = await startSession();
    try {
      const w = new PacketWriter();
      w.uint8(1);
      w.uint32LE(589);
      w.uint8(0x61);
      w.uint8(0);
      s.ws.inject(GameOpcode.SMSG_CAST_FAILED, w.finish());
      const event = await s.waitFor((e) => e.type === "cast_failed");
      expect(event).toMatchObject({ resultName: "OUT_OF_RANGE" });
    } finally {
      await endSession(s);
    }
  });

  test("xp gain and level up become events", async () => {
    const s = await startSession();
    try {
      const xp = new PacketWriter();
      xp.uint64LE(200n);
      xp.uint32LE(38);
      xp.uint8(0);
      xp.uint32LE(38);
      xp.floatLE(1);
      xp.uint8(0);
      s.ws.inject(GameOpcode.SMSG_LOG_XPGAIN, xp.finish());
      const event = await s.waitFor((e) => e.type === "xp");
      expect(event).toMatchObject({ amount: 38, kill: true });

      const lvl = new PacketWriter();
      lvl.uint32LE(11);
      for (let i = 0; i < 13; i++) lvl.uint32LE(0);
      s.ws.inject(GameOpcode.SMSG_LEVELUP_INFO, lvl.finish());
      const up = await s.waitFor((e) => e.type === "level_up");
      expect(up).toMatchObject({ level: 11 });
    } finally {
      await endSession(s);
    }
  });

  test("health updates flow into the entity store and death emits", async () => {
    const s = await startSession();
    try {
      await spawnMob(s, "Springpaw Stalker");
      const w = new PacketWriter();
      w.packedGuid(200, 0);
      w.uint32LE(40);
      s.ws.inject(GameOpcode.SMSG_HEALTH_UPDATE, w.finish());
      await new Promise<void>((resolve) => {
        const check = () => {
          const mob = s.handle
            .getNearbyEntities()
            .find((e) => e.name === "Springpaw Stalker");
          if (mob && "health" in mob && mob.health === 40) resolve();
          else setTimeout(check, 5);
        };
        check();
      });

      const own = new PacketWriter();
      own.packedGuid(0x42, 0);
      own.uint32LE(0);
      s.ws.inject(GameOpcode.SMSG_HEALTH_UPDATE, own.finish());
      await s.waitFor((e) => e.type === "died");
    } finally {
      await endSession(s);
    }
  });

  test("loot window event lists items and gold", async () => {
    const s = await startSession();
    try {
      const w = new PacketWriter();
      w.uint64LE(200n);
      w.uint8(1);
      w.uint32LE(13);
      w.uint8(1);
      w.uint8(0);
      w.uint32LE(20772);
      w.uint32LE(1);
      w.uint32LE(0);
      w.uint32LE(0);
      w.uint32LE(0);
      w.uint8(0);
      s.ws.inject(GameOpcode.SMSG_LOOT_RESPONSE, w.finish());
      const event = await s.waitFor((e) => e.type === "loot_window");
      expect(event).toMatchObject({ gold: 13 });
      const query = await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_ITEM_QUERY_SINGLE,
      );
      expect(new PacketReader(query.body).uint32LE()).toBe(20772);
    } finally {
      await endSession(s);
    }
  });
});

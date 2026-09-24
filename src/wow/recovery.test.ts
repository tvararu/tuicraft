import { describe, expect, test } from "bun:test";
import { bytes } from "test/hex";
import type { Entity } from "wow/entity-store";
import type { ControlPose } from "wow/control";
import { RecoveryRuntime, type RecoveryEvent } from "wow/recovery";
import { ObjectType } from "wow/protocol/entity-fields";
import { PacketReader } from "wow/protocol/packet";
import {
  parseCorpseQuery,
  parseCorpseReclaimDelay,
  parseDeathReleaseLocation,
  parseResurrectRequest,
} from "wow/protocol/death";

function fixture(health = 0, flags = 0) {
  const self: Entity = {
    guid: 1n,
    objectType: ObjectType.PLAYER,
    entry: 0,
    scale: 1,
    position: undefined,
    rawFields: new Map([
      [0x18, health],
      [0x96, flags],
    ]),
    name: undefined,
    createComplete: true,
  };
  const clock = { now: 1000 };
  const pose: ControlPose = {
    mapId: 530,
    x: 0,
    y: 0,
    z: 0,
    orientation: 0,
    source: "predicted",
    updatedAt: 1000,
  };
  const sent: { opcode: number; body: Uint8Array | undefined }[] = [];
  const events: RecoveryEvent[] = [];
  const others = new Map<bigint, Entity>();
  const runtime = new RecoveryRuntime({
    send: (opcode, body) => {
      sent.push({ opcode, body });
    },
    now: () => clock.now,
    selfGuid: () => 1n,
    getEntity: (guid) => (guid === 1n ? self : others.get(guid)),
    pose: () => pose,
  });
  runtime.onEvent((event) => events.push(event));
  function life(nextHealth: number, nextFlags: number): void {
    self.rawFields.set(0x18, nextHealth);
    self.rawFields.set(0x96, nextFlags);
    runtime.observeEntity({
      type: "update",
      entity: self,
      changed: ["rawFields"],
    });
  }
  return { runtime, self, clock, pose, sent, events, life, others };
}

const corpse = "01 12020000 00000000 00000000 00000000 12020000 00000000";
const offer = "6300000000000000 01000000 00 00 00";
const healerGuid = 0x0102030405060708n;

describe("ordinary-player recovery", () => {
  test("release and graveyard packets do not invent ghost or alive state", () => {
    const f = fixture();
    f.runtime.releaseSpirit();
    expect(f.sent).toEqual([{ opcode: 0x15a, body: bytes("00") }]);
    expect(f.runtime.snapshot()).toMatchObject({
      life: "dead",
      request: { action: "release", status: "unanswered" },
    });
    f.runtime.receiveGraveyard(
      parseDeathReleaseLocation(
        new PacketReader(bytes("12020000 00004842 00000000 00000000")),
      ),
    );
    expect(f.runtime.snapshot().life).toBe("dead");
    f.life(1, 0x10);
    expect(f.runtime.snapshot().life).toBe("ghost");
    expect(f.runtime.snapshot().request).toBeUndefined();
    f.runtime.receiveGraveyard(
      parseDeathReleaseLocation(
        new PacketReader(bytes("ffffffff 00000000 00000000 00000000")),
      ),
    );
    expect(f.runtime.snapshot().life).toBe("ghost");
  });

  test("reclaims only a queried physical corpse within3D range after known delay", () => {
    const f = fixture(1, 0x10);
    expect(() => f.runtime.reclaimCorpse()).toThrow();
    f.runtime.queryCorpse();
    expect(f.runtime.snapshot().corpse.status).toBe("unknown");
    expect(f.runtime.snapshot().query?.status).toBe("unanswered");
    f.runtime.receiveCorpse(parseCorpseQuery(new PacketReader(bytes(corpse))));
    f.runtime.receiveReclaimDelay(
      parseCorpseReclaimDelay(new PacketReader(bytes("30750000"))),
    );
    expect(f.runtime.snapshot().reclaim).toMatchObject({
      canRequest: false,
      reason: "reclaim_delay",
      remainingMs: 30000,
      pose: { source: "predicted" },
    });
    expect(() => f.runtime.reclaimCorpse()).toThrow();
    f.clock.now = 31000;
    f.pose.z = 40;
    expect(f.runtime.snapshot().reclaim.reason).toBe("corpse_out_of_range");
    f.pose.z = 39;
    f.runtime.reclaimCorpse();
    expect(f.sent.at(-1)).toEqual({
      opcode: 0x1d2,
      body: bytes("0000000000000000"),
    });
    expect(f.runtime.snapshot().life).toBe("ghost");
    f.life(55, 0);
    expect(f.runtime.snapshot()).toMatchObject({
      life: "alive",
      corpse: { status: "unknown" },
      request: undefined,
      resurrection: undefined,
    });
  });

  test("does not use an entrance-map display position as the actual corpse", () => {
    const f = fixture(1, 0x10);
    f.runtime.queryCorpse();
    f.runtime.receiveCorpse(
      parseCorpseQuery(
        new PacketReader(
          bytes("01 12020000 00000000 00000000 00000000 01000000 00000000"),
        ),
      ),
    );
    expect(f.runtime.snapshot().corpse).toMatchObject({
      status: "found",
      mapId: 530,
      corpseMapId: 1,
    });
    expect(f.runtime.snapshot().reclaim.reason).toBe("corpse_position_unknown");
    expect(() => f.runtime.reclaimCorpse()).toThrow();
    f.runtime.queryCorpse();
    f.runtime.receiveCorpse(parseCorpseQuery(new PacketReader(bytes("00"))));
    expect(f.runtime.snapshot().corpse.status).toBe("absent");
    expect(f.runtime.snapshot().life).toBe("ghost");
  });

  test("keeps omitted login timer unknown while allowing an explicit server-checked request", () => {
    const f = fixture(1, 0x10);
    f.runtime.queryCorpse();
    f.runtime.receiveCorpse(parseCorpseQuery(new PacketReader(bytes(corpse))));
    expect(f.runtime.snapshot().reclaim).toMatchObject({
      canRequest: true,
      readiness: "unverified",
      remainingMs: undefined,
    });
    expect(f.runtime.snapshot().reclaimDelay).toBeUndefined();
    f.runtime.reclaimCorpse();
    expect(f.runtime.snapshot()).toMatchObject({
      life: "ghost",
      request: { action: "reclaim", status: "unanswered" },
    });
  });

  test("retains stale query tombstone across death epochs before allowing a fresh query", () => {
    const f = fixture(1, 0x10);
    f.runtime.queryCorpse();
    expect(() => f.runtime.queryCorpse()).toThrow();
    f.runtime.receiveResurrectRequest(
      parseResurrectRequest(new PacketReader(bytes(offer + " 00000000"))),
    );
    f.runtime.receiveReclaimDelay(
      parseCorpseReclaimDelay(new PacketReader(bytes("30750000"))),
    );
    f.life(100, 0);
    f.life(0, 0);
    f.life(1, 0x10);
    expect(f.runtime.snapshot().query?.status).toBe("stale");
    expect(f.runtime.snapshot().resurrection).toBeUndefined();
    expect(f.runtime.snapshot().reclaimDelay).toBeUndefined();
    expect(() => f.runtime.queryCorpse()).toThrow();
    f.runtime.receiveCorpse(parseCorpseQuery(new PacketReader(bytes(corpse))));
    expect(f.runtime.snapshot().corpse.status).toBe("unknown");
    expect(f.runtime.snapshot().query).toBeUndefined();
    f.runtime.queryCorpse();
    f.runtime.receiveCorpse(parseCorpseQuery(new PacketReader(bytes(corpse))));
    expect(f.runtime.snapshot().corpse.status).toBe("found");
  });

  test("resurrection responses require a current offer; override0 is not a reclaim timer", () => {
    const f = fixture(1, 0x10);
    expect(() => f.runtime.respondResurrection(true)).toThrow();
    f.runtime.receiveReclaimDelay(
      parseCorpseReclaimDelay(new PacketReader(bytes("30750000"))),
    );
    f.runtime.receiveResurrectRequest(
      parseResurrectRequest(new PacketReader(bytes(offer))),
    );
    expect(() => f.runtime.respondResurrection(true)).toThrow();
    f.runtime.respondResurrection(false);
    expect(f.sent.at(-1)).toEqual({
      opcode: 0x15c,
      body: bytes("6300000000000000 00"),
    });
    expect(f.runtime.snapshot().resurrection?.response).toBe(
      "decline_requested",
    );
    expect(() => f.runtime.respondResurrection(false)).toThrow();
    f.runtime.receiveResurrectRequest(
      parseResurrectRequest(new PacketReader(bytes(offer + " 00000000"))),
    );
    f.runtime.respondResurrection(true);
    expect(f.sent.at(-1)).toEqual({
      opcode: 0x15c,
      body: bytes("6300000000000000 01"),
    });
    expect(f.runtime.snapshot().life).toBe("ghost");
    expect(f.runtime.snapshot().reclaimDelay?.readyAt).toBe(31000);
    f.life(100, 0);
    expect(f.runtime.snapshot().resurrection).toBeUndefined();
  });

  test("entity disappearance invalidates authority before the store removes its old object", () => {
    const f = fixture(1, 0x10);
    f.runtime.queryCorpse();
    f.runtime.observeEntity({ type: "disappear", guid: 1n });
    expect(f.runtime.snapshot().life).toBe("unknown");
    expect(f.runtime.snapshot().query?.status).toBe("stale");
    expect(() => f.runtime.releaseSpirit()).toThrow();
    f.runtime.observeEntity({ type: "appear", entity: f.self });
    expect(f.runtime.snapshot().life).toBe("ghost");
  });

  test("snapshots cannot alter reclaim evidence and disposal clears callbacks and authorization", () => {
    const f = fixture(1, 0x10);
    f.runtime.queryCorpse();
    f.runtime.receiveCorpse(parseCorpseQuery(new PacketReader(bytes(corpse))));
    const state = f.runtime.snapshot();
    if (state.corpse.status === "found") state.corpse.position.x = 999;
    expect(f.runtime.snapshot().corpse).toMatchObject({ position: { x: 0 } });
    f.runtime.dispose();
    const count = f.events.length;
    f.runtime.receiveResurrectRequest(
      parseResurrectRequest(new PacketReader(bytes(offer))),
    );
    f.life(100, 0);
    expect(f.events.length).toBe(count);
    expect(f.runtime.snapshot()).toMatchObject({
      disposed: true,
      life: "unknown",
      query: undefined,
      request: undefined,
      resurrection: undefined,
    });
    expect(() => f.runtime.queryCorpse()).toThrow();
    expect(() => f.runtime.releaseSpirit()).toThrow();
  });

  test("a failed transport send does not create a recovery request", () => {
    const f = fixture();
    const runtime = new RecoveryRuntime({
      send: () => {
        throw new Error("socket closed");
      },
      now: () => 1000,
      selfGuid: () => 1n,
      getEntity: () => f.self,
      pose: () => f.pose,
    });
    expect(() => runtime.releaseSpirit()).toThrow("socket closed");
    expect(runtime.snapshot().request).toBeUndefined();
    expect(runtime.snapshot().life).toBe("dead");
  });

  test("spirit-healer activation requires observed ghost and healer flag", () => {
    const alive = fixture(100, 0);
    expect(() => alive.runtime.activateSpiritHealer(healerGuid)).toThrow();
    const ghost = fixture(1, 0x10);
    expect(() => ghost.runtime.activateSpiritHealer(healerGuid)).toThrow();
    expect(ghost.sent).toEqual([]);
    const healer = {
      guid: healerGuid,
      objectType: ObjectType.UNIT,
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      npcFlags: 0x4000,
      health: 100,
      maxHealth: 100,
      level: 1,
      factionTemplate: 0,
      displayId: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [],
      maxPower: [],
      name: undefined,
    } as const;
    ghost.others.set(healerGuid, healer as unknown as Entity);
    ghost.runtime.observeEntity({
      type: "appear",
      entity: healer as unknown as Entity,
    });
    ghost.runtime.activateSpiritHealer(healerGuid);
    expect(ghost.sent.at(-1)).toEqual({
      opcode: 0x21c,
      body: bytes("0807060504030201"),
    });
    expect(ghost.runtime.snapshot()).toMatchObject({
      life: "ghost",
      request: { action: "spirit-healer", status: "unanswered" },
    });
    expect(() => ghost.runtime.activateSpiritHealer(healerGuid)).toThrow();
    ghost.life(100, 0);
    expect(ghost.runtime.snapshot().request).toBeUndefined();
  });

  test("spirit-healer duplicate activation is rejected across corpse queries", () => {
    const ghost = fixture(1, 0x10);
    const healer = {
      guid: healerGuid,
      objectType: ObjectType.UNIT,
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      npcFlags: 0x4000,
      health: 100,
      maxHealth: 100,
      level: 1,
      factionTemplate: 0,
      displayId: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [],
      maxPower: [],
      name: undefined,
    } as const;
    ghost.others.set(healerGuid, healer as unknown as Entity);
    ghost.runtime.observeEntity({
      type: "appear",
      entity: healer as unknown as Entity,
    });
    ghost.runtime.activateSpiritHealer(healerGuid);
    expect(ghost.sent).toHaveLength(1);
    expect(ghost.sent[0]!.opcode).toBe(0x21c);

    ghost.runtime.queryCorpse();
    expect(ghost.sent).toHaveLength(2);
    expect(ghost.sent[1]!.opcode).toBe(0x216);

    expect(() => ghost.runtime.activateSpiritHealer(healerGuid)).toThrow(
      "Previous spirit-healer request remains unanswered",
    );
    expect(ghost.sent.filter((p) => p.opcode === 0x21c)).toHaveLength(1);

    ghost.runtime.receiveCorpse(
      parseCorpseQuery(new PacketReader(bytes(corpse))),
    );
    expect(() => ghost.runtime.activateSpiritHealer(healerGuid)).toThrow(
      "Previous spirit-healer request remains unanswered",
    );
    expect(ghost.sent.filter((p) => p.opcode === 0x21c)).toHaveLength(1);
    expect(ghost.runtime.snapshot()).toMatchObject({
      life: "ghost",
      request: { action: "spirit-healer", status: "unanswered" },
    });

    ghost.life(100, 0);
    expect(ghost.runtime.snapshot().request).toBeUndefined();
  });
});

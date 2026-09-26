import { describe, expect, jest, test } from "bun:test";
import {
  clientPrivateKey,
  clientSeed,
  FIXTURE_ACCOUNT,
  FIXTURE_CHARACTER,
  FIXTURE_PASSWORD,
  sessionKey,
} from "test/fixtures";
import { startMockWorldServer } from "test/mock-world-server";
import { must } from "test/must";
import { writePackedGuid } from "test/world-handlers-fixtures";
import { type WorldHandle, worldSession } from "wow/client";
import { type ControlMode, ControlRuntime } from "wow/control";
import type { DbcFile } from "wow/dbc";
import * as factionData from "wow/faction-template";
import * as jev from "wow/jev";
import * as navigation from "wow/navigation";
import type { NativeMap } from "wow/navigation-native";
import {
  ObjectType,
  UNIT_FIELDS,
  UpdateFlag,
  UpdateType,
} from "wow/protocol/entity-fields";
import { writeMovementInfo } from "wow/protocol/movement";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketWriter } from "wow/protocol/packet";
import * as spellData from "wow/spell-catalog";
import * as worldHandlers from "wow/world-handlers";

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const selfGuid = 0x42;
const targetGuid = 0x99;

type Fixture = {
  handle: WorldHandle;
  stop: () => void;
  inject: (opcode: number, body: Uint8Array) => void;
};

async function bounded<T>(pending: Promise<T>): Promise<T> {
  const timeout = Promise.withResolvers<never>();
  const timer = realSetTimeout(
    () => timeout.reject(new Error("gameplay_fixture_timeout")),
    2000,
  );
  try {
    return await Promise.race([pending, timeout.promise]);
  } finally {
    realClearTimeout(timer);
  }
}

async function disposeFixture(f: Fixture | undefined): Promise<void> {
  if (!f) return;
  try {
    f.handle.close();
  } finally {
    f.stop();
  }
  await bounded(f.handle.closed);
}

function writeFields(writer: PacketWriter, fields: Map<number, number>): void {
  const sorted = [...fields.entries()].sort(([a], [b]) => a - b);
  const blocks = Math.floor(must(sorted.at(-1))[0] / 32) + 1;
  const masks = new Array<number>(blocks).fill(0);
  for (const [offset] of sorted) {
    const slot = Math.floor(offset / 32);
    masks[slot] = must(masks[slot]) | (1 << (offset % 32));
  }
  writer.uint8(blocks);
  for (const mask of masks) writer.uint32LE(mask);
  for (const [, value] of sorted) writer.uint32LE(value);
}

function writeUnit(writer: PacketWriter, guid: number, x: number): void {
  const self = guid === selfGuid;
  writer.uint8(UpdateType.CREATE_OBJECT2);
  writer.packedGuid(guid, 0);
  writer.uint8(self ? ObjectType.PLAYER : ObjectType.UNIT);
  writer.uint16LE(UpdateFlag.LIVING | (self ? UpdateFlag.SELF : 0));
  writeMovementInfo(writer, {
    flags: 0,
    extraFlags: 0,
    time: 1,
    x,
    y: 2,
    z: 3,
    orientation: 0,
    fallTime: 0,
  });
  for (const speed of [2.5, 7, 4.5, 4.7, 2.5, 3.14, 7, 4.5, 3.14])
    writer.floatLE(speed);
  writeFields(
    writer,
    new Map([
      [UNIT_FIELDS.HEALTH.offset, 100],
      [UNIT_FIELDS.MAXHEALTH.offset, 100],
      [UNIT_FIELDS.FLAGS.offset, self ? 0 : 0x8_00_00],
      [UNIT_FIELDS.TARGET.offset, self ? 0 : selfGuid],
      [UNIT_FIELDS.COMBATREACH.offset, 0x3f_c0_00_00],
    ]),
  );
}

function units(targetX: number): Uint8Array {
  const writer = new PacketWriter();
  writer.uint32LE(2);
  writeUnit(writer, selfGuid, 1);
  writeUnit(writer, targetGuid, targetX);
  return writer.finish();
}

async function fixture(targetX: number): Promise<Fixture> {
  const server = await startMockWorldServer({ loginMapId: 530 });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    server.stop();
  };
  let handle: WorldHandle | undefined;
  try {
    handle = await bounded(
      worldSession(
        {
          account: FIXTURE_ACCOUNT,
          password: FIXTURE_PASSWORD,
          character: FIXTURE_CHARACTER,
          srpPrivateKey: clientPrivateKey,
          clientSeed,
          host: "127.0.0.1",
          port: server.port,
          navigationDataDir: "fixture-navigation",
          navigationLibrary: "fixture-native",
          spellDataDir: "fixture-spells",
          jevApiKey: "fixture-provider-not-called",
        },
        {
          sessionKey,
          realmHost: "127.0.0.1",
          realmPort: server.port,
          realmId: 1,
        },
      ),
    );
    const ready = Promise.withResolvers<void>();
    handle.onMessage((message) => {
      if (message.message === "gameplay-lifecycle-ready") ready.resolve();
    });
    server.inject(GameOpcode.SMSG_UPDATE_OBJECT, units(targetX));
    handle.sendSay("gameplay-lifecycle-ready");
    await bounded(ready.promise);
    return {
      handle,
      stop,
      inject: (opcode, body) => server.inject(opcode, body),
    };
  } catch (error) {
    handle?.close();
    stop();
    throw error;
  }
}

function flatMap(): NativeMap {
  return {
    loadAdtAt() {},
    findHeights: () => [3],
    findHeight: () => 3,
    lineOfSight: () => true,
    findPath: (from, to) => [from, to],
    close() {},
  };
}

function emptyDbc(name: string, fields: number): DbcFile {
  return {
    name,
    fields,
    records: new DataView(new ArrayBuffer(0)),
    strings: Uint8Array.of(0),
    recordCount: 0,
    byId: new Map(),
  };
}

function emptySpells(): spellData.SpellCatalog {
  return new spellData.SpellCatalog({
    spell: emptyDbc("Spell.dbc", 234),
    range: emptyDbc("SpellRange.dbc", 40),
    cast: emptyDbc("SpellCastTimes.dbc", 4),
    duration: emptyDbc("SpellDuration.dbc", 4),
    radius: emptyDbc("SpellRadius.dbc", 16),
  });
}

describe("gameplay forced-close lifecycle", () => {
  test("an out-of-range update for the navigated creature stops its route as target_lost", async () => {
    const createNavigation = navigation.createNavigation;
    const nav = jest
      .spyOn(navigation, "createNavigation")
      .mockImplementation((options) =>
        createNavigation(options, () => flatMap()),
      );
    let f: Fixture | undefined;
    try {
      f = await fixture(60);
      const handle = f.handle;
      const stopped = Promise.withResolvers<string | undefined>();
      handle.onControlEvent((event) => {
        if (event.type === "movement_stopped") stopped.resolve(event.reason);
      });
      handle.goTo({ guid: BigInt(targetGuid), kind: "guid" });
      expect(handle.getNavigationState()).toMatchObject({
        active: true,
        target: BigInt(targetGuid),
      });
      const outOfRange = new PacketWriter();
      outOfRange.uint32LE(1);
      outOfRange.uint8(UpdateType.OUT_OF_RANGE);
      outOfRange.uint32LE(1);
      writePackedGuid(outOfRange, BigInt(targetGuid));
      f.inject(GameOpcode.SMSG_UPDATE_OBJECT, outOfRange.finish());
      expect(await bounded(stopped.promise)).toBe("target_lost");
      expect(handle.getNavigationState()).toMatchObject({
        active: false,
        blockedReason: "target_lost",
        refusal: "stop",
      });
    } finally {
      try {
        await disposeFixture(f);
      } finally {
        nav.mockRestore();
      }
    }
  });
  test("server close silently retires an active route owner and its timers", async () => {
    const createNavigation = navigation.createNavigation;
    const nav = jest
      .spyOn(navigation, "createNavigation")
      .mockImplementation((options) =>
        createNavigation(options, () => flatMap()),
      );
    const send = jest.spyOn(worldHandlers, "sendPacket");
    let f: Fixture | undefined;
    try {
      jest.useFakeTimers();
      f = await fixture(21);
      f.handle.goTo({ kind: "point", x: 21, y: 2, z: 3 });
      expect(f.handle.getControlState()).toMatchObject({
        moving: true,
        owner: "manual",
      });
      expect(f.handle.getNavigationState().active).toBe(true);
      expect(
        send.mock.calls.some(
          ([, opcode]) => opcode === GameOpcode.MSG_MOVE_START_FORWARD,
        ),
      ).toBe(true);
      send.mockClear();
      send.mockImplementation(() => {});
      f.stop();
      await expect(bounded(f.handle.closed)).resolves.toBeUndefined();
      expect(f.handle.getControlState()).toMatchObject({
        moving: false,
        owner: "none",
      });
      expect(f.handle.getNavigationState().active).toBe(false);
      expect(f.handle.getTacticsState().status).toBe("idle");
      const duringClose = send.mock.calls.map(([, opcode]) => opcode);
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
      expect(f.handle.getControlState()).toMatchObject({
        moving: false,
        owner: "none",
      });
      expect(f.handle.getNavigationState().active).toBe(false);
      expect(f.handle.getTacticsState().status).toBe("idle");
      expect(duringClose).toEqual([]);
      expect(send.mock.calls.map(([, opcode]) => opcode)).toEqual([]);
    } finally {
      try {
        await disposeFixture(f);
      } finally {
        jest.useRealTimers();
        send.mockRestore();
        nav.mockRestore();
      }
    }
  });

  test("server close cannot halt-packet through an active Jev owner or its pending provider work", async () => {
    const spells = jest
      .spyOn(spellData, "loadSpellCatalog")
      .mockResolvedValue(emptySpells());
    const factions = jest
      .spyOn(factionData, "loadFactionTemplates")
      .mockResolvedValue(
        new factionData.FactionTemplateCatalog(
          emptyDbc("FactionTemplate.dbc", 14),
        ),
      );
    const requested = Promise.withResolvers<void>();
    const provider = jest
      .spyOn(jev, "selectJevAction")
      .mockImplementation((_request, options) => {
        requested.resolve();
        return new Promise<jev.JevActionResult>((_resolve, reject) => {
          if (options.signal.aborted) reject(options.signal.reason);
          else
            options.signal.addEventListener(
              "abort",
              () => reject(options.signal.reason),
              { once: true },
            );
        });
      });
    let control: ControlRuntime | undefined;
    const setMode = ControlRuntime.prototype.setMode;
    const capture = jest
      .spyOn(ControlRuntime.prototype, "setMode")
      .mockImplementation(function (
        this: ControlRuntime,
        mode: ControlMode,
      ): void {
        setMode.call(this, mode);
        if (mode === "jev") control = this;
      });
    const send = jest.spyOn(worldHandlers, "sendPacket");
    let f: Fixture | undefined;
    try {
      jest.useFakeTimers();
      f = await fixture(3);
      const running = f.handle.startTactics(
        BigInt(targetGuid),
        "Hold this observed hostile target",
      );
      await bounded(requested.promise);
      capture.mockRestore();
      if (!control) throw new Error("Jev activation did not acquire control");
      control.move("forward", 10_000);
      expect(f.handle.getTacticsState().status).toBe("active");
      expect(f.handle.getControlState()).toMatchObject({
        moving: true,
        owner: "jev",
      });
      expect(
        send.mock.calls.some(
          ([, opcode]) => opcode === GameOpcode.MSG_MOVE_START_FORWARD,
        ),
      ).toBe(true);
      send.mockClear();
      send.mockImplementation(() => {});
      f.stop();
      await expect(bounded(f.handle.closed)).resolves.toBeUndefined();
      await expect(bounded(running)).resolves.toBeUndefined();
      expect(f.handle.getControlState()).toMatchObject({
        moving: false,
        owner: "none",
      });
      expect(f.handle.getNavigationState().active).toBe(false);
      expect(f.handle.getTacticsState().status).toBe("idle");
      const duringClose = send.mock.calls.map(([, opcode]) => opcode);
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
      expect(f.handle.getControlState()).toMatchObject({
        moving: false,
        owner: "none",
      });
      expect(f.handle.getNavigationState().active).toBe(false);
      expect(f.handle.getTacticsState().status).toBe("idle");
      expect(duringClose).toEqual([]);
      expect(send.mock.calls.map(([, opcode]) => opcode)).toEqual([]);
    } finally {
      try {
        await disposeFixture(f);
      } finally {
        jest.useRealTimers();
        send.mockRestore();
        capture.mockRestore();
        provider.mockRestore();
        factions.mockRestore();
        spells.mockRestore();
      }
    }
  });
});

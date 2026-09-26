import { describe, expect, jest, test } from "bun:test";
import {
  ARENA_TRAINER_LIST,
  BOUGHT_FORTITUDE,
  FORTITUDE_NO_MONEY,
  LIST_ARENA,
  MATRON_ARENA,
} from "test/trainer-fixtures";
import type { Entity } from "wow/entity-store";
import { ObjectType, UNIT_FIELDS } from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketReader } from "wow/protocol/packet";
import {
  parseTrainerBuyFailed,
  parseTrainerBuySucceeded,
  parseTrainerList,
} from "wow/protocol/trainer";
import { TRAINER_ANSWER_MS, TrainerRuntime } from "wow/trainer";

const COINAGE = 0x4_92;

function entity(guid: bigint, objectType: ObjectType, fields: number[][]) {
  return {
    guid,
    objectType,
    entry: 0,
    scale: 1,
    position: undefined,
    rawFields: new Map(fields.map(([k = 0, v = 0]) => [k, v])),
    name: undefined,
    createComplete: true,
  } as Entity;
}

function fixture(npcFlags = 51) {
  const self = entity(1n, ObjectType.PLAYER, [
    [0x18, 51],
    [UNIT_FIELDS.LEVEL.offset, 1],
    [COINAGE, 100],
  ]);
  const arena = { ...entity(MATRON_ARENA, ObjectType.UNIT, []), npcFlags };
  const entities = new Map<bigint, Entity>([
    [1n, self],
    [MATRON_ARENA, arena],
  ]);
  const learned = [585, 2050];
  const sent: { opcode: number; body: Uint8Array | undefined }[] = [];
  const runtime = new TrainerRuntime({
    send: (opcode, body) => sent.push({ opcode, body }),
    now: () => 1000,
    selfGuid: () => 1n,
    getEntity: (guid) => entities.get(guid),
    learned: () => learned,
  });
  const types: string[] = [];
  runtime.onEvent((event) => types.push(event.type));
  const listed = () => {
    runtime.list(MATRON_ARENA);
    runtime.receiveList(parseTrainerList(new PacketReader(ARENA_TRAINER_LIST)));
  };
  const coinage = (value: number) => {
    self.rawFields.set(COINAGE, value);
    runtime.observe();
  };
  return { runtime, self, learned, sent, types, listed, coinage };
}

describe("trainer offer", () => {
  test("lists an observed trainer and labels each spell for this level", () => {
    const f = fixture();
    f.listed();
    expect(f.sent).toEqual([
      { opcode: GameOpcode.CMSG_TRAINER_LIST, body: LIST_ARENA },
    ]);
    const state = f.runtime.snapshot();
    expect(state.offer?.spells.map((s) => [s.spellId, s.state])).toEqual([
      [17, "too_low"],
      [589, "too_low"],
      [591, "too_low"],
      [1243, "available"],
      [2052, "too_low"],
    ]);
    expect(state.lastOutcome).toMatchObject({
      action: "list",
      status: "confirmed",
    });
    f.self.rawFields.set(UNIT_FIELDS.LEVEL.offset, 6);
    const at6 = f.runtime.snapshot().offer?.spells;
    expect(at6?.find((s) => s.spellId === 591)?.state).toBe("unavailable");
  });

  test("a list opened from gossip needs no request, and non-trainers are refused", () => {
    const f = fixture(0x03);
    f.runtime.receiveList(
      parseTrainerList(new PacketReader(ARENA_TRAINER_LIST)),
    );
    expect(f.runtime.snapshot().offer?.guid).toBe(MATRON_ARENA);
    expect(f.types).toEqual(["listed"]);
    expect(() => f.runtime.list(MATRON_ARENA)).toThrow(
      "not an observed trainer",
    );
  });
});

describe("learning a spell", () => {
  test("is confirmed by the server, the learned spell and the paid cost", () => {
    const f = fixture();
    f.listed();
    f.runtime.train(1243);
    f.runtime.receiveSucceeded(
      parseTrainerBuySucceeded(new PacketReader(BOUGHT_FORTITUDE)),
    );
    expect(f.runtime.snapshot().pending?.action).toBe("train");
    f.learned.push(1243);
    f.runtime.observe();
    expect(f.runtime.snapshot().pending).toBeDefined();
    f.coinage(91);
    const state = f.runtime.snapshot();
    expect(state.lastOutcome).toMatchObject({
      status: "confirmed",
      learnedSpells: [1243],
      coinageAfter: 91,
      moneyDelta: -9,
    });
    expect(state.offer?.spells.find((s) => s.spellId === 1243)?.state).toBe(
      "known",
    );
    expect(f.types.at(-1)).toBe("trained");
    expect(() => f.runtime.train(1243)).toThrow("Spell is known");
  });

  test("unoffered and unavailable spells are refused locally", () => {
    const f = fixture();
    expect(() => f.runtime.train(1243)).toThrow("No listed trainer");
    f.listed();
    expect(() => f.runtime.train(139)).toThrow("not offered");
    expect(() => f.runtime.train(589)).toThrow("Spell is too_low");
  });

  test("a server refusal is named and silence ends unanswered", () => {
    jest.useFakeTimers();
    try {
      const f = fixture();
      f.listed();
      f.runtime.train(1243);
      f.runtime.receiveFailed(
        parseTrainerBuyFailed(new PacketReader(FORTITUDE_NO_MONEY)),
      );
      expect(f.runtime.snapshot().lastOutcome).toMatchObject({
        status: "refused",
        reason: "not_enough_money",
        learnedSpells: [],
      });
      f.runtime.train(1243);
      jest.advanceTimersByTime(TRAINER_ANSWER_MS);
      expect(f.runtime.snapshot().lastOutcome).toMatchObject({
        status: "unanswered",
        reason: "server_unanswered",
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

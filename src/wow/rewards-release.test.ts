import { describe, expect, test } from "bun:test";
import { bytes } from "test/hex";
import type { Entity } from "wow/entity-store";
import { ObjectType } from "wow/protocol/entity-fields";
import {
  parseLootReleaseResponse,
  parseLootRemoved,
  parseLootResponse,
} from "wow/protocol/loot";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketReader } from "wow/protocol/packet";
import { type RewardsEvent, RewardsRuntime } from "wow/rewards";

const corpse = 0xf1_30_00_3b_aa_07_46_55n;

const twoItems = `
  554607aa3b0030f1 01 00000000 02
  00 10520000 01000000 43380000 00000000 00000000 04
  01 6e510000 01000000 690c0000 00000000 00000000 04
`;
const itemAndMoney = `
  554607aa3b0030f1 01 07000000 01
  00 10520000 01000000 43380000 00000000 00000000 04
`;
const released = "554607aa3b0030f1 01";

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

function opened(offer: string) {
  const entities = new Map([
    [1n, unit(1n, [[0x18, 100]])],
    [corpse, unit(corpse, [[0x4f, 1]])],
  ]);
  const sent: { opcode: number; body: Uint8Array | undefined }[] = [];
  const events: RewardsEvent["type"][] = [];
  const runtime = new RewardsRuntime({
    getEntity: (guid) => entities.get(guid),
    now: () => 1000,
    selfGuid: () => 1n,
    send: (opcode, body) => {
      sent.push({ body, opcode });
    },
  });
  runtime.onEvent((event) => events.push(event.type));
  runtime.open(corpse);
  runtime.receiveLootResponse(
    parseLootResponse(new PacketReader(bytes(offer))),
  );
  sent.length = 0;
  events.length = 0;
  const removed = (hex: string) =>
    runtime.receiveLootRemoved(parseLootRemoved(new PacketReader(bytes(hex))));
  return { events, removed, runtime, sent };
}

const release = {
  body: bytes("554607aa3b0030f1"),
  opcode: GameOpcode.CMSG_LOOT_RELEASE,
};

describe("automatic loot release", () => {
  test("removing the last item sends one release and closes on the reply", () => {
    const f = opened(twoItems);
    f.runtime.take(0);
    f.removed("00");
    f.runtime.take(1);
    f.removed("01");
    expect(f.sent.filter((s) => s.opcode === release.opcode)).toEqual([
      release,
    ]);
    expect(f.events.slice(-2)).toEqual([
      "loot_removed",
      "loot_close_requested",
    ]);
    expect(f.runtime.snapshot().pending).toMatchObject({ action: "close" });
    f.runtime.receiveLootRelease(
      parseLootReleaseResponse(new PacketReader(bytes(released))),
    );
    expect(f.runtime.snapshot().loot.phase).toBe("closed");
  });

  test("a partial take leaves the window open", () => {
    const f = opened(twoItems);
    f.runtime.take(0);
    f.removed("00");
    expect(f.sent.map((s) => s.opcode)).toEqual([
      GameOpcode.CMSG_AUTOSTORE_LOOT_ITEM,
    ]);
    expect(f.runtime.snapshot().loot.phase).toBe("open");
  });

  test("offered money keeps the window open until it is cleared", () => {
    const f = opened(itemAndMoney);
    f.runtime.take(0);
    f.removed("00");
    expect(f.runtime.snapshot().loot.phase).toBe("open");
    f.runtime.takeMoney();
    f.runtime.receiveLootMoneyCleared();
    expect(f.sent.at(-1)).toEqual(release);
    expect(f.runtime.snapshot().loot.phase).toBe("closing");
  });

  test("release-loot after an automatic release sends nothing more", () => {
    const f = opened(twoItems);
    f.runtime.take(0);
    f.removed("00");
    f.runtime.take(1);
    f.removed("01");
    const sent = f.sent.length;
    expect(f.runtime.close().loot.phase).toBe("closing");
    f.runtime.receiveLootRelease(
      parseLootReleaseResponse(new PacketReader(bytes(released))),
    );
    expect(f.runtime.close().loot.phase).toBe("closed");
    expect(f.sent.length).toBe(sent);
  });
});

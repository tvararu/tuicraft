import { describe, expect, test } from "bun:test";
import { startMockWorldServer } from "#test-support/mock-world-server";
import {
  base,
  fakeAuth,
  waitForDuelEvents,
  waitForEchoProbe,
} from "#test-support/world-handlers-fixtures";
import { type DuelEvent, worldSession } from "#wow/client";
import { GameOpcode } from "#wow/protocol/opcodes";
import { PacketReader, PacketWriter } from "#wow/protocol/packet";

describe("world handler tests", () => {
  test("duel opcodes emit expected duel events", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const received = waitForDuelEvents(handle, 6);

      const requested = new PacketWriter();
      requested.uint64LE(100n);
      requested.uint64LE(200n);
      ws.inject(GameOpcode.SMSG_DUEL_REQUESTED, requested.finish());

      const countdown = new PacketWriter();
      countdown.uint32LE(3000);
      ws.inject(GameOpcode.SMSG_DUEL_COUNTDOWN, countdown.finish());

      ws.inject(GameOpcode.SMSG_DUEL_OUTOFBOUNDS, new Uint8Array(0));
      ws.inject(GameOpcode.SMSG_DUEL_INBOUNDS, new Uint8Array(0));

      const complete = new PacketWriter();
      complete.uint8(1);
      ws.inject(GameOpcode.SMSG_DUEL_COMPLETE, complete.finish());

      const winner = new PacketWriter();
      winner.uint8(0);
      winner.cString("Loser");
      winner.cString("Winner");
      ws.inject(GameOpcode.SMSG_DUEL_WINNER, winner.finish());

      const events = await received;
      expect(events.map((e) => e.type)).toEqual([
        "duel_requested",
        "duel_countdown",
        "duel_out_of_bounds",
        "duel_in_bounds",
        "duel_complete",
        "duel_winner",
      ]);

      const req = events[0] as { type: "duel_requested"; challenger: string };
      expect(req.challenger).toBe("Unknown");

      const cd = events[1] as { type: "duel_countdown"; timeMs: number };
      expect(cd.timeMs).toBe(3000);

      const win = events[5] as {
        type: "duel_winner";
        reason: string;
        winner: string;
        loser: string;
      };
      expect(win.reason).toBe("won");
      expect(win.winner).toBe("Winner");
      expect(win.loser).toBe("Loser");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("SMSG_DUEL_REQUESTED resolves name from nameCache", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const duelEvent = new Promise<DuelEvent>((resolve) =>
        handle.onDuelEvent(resolve),
      );

      const nameResp = new PacketWriter();
      nameResp.uint8(0x01);
      nameResp.uint8(0x2a);
      nameResp.uint8(0);
      nameResp.cString("Arthas");
      nameResp.cString("");
      nameResp.uint32LE(1);
      nameResp.uint32LE(0);
      nameResp.uint32LE(1);
      ws.inject(GameOpcode.SMSG_NAME_QUERY_RESPONSE, nameResp.finish());

      await Bun.sleep(1);

      const requested = new PacketWriter();
      requested.uint64LE(42n);
      requested.uint64LE(200n);
      ws.inject(GameOpcode.SMSG_DUEL_REQUESTED, requested.finish());

      const event = await duelEvent;
      expect(event.type).toBe("duel_requested");
      if (event.type === "duel_requested") {
        expect(event.challenger).toBe("Arthas");
      }

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("context-aware accept sends CMSG_DUEL_ACCEPTED after duel request", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const duelEvent = new Promise<DuelEvent>((resolve) =>
        handle.onDuelEvent(resolve),
      );

      const requested = new PacketWriter();
      requested.uint64LE(100n);
      requested.uint64LE(200n);
      ws.inject(GameOpcode.SMSG_DUEL_REQUESTED, requested.finish());
      await duelEvent;

      const sent = ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_DUEL_ACCEPTED,
      );
      handle.acceptInvite();
      const packet = await sent;
      const r = new PacketReader(packet.body);
      expect(r.uint64LE()).toBe(200n);

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("context-aware decline sends CMSG_DUEL_CANCELLED after duel request", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const duelEvent = new Promise<DuelEvent>((resolve) =>
        handle.onDuelEvent(resolve),
      );

      const requested = new PacketWriter();
      requested.uint64LE(100n);
      requested.uint64LE(200n);
      ws.inject(GameOpcode.SMSG_DUEL_REQUESTED, requested.finish());
      await duelEvent;

      const sent = ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_DUEL_CANCELLED,
      );
      handle.declineInvite();
      const packet = await sent;
      const r = new PacketReader(packet.body);
      expect(r.uint64LE()).toBe(200n);

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });
});

import { test, expect, describe } from "bun:test";
import { PacketWriter, PacketReader } from "wow/protocol/packet";
import {
  parseDuelRequested,
  parseDuelCountdown,
  parseDuelComplete,
  parseDuelWinner,
  buildDuelAccepted,
  buildDuelCancelled,
} from "wow/protocol/duel";

describe("duel protocol", () => {
  test("parseDuelRequested reads initiator and arbiter GUIDs", () => {
    const w = new PacketWriter();
    w.uint64LE(100n);
    w.uint64LE(200n);
    const result = parseDuelRequested(new PacketReader(w.finish()));
    expect(result.initiator).toBe(100n);
    expect(result.arbiter).toBe(200n);
  });

  test("parseDuelCountdown reads time in ms", () => {
    const w = new PacketWriter();
    w.uint32LE(3000);
    const result = parseDuelCountdown(new PacketReader(w.finish()));
    expect(result.timeMs).toBe(3000);
  });

  test("parseDuelComplete reads completed flag", () => {
    const w = new PacketWriter();
    w.uint8(1);
    expect(parseDuelComplete(new PacketReader(w.finish())).completed).toBe(
      true,
    );

    const w2 = new PacketWriter();
    w2.uint8(0);
    expect(parseDuelComplete(new PacketReader(w2.finish())).completed).toBe(
      false,
    );
  });

  test("parseDuelWinner reads reason and names", () => {
    const w = new PacketWriter();
    w.uint8(0);
    w.cString("Loser");
    w.cString("Winner");
    const result = parseDuelWinner(new PacketReader(w.finish()));
    expect(result.reason).toBe("won");
    expect(result.loser).toBe("Loser");
    expect(result.winner).toBe("Winner");
  });

  test("parseDuelWinner with fled reason", () => {
    const w = new PacketWriter();
    w.uint8(1);
    w.cString("Quitter");
    w.cString("Stayer");
    const result = parseDuelWinner(new PacketReader(w.finish()));
    expect(result.reason).toBe("fled");
    expect(result.loser).toBe("Quitter");
    expect(result.winner).toBe("Stayer");
  });

  test("buildDuelAccepted writes arbiter GUID", () => {
    const buf = buildDuelAccepted(42n);
    const r = new PacketReader(buf);
    expect(r.uint64LE()).toBe(42n);
  });

  test("buildDuelCancelled writes arbiter GUID", () => {
    const buf = buildDuelCancelled(99n);
    const r = new PacketReader(buf);
    expect(r.uint64LE()).toBe(99n);
  });
});

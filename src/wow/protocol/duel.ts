import { PacketReader, PacketWriter } from "wow/protocol/packet";

export type DuelRequested = {
  initiator: bigint;
  arbiter: bigint;
};

export type DuelCountdown = {
  timeMs: number;
};

export type DuelComplete = {
  completed: boolean;
};

export type DuelWinner = {
  reason: "won" | "fled";
  loser: string;
  winner: string;
};

export function parseDuelRequested(r: PacketReader): DuelRequested {
  return {
    initiator: r.uint64LE(),
    arbiter: r.uint64LE(),
  };
}

export function parseDuelCountdown(r: PacketReader): DuelCountdown {
  return { timeMs: r.uint32LE() };
}

export function parseDuelComplete(r: PacketReader): DuelComplete {
  return { completed: r.uint8() !== 0 };
}

export function parseDuelWinner(r: PacketReader): DuelWinner {
  const reason = r.uint8() === 0 ? "won" : "fled";
  const loser = r.cString();
  const winner = r.cString();
  return { reason, loser, winner } as const;
}

export function buildDuelAccepted(arbiter: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(arbiter);
  return w.finish();
}

export function buildDuelCancelled(arbiter: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(arbiter);
  return w.finish();
}

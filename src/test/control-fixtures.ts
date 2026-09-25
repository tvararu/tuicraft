import { jest } from "bun:test";
import { must } from "test/must";
import {
  type ControlDeps,
  type ControlEvent,
  ControlRuntime,
} from "wow/control";
import {
  type MovementInfo,
  parseMovementInfo,
  speedAckFor,
} from "wow/protocol/movement";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketReader } from "wow/protocol/packet";
export type Sent = { opcode: number; body: Uint8Array };

export const LOGIN = {
  mapId: 530,
  orientation: 0.5,
  x: 8709.46,
  y: -6671.76,
  z: 70.34,
};

export const RUN_SPEED = must(
  speedAckFor(GameOpcode.SMSG_FORCE_RUN_SPEED_CHANGE),
);

export function info(over: Partial<MovementInfo> = {}): MovementInfo {
  return {
    extraFlags: 0,
    fallTime: 0,
    flags: 0,
    orientation: 0,
    time: 1,
    x: 10,
    y: 20,
    z: 30,
    ...over,
  };
}

export function setup(over: Partial<ControlDeps> = {}): {
  runtime: ControlRuntime;
  sent: Sent[];
  events: ControlEvent[];
  advance: (ms: number) => void;
} {
  const sent: Sent[] = [];
  const events: ControlEvent[] = [];
  let now = 10_000;
  const deps: ControlDeps = {
    findHeight: (_mapId, _x, _y, from) => from?.z ?? 70.34,
    isPathClear: () => false,
    now: () => now,
    selfGuid: () => 0x0764n,
    send: (opcode, body) =>
      sent.push({ body: body ?? new Uint8Array(), opcode }),
    ticks: () => now - 10_000,
    ...over,
  };
  const runtime = new ControlRuntime(deps);
  runtime.onEvent((event) => events.push(event));
  runtime.loginVerified(LOGIN);
  runtime.observeSelf({
    position: {
      mapId: 530,
      orientation: 0.5,
      x: 8709.46,
      y: -6671.76,
      z: 70.34,
    },
    runBackSpeed: 4.5,
    runSpeed: 7,
  });
  return {
    advance: (ms) => {
      now += ms;
      jest.advanceTimersByTime(ms);
    },
    events,
    runtime,
    sent,
  };
}

export function lastMove(sent: Sent[]): {
  opcode: number;
  flags: number;
  x: number;
  y: number;
} {
  const packet = must(sent.at(-1));
  const r = new PacketReader(packet.body);
  r.packedGuid();
  const parsed = parseMovementInfo(r);
  return {
    flags: parsed.flags,
    opcode: packet.opcode,
    x: parsed.x,
    y: parsed.y,
  };
}

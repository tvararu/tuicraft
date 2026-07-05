import { GameOpcode } from "wow/protocol/opcodes";
import { MovementFlag, ObjectType } from "wow/protocol/entity-fields";
import { buildMoveMessage } from "wow/protocol/movement";
import { currentMovementInfo } from "wow/movement-handlers";
import { sendPacket, selfGuid } from "wow/world-handlers";
import type { WorldConn } from "wow/client";

export type MoveEvent =
  | { type: "move_started"; x: number; y: number; z: number }
  | { type: "follow_started"; name: string }
  | { type: "progress"; x: number; y: number; z: number; remaining: number }
  | { type: "arrived"; x: number; y: number; z: number }
  | {
      type: "move_stopped";
      reason: "command" | "root" | "teleport" | "target_lost";
    };

export type MoveState =
  | { kind: "idle" }
  | { kind: "moving"; x: number; y: number; z: number }
  | { kind: "following"; name: string };

export type MovementEngine = {
  moveTo(x: number, y: number, z: number): void;
  follow(name: string): boolean;
  face(orientation: number): void;
  stop(): void;
  state(): MoveState;
  dispose(): void;
};

export type EngineOpts = {
  tickMs?: number;
  heartbeatMs?: number;
  progressMs?: number;
};

const TWO_PI = Math.PI * 2;
const FACING_EPSILON = 0.05;
const FOLLOW_STOP_DISTANCE = 4;
const FOLLOW_RESUME_DISTANCE = 5;

function normalizeOrientation(o: number): number {
  return ((o % TWO_PI) + TWO_PI) % TWO_PI;
}

function angleDiff(a: number, b: number): number {
  const d = normalizeOrientation(a - b);
  return d > Math.PI ? d - TWO_PI : d;
}

export function createMovementEngine(
  conn: WorldConn,
  emit: (event: MoveEvent) => void,
  opts: EngineOpts = {},
): MovementEngine {
  const tickMs = opts.tickMs ?? 100;
  const heartbeatMs = opts.heartbeatMs ?? 500;
  const progressMs = opts.progressMs ?? 2000;

  type Target = { x: number; y: number; z: number };
  let mode:
    | { kind: "idle" }
    | { kind: "goto"; target: Target }
    | {
        kind: "follow";
        guid: bigint;
        name: string;
        walking: boolean;
      } = { kind: "idle" };
  let lastHeartbeat = 0;
  let lastProgress = 0;

  function sendMove(opcode: number): void {
    sendPacket(
      conn,
      opcode,
      buildMoveMessage(
        conn.selfGuidLow,
        conn.selfGuidHigh,
        currentMovementInfo(conn),
      ),
    );
  }

  function startForward(target: Target): void {
    conn.own.orientation = normalizeOrientation(
      Math.atan2(target.y - conn.own.y, target.x - conn.own.x),
    );
    conn.own.moveFlags |= MovementFlag.FORWARD;
    sendMove(GameOpcode.MSG_MOVE_START_FORWARD);
    lastHeartbeat = conn.ticks();
    lastProgress = conn.ticks();
  }

  function stopForward(): void {
    conn.own.moveFlags &= ~MovementFlag.FORWARD;
    sendMove(GameOpcode.MSG_MOVE_STOP);
    conn.entityStore.setPosition(selfGuid(conn), {
      mapId: conn.own.mapId,
      x: conn.own.x,
      y: conn.own.y,
      z: conn.own.z,
      orientation: conn.own.orientation,
    });
  }

  function halt(reason: "command" | "root" | "teleport" | "target_lost"): void {
    const wasMoving = (conn.own.moveFlags & MovementFlag.FORWARD) !== 0;
    mode = { kind: "idle" };
    if (wasMoving && reason !== "teleport" && reason !== "root") {
      stopForward();
    } else {
      conn.own.moveFlags &= ~MovementFlag.FORWARD;
    }
    emit({ type: "move_stopped", reason });
  }

  function advance(target: Target): "arrived" | "moving" {
    const dx = target.x - conn.own.x;
    const dy = target.y - conn.own.y;
    const dz = target.z - conn.own.z;
    const dist = Math.hypot(dx, dy, dz);
    const step = conn.own.runSpeed * (tickMs / 1000);

    if (dist <= step) {
      conn.own.x = target.x;
      conn.own.y = target.y;
      conn.own.z = target.z;
      stopForward();
      return "arrived";
    }

    const heading = normalizeOrientation(Math.atan2(dy, dx));
    if (Math.abs(angleDiff(heading, conn.own.orientation)) > FACING_EPSILON) {
      conn.own.orientation = heading;
      sendMove(GameOpcode.MSG_MOVE_SET_FACING);
    }

    const scale = step / dist;
    conn.own.x += dx * scale;
    conn.own.y += dy * scale;
    conn.own.z += dz * scale;

    const now = conn.ticks();
    if (now - lastHeartbeat >= heartbeatMs) {
      lastHeartbeat = now;
      sendMove(GameOpcode.MSG_MOVE_HEARTBEAT);
    }
    if (now - lastProgress >= progressMs) {
      lastProgress = now;
      emit({
        type: "progress",
        x: conn.own.x,
        y: conn.own.y,
        z: conn.own.z,
        remaining: dist - step,
      });
    }
    return "moving";
  }

  function followTick(state: {
    kind: "follow";
    guid: bigint;
    name: string;
    walking: boolean;
  }): void {
    const entity = conn.entityStore.get(state.guid);
    if (!entity?.position) {
      halt("target_lost");
      return;
    }
    const dist = Math.hypot(
      entity.position.x - conn.own.x,
      entity.position.y - conn.own.y,
      entity.position.z - conn.own.z,
    );

    if (!state.walking) {
      if (dist > FOLLOW_RESUME_DISTANCE) {
        state.walking = true;
        startForward(entity.position);
      }
      return;
    }

    if (dist <= FOLLOW_STOP_DISTANCE) {
      state.walking = false;
      stopForward();
      return;
    }
    advance(entity.position);
  }

  function tick(): void {
    if (mode.kind === "idle") return;
    if (conn.own.moveFlags & MovementFlag.ROOT) {
      halt("root");
      return;
    }
    if (mode.kind === "goto") {
      const target = mode.target;
      if (advance(target) === "arrived") {
        mode = { kind: "idle" };
        emit({ type: "arrived", x: target.x, y: target.y, z: target.z });
      }
      return;
    }
    followTick(mode);
  }

  const interval = setInterval(tick, tickMs);

  conn.onOwnTeleport = () => {
    if (mode.kind !== "idle") halt("teleport");
  };

  return {
    moveTo(x, y, z) {
      mode = { kind: "goto", target: { x, y, z } };
      startForward({ x, y, z });
      emit({ type: "move_started", x, y, z });
    },
    follow(name) {
      const lower = name.toLowerCase();
      const entity = conn.entityStore
        .all()
        .find(
          (e) =>
            (e.objectType === ObjectType.PLAYER ||
              e.objectType === ObjectType.UNIT) &&
            e.name?.toLowerCase() === lower &&
            e.position,
        );
      if (!entity) return false;
      mode = {
        kind: "follow",
        guid: entity.guid,
        name: entity.name ?? name,
        walking: false,
      };
      emit({ type: "follow_started", name: entity.name ?? name });
      return true;
    },
    face(orientation) {
      conn.own.orientation = normalizeOrientation(orientation);
      sendMove(GameOpcode.MSG_MOVE_SET_FACING);
    },
    stop() {
      if (mode.kind === "idle") return;
      halt("command");
    },
    state() {
      if (mode.kind === "goto") {
        return {
          kind: "moving",
          x: mode.target.x,
          y: mode.target.y,
          z: mode.target.z,
        };
      }
      if (mode.kind === "follow") {
        return { kind: "following", name: mode.name };
      }
      return { kind: "idle" };
    },
    dispose() {
      clearInterval(interval);
      conn.onOwnTeleport = undefined;
    },
  };
}

import { GameOpcode } from "wow/protocol/opcodes";
import { MovementFlag, ObjectType } from "wow/protocol/entity-fields";
import { buildMoveMessage } from "wow/protocol/movement";
import { currentMovementInfo } from "wow/movement-handlers";
import { sendPacket, selfGuid } from "wow/world-handlers";
import type { NavProvider, NavRoute } from "nav/provider";
import type { WorldConn } from "wow/client";

export type MoveEvent =
  | { type: "move_started"; x: number; y: number; z: number; waypoints: number }
  | { type: "follow_started"; name: string }
  | { type: "progress"; x: number; y: number; z: number; remaining: number }
  | { type: "arrived"; x: number; y: number; z: number }
  | {
      type: "move_stopped";
      reason: "command" | "root" | "teleport" | "target_lost" | "no_path";
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
  nav?: NavProvider;
};

const TWO_PI = Math.PI * 2;
const FACING_EPSILON = 0.05;
const FOLLOW_STOP_DISTANCE = 4;
const FOLLOW_RESUME_DISTANCE = 5;
const FOLLOW_REPATH_DISTANCE = 2;

type Target = { x: number; y: number; z: number };

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

  let mode:
    | { kind: "idle" }
    | { kind: "goto"; final: Target; queue: Target[]; route?: NavRoute }
    | {
        kind: "follow";
        guid: bigint;
        name: string;
        queue: Target[];
        pathedDest?: Target;
        walking: boolean;
        route?: NavRoute;
      } = { kind: "idle" };
  let lastHeartbeat = 0;
  let lastProgress = 0;

  function routeForCurrentMap(): NavRoute | undefined {
    return opts.nav?.forMap(conn.own.mapId);
  }

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

  function computeQueue(
    route: NavRoute | undefined,
    target: Target,
  ): Target[] | undefined {
    if (!route) return [target];
    const path = route.findPath(
      { x: conn.own.x, y: conn.own.y, z: conn.own.z },
      target,
    );
    if (!path) return undefined;
    const queue = path.length > 1 ? path.slice(1) : [...path];
    return queue.length > 0 ? queue : [target];
  }

  function startForward(leg: Target): void {
    conn.own.orientation = normalizeOrientation(
      Math.atan2(leg.y - conn.own.y, leg.x - conn.own.x),
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

  function halt(
    reason: "command" | "root" | "teleport" | "target_lost" | "no_path",
  ): void {
    const wasMoving = (conn.own.moveFlags & MovementFlag.FORWARD) !== 0;
    mode = { kind: "idle" };
    if (wasMoving && reason !== "teleport" && reason !== "root") {
      stopForward();
    } else {
      conn.own.moveFlags &= ~MovementFlag.FORWARD;
    }
    emit({ type: "move_stopped", reason });
  }

  function remainingDistance(queue: Target[]): number {
    let total = 0;
    let px = conn.own.x;
    let py = conn.own.y;
    let pz = conn.own.z;
    for (const wp of queue) {
      total += Math.hypot(wp.x - px, wp.y - py, wp.z - pz);
      px = wp.x;
      py = wp.y;
      pz = wp.z;
    }
    return total;
  }

  function advance(leg: Target, route: NavRoute | undefined): boolean {
    const dx = leg.x - conn.own.x;
    const dy = leg.y - conn.own.y;
    const dz = leg.z - conn.own.z;
    const dist = Math.hypot(dx, dy, dz);
    const step = conn.own.runSpeed * (tickMs / 1000);

    if (dist <= step) {
      conn.own.x = leg.x;
      conn.own.y = leg.y;
      conn.own.z = leg.z;
      return true;
    }

    const heading = normalizeOrientation(Math.atan2(dy, dx));
    if (Math.abs(angleDiff(heading, conn.own.orientation)) > FACING_EPSILON) {
      conn.own.orientation = heading;
      sendMove(GameOpcode.MSG_MOVE_SET_FACING);
    }

    const scale = step / dist;
    const fromX = conn.own.x;
    const fromY = conn.own.y;
    const fromZ = conn.own.z;
    conn.own.x += dx * scale;
    conn.own.y += dy * scale;
    conn.own.z += dz * scale;
    if (route) {
      const ground = route.groundHeight(
        { x: fromX, y: fromY, z: fromZ },
        conn.own.x,
        conn.own.y,
      );
      if (ground !== undefined) conn.own.z = ground;
    }

    const now = conn.ticks();
    if (now - lastHeartbeat >= heartbeatMs) {
      lastHeartbeat = now;
      sendMove(GameOpcode.MSG_MOVE_HEARTBEAT);
    }
    return false;
  }

  function walkQueue(
    queue: Target[],
    route: NavRoute | undefined,
  ): "done" | "moving" {
    const leg = queue[0];
    if (!leg) return "done";
    if (advance(leg, route)) {
      queue.shift();
      if (queue.length === 0) {
        stopForward();
        return "done";
      }
      return "moving";
    }
    const now = conn.ticks();
    if (now - lastProgress >= progressMs) {
      lastProgress = now;
      emit({
        type: "progress",
        x: conn.own.x,
        y: conn.own.y,
        z: conn.own.z,
        remaining: remainingDistance(queue),
      });
    }
    return "moving";
  }

  function followTick(state: {
    kind: "follow";
    guid: bigint;
    name: string;
    queue: Target[];
    pathedDest?: Target;
    walking: boolean;
    route?: NavRoute;
  }): void {
    const entity = conn.entityStore.get(state.guid);
    if (!entity?.position) {
      halt("target_lost");
      return;
    }
    const pos = entity.position;
    const dist = Math.hypot(
      pos.x - conn.own.x,
      pos.y - conn.own.y,
      pos.z - conn.own.z,
    );

    if (!state.walking) {
      if (dist > FOLLOW_RESUME_DISTANCE) {
        const queue = computeQueue(state.route, pos) ?? [pos];
        state.queue = queue;
        state.pathedDest = { x: pos.x, y: pos.y, z: pos.z };
        state.walking = true;
        startForward(queue[0]!);
      }
      return;
    }

    if (dist <= FOLLOW_STOP_DISTANCE) {
      state.walking = false;
      state.queue = [];
      stopForward();
      return;
    }

    const dest = state.pathedDest;
    if (
      dest &&
      Math.hypot(pos.x - dest.x, pos.y - dest.y, pos.z - dest.z) >
        FOLLOW_REPATH_DISTANCE
    ) {
      state.queue = computeQueue(state.route, pos) ?? [pos];
      state.pathedDest = { x: pos.x, y: pos.y, z: pos.z };
    }

    if (walkQueue(state.queue, state.route) === "done") {
      state.walking = false;
    }
  }

  function tick(): void {
    if (mode.kind === "idle") return;
    if (conn.own.moveFlags & MovementFlag.ROOT) {
      halt("root");
      return;
    }
    if (mode.kind === "goto") {
      const { final, queue, route } = mode;
      if (walkQueue(queue, route) === "done") {
        mode = { kind: "idle" };
        emit({ type: "arrived", x: final.x, y: final.y, z: final.z });
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
      const route = routeForCurrentMap();
      const target = { x, y, z };
      const queue = computeQueue(route, target);
      if (!queue) {
        emit({ type: "move_stopped", reason: "no_path" });
        return;
      }
      mode = { kind: "goto", final: target, queue, route };
      startForward(queue[0]!);
      emit({ type: "move_started", x, y, z, waypoints: queue.length });
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
        queue: [],
        walking: false,
        route: routeForCurrentMap(),
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
          x: mode.final.x,
          y: mode.final.y,
          z: mode.final.z,
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

import type { CombatPose, CombatUnit } from "wow/combat";
import type { ControlEvent, ControlRuntime } from "wow/control";
import type { GroundRoute, Navigation, NavPoint } from "wow/navigation";

export type FollowState = {
  active: boolean;
  status: "idle" | "following" | "holding" | "stopped";
  guid: bigint | undefined;
  distance: number;
  separation: number | undefined;
  targetPose: CombatPose | undefined;
  observedAt: number | undefined;
  destination: NavPoint | undefined;
  startedAt: number | undefined;
  expiresAt: number | undefined;
  plans: number;
  attempts: number;
  reason: string | undefined;
};

export type FollowEvent = {
  type: "started" | "planned" | "holding" | "stopped";
  state: FollowState;
  at: number;
};

export type FollowDeps = {
  control: ControlRuntime;
  navigation: () => Navigation;
  target: (guid: bigint) => CombatUnit | undefined;
  now: () => number;
};

type ObservedTarget = { pose: CombatPose; observedAt: number };

const MAX_AGE_MS = 5_000;
const MAX_DURATION_MS = 30_000;
const MAX_ATTEMPTS = 32;
const MAX_RANGE = 100;
const MAX_ROUTE = 150;
const REPLAN_MS = 500;
const DISPLACEMENT = 1;
const GROUND_ERROR = 0.25;

export class FollowRuntime {
  private readonly deps: FollowDeps;
  private listener: ((event: FollowEvent) => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  private changing = false;
  private claiming = false;
  private generation = 0;
  private plannedTarget: CombatPose | undefined;
  private plannedAt = 0;
  private state: FollowState = {
    active: false,
    status: "idle",
    guid: undefined,
    distance: 3,
    separation: undefined,
    targetPose: undefined,
    observedAt: undefined,
    destination: undefined,
    startedAt: undefined,
    expiresAt: undefined,
    plans: 0,
    attempts: 0,
    reason: undefined,
  };

  constructor(deps: FollowDeps) {
    this.deps = deps;
  }

  snapshot(): FollowState {
    return {
      ...this.state,
      targetPose: this.state.targetPose
        ? { ...this.state.targetPose }
        : undefined,
      destination: this.state.destination
        ? { ...this.state.destination }
        : undefined,
    };
  }

  onEvent(callback: ((event: FollowEvent) => void) | undefined): void {
    this.listener = callback;
  }

  start(guid: bigint, distance = 3): void {
    if (this.disposed) throw new Error("follow_disposed");
    if (guid <= 0n || guid === this.deps.control.snapshot().selfGuid)
      throw new Error("invalid_follow_target");
    if (!Number.isFinite(distance) || distance < 1 || distance > 20)
      throw new Error("invalid_follow_distance");
    const previous = this.generation + Number(this.state.active);
    this.stop("replaced");
    if (this.generation !== previous || this.disposed) return;
    const now = this.deps.now();
    const generation = ++this.generation;
    this.state = {
      active: true,
      status: "following",
      guid,
      distance,
      separation: undefined,
      targetPose: undefined,
      observedAt: undefined,
      destination: undefined,
      startedAt: now,
      expiresAt: now + MAX_DURATION_MS,
      plans: 0,
      attempts: 0,
      reason: undefined,
    };
    try {
      const target = this.readTarget();
      this.claiming = true;
      try {
        this.deps.control.setMode("follow");
      } finally {
        this.claiming = false;
      }
      if (!this.state.active || this.generation !== generation) return;
      this.emit("started");
      if (!this.state.active || this.generation !== generation) return;
      this.plan(target);
      if (this.state.active && this.generation === generation)
        this.timer = setInterval(() => {
          if (this.generation === generation) this.tick();
        }, 100);
    } catch (error) {
      if (this.generation === generation) this.stop(errorReason(error));
      throw error;
    }
  }

  stop(reason: string): void {
    if (!this.state.active) return;
    this.generation++;
    this.state.active = false;
    this.state.status = "stopped";
    this.state.reason = reason;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.plannedTarget = undefined;
    const event: FollowEvent = {
      type: "stopped",
      state: this.snapshot(),
      at: this.deps.now(),
    };
    if (this.deps.control.snapshot().owner === "follow")
      this.deps.control.setMode("none");
    this.listener?.(event);
  }

  invalidateTarget(guid: bigint, reason: string): void {
    if (this.state.active && this.state.guid === guid) this.stop(reason);
  }

  observeControl(event: ControlEvent): void {
    if (!this.state.active) return;
    if (
      event.type === "server_correction" ||
      event.type === "control_error" ||
      !event.state.movementAllowed
    ) {
      this.stop(event.reason ?? event.state.blockedReason ?? event.type);
      return;
    }
    if (event.state.owner !== "follow") {
      this.stop("control_owner_changed");
      return;
    }
    if (this.claiming && event.reason === "mode_changed") return;
    if (event.type === "movement_stopped" && event.reason === "arrived") {
      this.hold();
      return;
    }
    if (this.changing && expectedTransition(event)) return;
    if (
      event.type === "movement_stopped" ||
      event.type === "movement_started" ||
      event.type === "facing_changed"
    )
      this.stop(event.reason ?? "manual_interruption");
  }

  dispose(): void {
    this.disposed = true;
    this.listener = undefined;
    this.stop("disposed");
  }

  private tick(): void {
    if (!this.state.active) return;
    const generation = this.generation;
    try {
      const now = this.deps.now();
      if (this.deps.control.snapshot().owner !== "follow")
        throw new Error("control_owner_changed");
      if (now >= this.state.expiresAt!) throw new Error("follow_deadline");
      const target = this.readTarget();
      this.observeTarget(target);
      const previous = this.plannedTarget!;
      const moved = Math.hypot(
        target.pose.x - previous.x,
        target.pose.y - previous.y,
      );
      const changedGround = Math.abs(target.pose.z - previous.z) > GROUND_ERROR;
      if (
        (moved >= DISPLACEMENT || changedGround) &&
        now - this.plannedAt >= REPLAN_MS
      ) {
        this.plan(target);
      }
    } catch (error) {
      if (this.generation === generation) this.stop(errorReason(error));
    }
  }

  private readTarget(): ObservedTarget {
    const control = this.deps.control.snapshot();
    if (!control.movementAllowed)
      throw new Error(control.blockedReason ?? "no_control");
    if (!control.pose) throw new Error("no_pose");
    const target = this.deps.target(this.state.guid!);
    if (!target || target.guid !== this.state.guid)
      throw new Error("target_lost");
    if (target.health === 0) throw new Error("target_dead");
    if (!target.motion) throw new Error("target_motion_unknown");
    if (target.motion.unsupportedReason)
      throw new Error(target.motion.unsupportedReason);
    const pose = target.pose;
    if (!pose || ![pose.x, pose.y, pose.z].every(Number.isFinite))
      throw new Error("target_pose_unknown");
    const observedAt = target.motion.observedAt;
    const age = this.deps.now() - observedAt;
    if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS)
      throw new Error("target_stale");
    if (pose.mapId !== control.pose.mapId)
      throw new Error("target_map_changed");
    if (separation(control.pose, pose) > MAX_RANGE)
      throw new Error("target_out_of_range");
    return { pose: { ...pose }, observedAt };
  }

  private observeTarget(target: ObservedTarget): void {
    this.state.targetPose = target.pose;
    this.state.observedAt = target.observedAt;
    const pose = this.deps.control.snapshot().pose;
    this.state.separation = pose ? separation(pose, target.pose) : undefined;
  }

  private plan(target: ObservedTarget): void {
    const generation = this.generation;
    const changing = this.changing;
    this.changing = true;
    try {
      this.deps.control.pause("follow");
      if (!this.state.active || this.generation !== generation) return;
      const from = this.deps.control.snapshot().pose!;
      this.observeTarget(target);
      const navigation = this.deps.navigation();
      const route = this.groundRoute(navigation, from, target.pose);
      const end = route.points[route.points.length - 1]!;
      if (Math.abs(end.z - target.pose.z) > GROUND_ERROR)
        throw new Error("target_disagrees_with_ground");
      const destination = route.sample(
        Math.max(0, route.length - this.state.distance),
      );
      this.state.destination = {
        x: destination.x,
        y: destination.y,
        z: destination.z,
      };
      this.plannedTarget = target.pose;
      this.plannedAt = this.deps.now();
      this.state.plans++;
      if (route.length <= this.state.distance) {
        this.hold();
        return;
      }
      const approach = this.groundRoute(navigation, from, destination);
      if (!this.state.active || this.generation !== generation) return;
      this.state.status = "following";
      this.deps.control.navigate(approach, destination, "follow");
      if (this.state.active) this.emit("planned");
    } finally {
      this.changing = changing;
    }
  }

  private groundRoute(
    navigation: Navigation,
    from: CombatPose,
    to: NavPoint,
  ): GroundRoute {
    if (this.state.attempts >= MAX_ATTEMPTS)
      throw new Error("follow_plan_budget");
    this.state.attempts++;
    const route = navigation.planGround(from.mapId, from, { x: to.x, y: to.y });
    if (route.length > MAX_ROUTE) throw new Error("follow_route_too_long");
    return route;
  }

  private hold(): void {
    this.state.status = "holding";
    const pose = this.deps.control.snapshot().pose;
    if (pose && this.state.targetPose)
      this.state.separation = separation(pose, this.state.targetPose);
    this.emit("holding");
  }

  private emit(type: FollowEvent["type"]): void {
    this.listener?.({ type, state: this.snapshot(), at: this.deps.now() });
  }
}

function expectedTransition(event: ControlEvent): boolean {
  if (event.type === "movement_stopped")
    return (
      event.reason === "follow_pause" || event.reason === "navigation_replaced"
    );
  if (event.type === "control_changed")
    return (
      event.reason === "follow_pause" ||
      event.reason === "navigation_replaced" ||
      event.reason === undefined
    );
  return event.type === "movement_started" || event.type === "facing_changed";
}

function separation(from: NavPoint, to: NavPoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : "follow_failed";
}

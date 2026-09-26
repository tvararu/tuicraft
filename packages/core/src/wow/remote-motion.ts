import type { Position } from "#wow/entity-store";
import {
  MovementFlagExtra as Extra,
  MovementFlag as Flag,
} from "#wow/protocol/entity-fields";
import type { MovementInfo } from "#wow/protocol/movement";
import {
  assertFiniteMovement,
  type RemoteTransition,
} from "#wow/protocol/remote-movement";

export type RemoteInvalidReason =
  | "unknown_flags"
  | "contradictory_flags"
  | "pending_flags"
  | "transport"
  | "flying"
  | "disable_gravity"
  | "hover"
  | "falling"
  | "swimming"
  | "spline"
  | "flags_unobserved"
  | "teleport"
  | "knockback"
  | "time_skipped"
  | "malformed"
  | "transfer"
  | "map_changed"
  | "dead";

export type RemotePoseSource = "observer" | "create" | "update";

export type RemotePose = {
  guid: bigint;
  position: Position;
  source: RemotePoseSource;
  flags?: number;
  extraFlags?: number;
  moverTime?: number;
  receivedAt: number;
  motion?: "moving" | "stationary";
  invalid?: RemoteInvalidReason;
};

export type RemoteMotionEvent =
  | { type: "pose"; pose: RemotePose }
  | { type: "removed"; guid: bigint };

export type RemoteObservation = {
  position: Position;
  source: RemotePoseSource;
  info?: MovementInfo;
  transition?: RemoteTransition;
};

export type RemoteMotionDeps = {
  now: () => number;
  eligible: (guid: bigint) => boolean;
  dead: (guid: bigint) => boolean;
  emit: (event: RemoteMotionEvent) => void;
};

const KNOWN_FLAGS = Object.values(Flag).reduce((all, bit) => all | bit, 0);
const KNOWN_EXTRA = Object.values(Extra).reduce((all, bit) => all | bit, 0);

const TRANSLATING =
  Flag.FORWARD | Flag.BACKWARD | Flag.STRAFE_LEFT | Flag.STRAFE_RIGHT;

const ROOT_EXCLUSIVE =
  TRANSLATING |
  Flag.FALLING |
  Flag.FALLING_FAR |
  Flag.ASCENDING |
  Flag.DESCENDING |
  Flag.SPLINE_ELEVATION;

const PENDING =
  Flag.PENDING_STOP |
  Flag.PENDING_STRAFE_STOP |
  Flag.PENDING_FORWARD |
  Flag.PENDING_BACKWARD |
  Flag.PENDING_STRAFE_LEFT |
  Flag.PENDING_STRAFE_RIGHT |
  Flag.PENDING_ROOT;

const OPPOSED: readonly [number, number][] = [
  [Flag.FORWARD, Flag.BACKWARD],
  [Flag.STRAFE_LEFT, Flag.STRAFE_RIGHT],
  [Flag.LEFT, Flag.RIGHT],
  [Flag.PITCH_UP, Flag.PITCH_DOWN],
  [Flag.ASCENDING, Flag.DESCENDING],
];

const UNSUPPORTED: readonly [number, RemoteInvalidReason][] = [
  [PENDING, "pending_flags"],
  [Flag.ON_TRANSPORT, "transport"],
  [Flag.FLYING | Flag.ASCENDING | Flag.DESCENDING, "flying"],
  [Flag.DISABLE_GRAVITY, "disable_gravity"],
  [Flag.HOVER, "hover"],
  [Flag.FALLING | Flag.FALLING_FAR, "falling"],
  [Flag.SWIMMING, "swimming"],
  [Flag.SPLINE_ENABLED | Flag.SPLINE_ELEVATION, "spline"],
];

export function classifyGroundFlags(
  flags: number,
  extraFlags: number,
): RemoteInvalidReason | undefined {
  if ((flags & ~KNOWN_FLAGS) !== 0 || (extraFlags & ~KNOWN_EXTRA) !== 0)
    return "unknown_flags";
  const opposed = OPPOSED.some(
    ([a, b]) => (flags & a) !== 0 && (flags & b) !== 0,
  );
  if (opposed || (flags & Flag.ROOT && flags & ROOT_EXCLUSIVE))
    return "contradictory_flags";
  return UNSUPPORTED.find(([mask]) => (flags & mask) !== 0)?.[1];
}

export class RemoteMotion {
  private readonly deps: RemoteMotionDeps;
  private readonly poses = new Map<bigint, RemotePose>();
  private transferring = false;

  constructor(deps: RemoteMotionDeps) {
    this.deps = deps;
  }

  all(): RemotePose[] {
    return [...this.poses.values()];
  }

  observe(guid: bigint, observation: RemoteObservation): boolean {
    if (this.transferring || !this.deps.eligible(guid)) return false;
    const previous = this.poses.get(guid);
    if (previous && previous.position.mapId !== observation.position.mapId) {
      this.invalidate(guid, "map_changed");
      return false;
    }
    const { info } = observation;
    if (info) {
      try {
        assertFiniteMovement(info);
      } catch {
        this.invalidate(guid, "malformed");
        return false;
      }
    }
    const invalid = this.invalidReason(guid, observation);
    const pose: RemotePose = {
      guid,
      position: observation.position,
      source: observation.source,
      receivedAt: this.deps.now(),
    };
    if (info) {
      pose.flags = info.flags;
      pose.extraFlags = info.extraFlags;
      pose.moverTime = info.time;
    }
    if (invalid) pose.invalid = invalid;
    else
      pose.motion = (pose.flags ?? 0) & TRANSLATING ? "moving" : "stationary";
    this.store(pose);
    return true;
  }

  invalidate(guid: bigint, reason: RemoteInvalidReason): void {
    const pose = this.poses.get(guid);
    if (!pose) return;
    const { motion: _motion, ...rest } = pose;
    this.store({ ...rest, invalid: reason });
  }

  observeVitals(guid: bigint): void {
    if (this.deps.dead(guid)) this.invalidate(guid, "dead");
  }

  mapChanged(mapId: number): void {
    for (const pose of this.all())
      if (pose.position.mapId !== mapId)
        this.invalidate(pose.guid, "map_changed");
  }

  beginTransfer(): void {
    this.transferring = true;
    for (const guid of this.poses.keys()) this.invalidate(guid, "transfer");
  }

  endTransfer(): void {
    this.transferring = false;
  }

  forget(guid: bigint): void {
    if (!this.poses.delete(guid)) return;
    this.deps.emit({ type: "removed", guid });
  }

  private invalidReason(
    guid: bigint,
    { info, transition }: RemoteObservation,
  ): RemoteInvalidReason | undefined {
    if (this.deps.dead(guid)) return "dead";
    if (transition === "teleport" || transition === "knockback")
      return transition;
    if (!info) return "flags_unobserved";
    return classifyGroundFlags(info.flags, info.extraFlags);
  }

  private store(pose: RemotePose): void {
    this.poses.set(pose.guid, pose);
    this.deps.emit({ type: "pose", pose });
  }
}

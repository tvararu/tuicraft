import type { ControlPose } from "wow/control";
import type { Position } from "wow/entity-store";
import type { CreateSpline, MonsterMove } from "wow/protocol/monster-move";
import {
  createTrajectory,
  pathTrajectory,
  sampleSplinePosition,
  type SplineTrajectory,
} from "wow/spline";

export type CombatPose = Omit<ControlPose, "orientation"> & {
  orientation: number | undefined;
};

export type UnitMotion = {
  kind: "spline" | "stationary";
  observedAt: number;
  unsupportedReason?: string;
};

type Motion = {
  observed: CombatPose;
  trajectory?: SplineTrajectory;
  startedAt: number;
  unsupportedReason?: string;
};

export class MotionStore {
  private readonly motions = new Map<bigint, Motion>();

  constructor(private readonly now: () => number) {}

  observe(guid: bigint, position: Position, spline?: CreateSpline): void {
    const now = this.now();
    this.set(guid, {
      observed: { ...position, source: "server", updatedAt: now },
      trajectory: spline && createTrajectory(spline, position.orientation),
      startedAt: now - (spline?.elapsed ?? 0),
      unsupportedReason:
        spline && spline.mode !== 0 && spline.mode !== 1
          ? "unsupported_spline_mode"
          : undefined,
    });
  }

  monsterMove(packet: MonsterMove, mapId: number): void {
    const now = this.now();
    const observed: CombatPose = {
      mapId,
      ...packet.start,
      orientation: undefined,
      source: "server",
      updatedAt: now,
    };
    if (packet.kind === "stop") {
      this.motions.set(packet.guid, { observed, startedAt: now });
      return;
    }
    this.set(packet.guid, {
      observed,
      trajectory: pathTrajectory(packet),
      startedAt: now,
      unsupportedReason:
        packet.interpolation === "catmullrom" && !packet.cyclic
          ? "unknown_launch_orientation"
          : undefined,
    });
  }

  pose(guid: bigint): CombatPose | undefined {
    const motion = this.motions.get(guid);
    if (!motion || motion.unsupportedReason) return undefined;
    if (!motion.trajectory) return { ...motion.observed };
    const sample = sampleSplinePosition(
      motion.trajectory,
      this.now() - motion.startedAt,
    );
    if (!sample.supported) return undefined;
    return {
      mapId: motion.observed.mapId,
      x: sample.x,
      y: sample.y,
      z: sample.z,
      orientation: motion.observed.orientation,
      source: "predicted",
      updatedAt: this.now(),
    };
  }

  serverPose(guid: bigint): CombatPose | undefined {
    const observed = this.motions.get(guid)?.observed;
    return observed ? { ...observed } : undefined;
  }

  motion(guid: bigint): UnitMotion | undefined {
    const motion = this.motions.get(guid);
    if (!motion) return undefined;
    return {
      kind: motion.trajectory ? "spline" : "stationary",
      observedAt: motion.observed.updatedAt,
      unsupportedReason: motion.unsupportedReason,
    };
  }

  forget(guid: bigint): void {
    this.motions.delete(guid);
  }

  clear(): void {
    this.motions.clear();
  }

  private set(guid: bigint, motion: Motion): void {
    this.motions.set(guid, motion);
    if (!motion.trajectory || motion.unsupportedReason) return;
    const sample = sampleSplinePosition(motion.trajectory, 0);
    if (!sample.supported) motion.unsupportedReason = sample.reason;
  }
}

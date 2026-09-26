import { distance2d } from "#wow/geometry";
import type { GroundRoute, NavPoint } from "#wow/navigation";

export type Replanner = (origin: NavPoint) => GroundRoute;

export const REPLAN_LIMITS = {
  plans: 4,
  elapsedMs: 60_000,
  traveledFactor: 2,
  traveledFloor: 20,
  displacement: 2,
  delayMs: 250,
};

export type ReplanState = {
  plans: number;
  traveled: number;
  elapsedMs: number;
  interruptions: string[];
  pending: boolean;
  limits: {
    plans: number;
    elapsedMs: number;
    traveled: number;
    displacement: number;
  };
};

const REPLANNABLE = new Set(["server_correction"]);

export function replannable(reason: string, sampleFailure: boolean): boolean {
  return sampleFailure || REPLANNABLE.has(reason);
}

export class RouteSession {
  readonly replan: Replanner;
  private readonly startedAt: number;
  private readonly maxTraveled: number;
  private origin: NavPoint;
  private plans = 1;
  private traveled = 0;
  private elapsedMs = 0;
  private readonly interruptions: string[] = [];
  private pending = false;

  constructor(replan: Replanner, route: GroundRoute, startedAt: number) {
    this.replan = replan;
    this.startedAt = startedAt;
    this.origin = originOf(route);
    this.maxTraveled = Math.max(
      REPLAN_LIMITS.traveledFloor,
      route.length * REPLAN_LIMITS.traveledFactor,
    );
  }

  walked(yards: number, now: number): void {
    this.traveled += yards;
    this.elapsedMs = now - this.startedAt;
  }

  interrupted(reason: string): void {
    this.interruptions.push(reason);
    this.pending = true;
  }

  settle(now: number): void {
    this.pending = false;
    this.elapsedMs = now - this.startedAt;
  }

  limitReached(origin: NavPoint): string | undefined {
    if (this.plans >= REPLAN_LIMITS.plans) return "replan_plan_limit";
    if (this.elapsedMs > REPLAN_LIMITS.elapsedMs) return "replan_time_limit";
    if (this.traveled >= this.maxTraveled) return "replan_distance_limit";
    if (distance2d(origin, this.origin) < REPLAN_LIMITS.displacement)
      return "replan_no_progress";
    return undefined;
  }

  planned(route: GroundRoute): void {
    this.plans++;
    this.origin = originOf(route);
  }

  snapshot(): ReplanState {
    return {
      plans: this.plans,
      traveled: this.traveled,
      elapsedMs: this.elapsedMs,
      interruptions: [...this.interruptions],
      pending: this.pending,
      limits: {
        plans: REPLAN_LIMITS.plans,
        elapsedMs: REPLAN_LIMITS.elapsedMs,
        traveled: this.maxTraveled,
        displacement: REPLAN_LIMITS.displacement,
      },
    };
  }
}

function originOf(route: GroundRoute): NavPoint {
  const origin = route.points[0];
  if (origin === undefined) throw new Error("navigation_route_empty");
  return { x: origin.x, y: origin.y, z: origin.z };
}

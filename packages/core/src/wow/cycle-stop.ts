export type CycleStop = {
  ok: false;
  cause: string;
  detail?: Record<string, unknown>;
};

export function cycleStop(
  cause: string,
  detail?: Record<string, unknown>,
): CycleStop {
  return { ok: false, cause, detail };
}

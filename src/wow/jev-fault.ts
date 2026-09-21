import { selectJevAction } from "wow/jev";
import type { TacticsSelect } from "wow/tactics";

export type JevFault =
  | { kind: "delay"; delayMs: number }
  | { kind: "http"; status: number }
  | { kind: "transport"; error?: string };

export type JevFaultInfo = {
  fault?: JevFault;
  marker?: string;
};

export function parseJevFault(
  faultRaw?: string,
  delayRaw?: string,
  endpointRaw?: string,
): JevFaultInfo {
  if (faultRaw !== undefined && faultRaw.length > 0) {
    if (faultRaw.startsWith("delay:")) {
      const delayMs = Number.parseInt(faultRaw.slice(6), 10);
      if (Number.isFinite(delayMs) && delayMs >= 0) {
        return {
          fault: { kind: "delay", delayMs },
          marker: `delay:${delayMs}ms`,
        };
      }
    }
    if (faultRaw === "delay") {
      const delayMs = delayRaw ? Number.parseInt(delayRaw, 10) : 2500;
      const validDelay =
        Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 2500;
      return {
        fault: { kind: "delay", delayMs: validDelay },
        marker: `delay:${validDelay}ms`,
      };
    }
    if (faultRaw.startsWith("http:") || faultRaw.startsWith("status:")) {
      const codeStr = faultRaw.slice(faultRaw.indexOf(":") + 1);
      const status = Number.parseInt(codeStr, 10);
      if (Number.isFinite(status) && status >= 100 && status <= 599) {
        return {
          fault: { kind: "http", status },
          marker: `http:${status}`,
        };
      }
    }
    const numericStatus = Number.parseInt(faultRaw, 10);
    if (
      Number.isFinite(numericStatus) &&
      numericStatus >= 400 &&
      numericStatus <= 599
    ) {
      return {
        fault: { kind: "http", status: numericStatus },
        marker: `http:${numericStatus}`,
      };
    }
    if (
      faultRaw === "transport" ||
      faultRaw === "network" ||
      faultRaw === "error"
    ) {
      return {
        fault: { kind: "transport", error: "fetch failed" },
        marker: "transport:network",
      };
    }
  }

  if (delayRaw !== undefined && delayRaw.length > 0) {
    const delayMs = Number.parseInt(delayRaw, 10);
    if (Number.isFinite(delayMs) && delayMs >= 0) {
      return {
        fault: { kind: "delay", delayMs },
        marker: `delay:${delayMs}ms`,
      };
    }
  }

  if (endpointRaw !== undefined && endpointRaw.length > 0) {
    return {
      marker: `endpoint:${endpointRaw}`,
    };
  }

  return {};
}

export function readJevFaultFromEnv(
  env: Record<string, string | undefined> = process.env,
): JevFaultInfo {
  return parseJevFault(
    env["JEV_FAULT"],
    env["JEV_DELAY_MS"],
    env["JEV_ENDPOINT_URL"] ?? env["TYPESAFE_ENDPOINT_URL"],
  );
}

export function createFaultSelect(
  fault: JevFault,
  baseSelect: TacticsSelect = selectJevAction,
): TacticsSelect {
  if (fault.kind === "http") {
    return async () => {
      throw new Error(`TypeSafe HTTP ${fault.status}`);
    };
  }

  if (fault.kind === "transport") {
    return async () => {
      throw new TypeError(fault.error ?? "fetch failed");
    };
  }

  return async (request, options) => {
    const started = performance.now();
    const fetchController = new AbortController();
    const basePromise = baseSelect(request, {
      ...options,
      signal: fetchController.signal,
    });
    const result = await basePromise;
    const remaining = fault.delayMs - (performance.now() - started);
    if (remaining > 0 && !options.signal.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
      });
    }
    return {
      ...result,
      elapsedMs: Math.max(result.elapsedMs, performance.now() - started),
    };
  };
}

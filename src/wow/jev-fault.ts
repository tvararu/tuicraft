import type { JevSelect } from "wow/jev";

export type JevFault =
  | { kind: "delay"; delayMs: number }
  | { kind: "http"; status: number }
  | { kind: "transport" };

export function parseJevFault(raw: string | undefined): JevFault | undefined {
  if (!raw) return undefined;
  const [kind, value] = raw.split(":");
  const number = Number(value);
  if (kind === "delay" && Number.isSafeInteger(number) && number >= 0)
    return { kind, delayMs: number };
  if (kind === "http" && Number.isInteger(number) && inStatusRange(number))
    return { kind, status: number };
  if (raw === "transport") return { kind: "transport" };
  throw new Error(
    `Unknown JEV_FAULT "${raw}". Use delay:<ms>, http:<status> or transport`,
  );
}

function inStatusRange(status: number): boolean {
  return status >= 100 && status <= 599;
}

export function faultMarker(fault: JevFault): string {
  if (fault.kind === "delay") return `delay:${fault.delayMs}ms`;
  if (fault.kind === "http") return `http:${fault.status}`;
  return "transport:network";
}

export function createFaultSelect(
  fault: JevFault,
  baseSelect: JevSelect,
): JevSelect {
  if (fault.kind === "http")
    return () => Promise.reject(new Error(`TypeSafe HTTP ${fault.status}`));
  if (fault.kind === "transport")
    return () => Promise.reject(new TypeError("fetch failed"));
  return async (request, options) => {
    const started = performance.now();
    const detached = new AbortController().signal;
    const result = await baseSelect(request, { ...options, signal: detached });
    const remaining = fault.delayMs - (performance.now() - started);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, remaining)));
    const elapsedMs = Math.max(result.elapsedMs, performance.now() - started);
    return { ...result, elapsedMs };
  };
}

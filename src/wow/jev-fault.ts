import type { JevSelect } from "wow/jev";

export type JevFault = (
  | { kind: "delay"; delayMs: number }
  | { kind: "http"; status: number }
  | { kind: "transport" }
) & { request?: number };

export function parseJevFault(raw: string | undefined): JevFault | undefined {
  if (!raw) return undefined;
  const [spec = "", at, ...extra] = raw.split("@");
  const fault = parseKind(spec);
  const request = Number(at);
  if (fault && at === undefined) return fault;
  const valid = Number.isSafeInteger(request) && request > 0;
  if (fault && extra.length === 0 && valid) return { ...fault, request };
  throw new Error(
    `Unknown JEV_FAULT "${raw}". Use delay:<ms>, http:<status> or transport, optionally @<request>`,
  );
}

function parseKind(spec: string): JevFault | undefined {
  const [kind, value] = spec.split(":");
  const number = Number(value);
  if (kind === "delay" && Number.isSafeInteger(number) && number >= 0)
    return { kind, delayMs: number };
  const status = Number.isInteger(number) && number >= 400 && number <= 599;
  if (kind === "http" && status) return { kind, status: number };
  if (spec === "transport") return { kind: "transport" };
  return undefined;
}

export function faultMarker(fault: JevFault): string {
  const at = fault.request === undefined ? "" : `@${fault.request}`;
  if (fault.kind === "delay") return `delay:${fault.delayMs}ms${at}`;
  if (fault.kind === "http") return `http:${fault.status}${at}`;
  return `transport:network${at}`;
}

export function createFaultSelect(
  fault: JevFault,
  baseSelect: JevSelect,
): JevSelect {
  const faulty = faultySelect(fault, baseSelect);
  if (fault.request === undefined) return faulty;
  let requests = 0;
  return (request, options) => {
    requests += 1;
    const select = requests === fault.request ? faulty : baseSelect;
    return select(request, options);
  };
}

function faultySelect(fault: JevFault, baseSelect: JevSelect): JevSelect {
  if (fault.kind === "http") {
    const fetch = async () => new Response(null, { status: fault.status });
    return (request, options) => baseSelect(request, { ...options, fetch });
  }
  if (fault.kind === "transport") {
    const fetch = () => Promise.reject(new TypeError("fetch failed"));
    return (request, options) => baseSelect(request, { ...options, fetch });
  }
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

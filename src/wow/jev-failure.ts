export const JEV_UNAVAILABLE = "jev_unavailable";

export class JevUnavailableError extends Error {
  readonly detail: string;

  constructor(detail: string, options?: ErrorOptions) {
    super(`${JEV_UNAVAILABLE}: ${detail}`, options);
    this.name = "JevUnavailableError";
    this.detail = detail;
  }
}

export class JevTransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JevTransportError";
  }
}

const REFUSED: Record<number, string> = {
  401: "unauthorized",
  402: "payment_required",
  403: "forbidden",
};

export async function httpFailure(response: Response): Promise<Error> {
  const { status } = response;
  const refused = REFUSED[status];
  if (refused !== undefined) {
    const kind = (await errorType(response)) ?? refused;
    return new JevUnavailableError(`HTTP ${status} ${kind}`);
  }
  const message = `TypeSafe HTTP ${status}`;
  if (status === 429 || status >= 500) return new JevTransportError(message);
  return new Error(message);
}

async function errorType(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    const detail = field(body, "detail");
    const kind = field(detail, "error_type");
    return typeof kind === "string" && kind !== "" ? kind : undefined;
  } catch {
    return undefined;
  }
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

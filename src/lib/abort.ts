export function isAbort(value: unknown): value is Error {
  return value instanceof Error && value.name === "AbortError";
}

export function abortReason(signal: AbortSignal, cause?: unknown): Error {
  if (isAbort(signal.reason)) return signal.reason;
  if (isAbort(cause)) return cause;
  return new DOMException("The operation was aborted.", "AbortError");
}

export async function abortable<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  const aborted = Promise.withResolvers<never>();
  const fail = () => aborted.reject(abortReason(signal));
  if (signal.aborted) fail();
  else signal.addEventListener("abort", fail, { once: true });
  try {
    return await Promise.race([pending, aborted.promise]);
  } finally {
    signal.removeEventListener("abort", fail);
  }
}

export async function bounded<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  timeoutReason: string,
): Promise<T> {
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => timeout.reject(new Error(timeoutReason)),
    timeoutMs,
  );
  try {
    return await abortable(Promise.race([pending, timeout.promise]), signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function pause(ms: number, signal: AbortSignal): Promise<void> {
  const elapsed = Promise.withResolvers<void>();
  const timer = setTimeout(elapsed.resolve, ms);
  try {
    await abortable(elapsed.promise, signal);
  } finally {
    clearTimeout(timer);
  }
}

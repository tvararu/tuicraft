export function must<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${what} to be present`);
  }
  return value;
}

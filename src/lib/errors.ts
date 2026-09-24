export function messageOf(error: unknown, fallback = String(error)): string {
  return error instanceof Error ? error.message : fallback;
}

export function formatSendOutput(
  lines: string[],
  json: boolean,
  preserveDaemonLines: boolean,
): string[] {
  if (!json || preserveDaemonLines) return lines;
  return [JSON.stringify({ status: "ok" })];
}

export function daemonCommandFailed(lines: string[]): boolean {
  return lines.some((line) => line.startsWith("ERR"));
}

export function walkCommandFailed(lines: string[]): boolean {
  if (lines.length !== 1 || daemonCommandFailed(lines)) return true;
  try {
    const outcome: unknown = JSON.parse(lines[0]!);
    return (
      typeof outcome !== "object" ||
      outcome === null ||
      !("status" in outcome) ||
      outcome.status !== "completed"
    );
  } catch {
    return true;
  }
}

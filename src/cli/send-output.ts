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

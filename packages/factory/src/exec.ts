export type Result = { code: number; stdout: string; stderr: string };
export type RunOptions = { cwd?: string; env?: Record<string, string> };

export async function run(
  cmd: string[],
  opts: RunOptions = {},
): Promise<Result> {
  const env = { ...Bun.env, ...opts.env };
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stderr, stdout };
}

export async function must(
  cmd: string[],
  opts: RunOptions = {},
): Promise<string> {
  const result = await run(cmd, opts);
  if (result.code !== 0) {
    throw new Error(
      `${cmd.join(" ")} exited ${result.code}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

export async function json<T>(
  cmd: string[],
  opts: RunOptions = {},
): Promise<T> {
  return JSON.parse(await must(cmd, opts)) as T;
}

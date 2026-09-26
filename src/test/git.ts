export function gitEnv(
  env: Record<string, string | undefined> = Bun.env,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(env))
    if (value !== undefined && !key.startsWith("GIT_")) kept[key] = value;
  return kept;
}

export async function git(dir: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", dir, ...args], {
    env: gitEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0)
    throw new Error(`git ${args.join(" ")} exited ${code}: ${stderr.trim()}`);
  return stdout;
}

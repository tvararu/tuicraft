import { mainCheckout } from "factory/config";
import { run } from "factory/exec";

export async function strayWorktree(
  repo: string = mainCheckout,
): Promise<string | null> {
  const config = `${repo}/.git/config`;
  const res = await run([
    "git",
    "config",
    "--file",
    config,
    "--get",
    "core.worktree",
  ]);
  if (res.code === 1) return null;
  if (res.code !== 0)
    throw new Error(`git config --file ${config}: ${res.stderr.trim()}`);
  return res.stdout.trim();
}

export function strayFix(repo: string = mainCheckout): string {
  return `git config --file ${repo}/.git/config --unset core.worktree`;
}

export function strayMessage(
  value: string,
  repo: string = mainCheckout,
): string {
  return `core.worktree is set to ${value} in ${repo}/.git/config, so git in the main checkout runs against that tree. Doing nothing. Fix: ${strayFix(repo)}`;
}

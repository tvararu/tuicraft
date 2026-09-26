import { mainCheckout, repoSlug } from "#factory/config";
import { json, must, run } from "#factory/exec";

export type PrState = "OPEN" | "CLOSED" | "MERGED";
export type BranchPr = { number: number; state: PrState };
export type SupersedeFacts = {
  branch: string;
  prs: BranchPr[];
  remoteTip: string | null;
  behind: boolean;
};

const factoryBranch = /^factory\/\d+-/;
const space = /\s/;

export function superseded(f: SupersedeFacts): string | null {
  const open = f.prs.find((p) => p.state === "OPEN");
  if (open)
    return f.remoteTip !== null && !f.behind
      ? `${f.branch} moved on to ${f.remoteTip.slice(0, 7)} with PR #${open.number} open`
      : null;
  const done =
    f.prs.find((p) => p.state === "MERGED") ??
    f.prs.find((p) => p.state === "CLOSED");
  return done ? `PR #${done.number} ${done.state.toLowerCase()}` : null;
}

async function git(args: string[], cwd = mainCheckout): Promise<string> {
  return (await must(["git", ...args], { cwd })).trim();
}

async function isAncestor(older: string, tip: string): Promise<boolean> {
  const cmd = ["git", "merge-base", "--is-ancestor", older, tip];
  return (await run(cmd, { cwd: mainCheckout })).code === 0;
}

export async function supersededBy(
  branch: string,
  cwd: string,
): Promise<string | null> {
  if (!factoryBranch.test(branch)) return null;
  const tip = await git(["rev-parse", branch], cwd);
  const prs = await json<BranchPr[]>([
    "gh",
    "pr",
    "list",
    "-R",
    repoSlug,
    "--head",
    branch,
    "--state",
    "all",
    "--json",
    "number,state",
  ]);
  const ls = await git(["ls-remote", "origin", `refs/heads/${branch}`]);
  const remote = ls.split(space)[0] || null;
  const behind = remote !== null && (await isAncestor(remote, tip));
  return superseded({ behind, branch, prs, remoteTip: remote });
}

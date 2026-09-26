import { mainCheckout, repoSlug } from "#factory/config";
import { json, must } from "#factory/exec";

export type LandFacts = {
  ahead: number;
  tip: string;
  mergedHeads: string[];
  cherry: string;
  branchPatch: string;
  mainPatches: string[];
};

type Node = { oid: string } | null;
export type PrHeads = {
  headRefOid: string;
  commits: { nodes: { commit: Node }[] };
  timelineItems: { nodes: { beforeCommit?: Node; afterCommit?: Node }[] };
};
type HeadsReply = {
  data: { repository: { pullRequests: { nodes: PrHeads[] } } };
};

const headsQuery = `query($owner:String!,$name:String!,$branch:String!){
  repository(owner:$owner,name:$name){pullRequests(headRefName:$branch,states:MERGED,first:20){nodes{
    headRefOid commits(last:250){nodes{commit{oid}}}
    timelineItems(itemTypes:HEAD_REF_FORCE_PUSHED_EVENT,first:100){nodes{
      ... on HeadRefForcePushedEvent{beforeCommit{oid} afterCommit{oid}}}}}}}}`;

export function landed(f: LandFacts): boolean {
  const cherry = f.cherry.split("\n").filter(Boolean);
  if (f.ahead === 0) return true;
  if (f.mergedHeads.includes(f.tip)) return true;
  if (cherry.length > 0 && cherry.every((l) => l.startsWith("- "))) return true;
  return f.branchPatch !== "" && f.mainPatches.includes(f.branchPatch);
}

export function prHeads(prs: PrHeads[]): string[] {
  const oids = prs.flatMap((pr) => [
    pr.headRefOid,
    ...pr.commits.nodes.map((n) => n.commit?.oid),
    ...pr.timelineItems.nodes.flatMap((n) => [
      n.beforeCommit?.oid,
      n.afterCommit?.oid,
    ]),
  ]);
  return [...new Set(oids.filter((oid): oid is string => Boolean(oid)))];
}

async function git(args: string[]): Promise<string> {
  return (await must(["git", ...args], { cwd: mainCheckout })).trim();
}

async function patchIds(cmd: string[]): Promise<string[]> {
  const src = Bun.spawn(cmd, { cwd: mainCheckout, stdout: "pipe" });
  const ids = Bun.spawn(["git", "patch-id", "--stable"], {
    cwd: mainCheckout,
    stdin: src.stdout,
    stdout: "pipe",
  });
  const out = await new Response(ids.stdout).text();
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split(" ")[0] ?? "");
}

async function mergedHeads(branch: string): Promise<string[]> {
  const [owner = "", name = ""] = repoSlug.split("/");
  const reply = await json<HeadsReply>([
    "gh",
    "api",
    "graphql",
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-f",
    `branch=${branch}`,
    "-f",
    `query=${headsQuery}`,
  ]);
  return prHeads(reply.data.repository.pullRequests.nodes);
}

export async function landFacts(
  tip: string,
  branch: string | null,
): Promise<LandFacts> {
  const ahead = Number(
    await git(["rev-list", "--count", `origin/main..${tip}`]),
  );
  const base = await git(["merge-base", "origin/main", tip]);
  const cherry = await git(["cherry", "origin/main", tip]);
  const [branchPatch = ""] = await patchIds(["git", "diff", base, tip]);
  const mainPatches = await patchIds([
    "git",
    "log",
    "-p",
    `${base}..origin/main`,
  ]);
  return {
    ahead,
    branchPatch,
    cherry,
    mainPatches,
    mergedHeads: branch ? await mergedHeads(branch) : [],
    tip,
  };
}

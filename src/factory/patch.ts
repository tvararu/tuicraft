import { must } from "factory/exec";

export type PatchMatch = { same: boolean; old: string; next: string };
export type Git = (args: string[]) => Promise<string>;

const range = /^([^.\s]+)\.\.([^.\s]+)$/;

export function zeroContext(diff: string): string {
  return diff
    .split("\n")
    .filter((line) => !line.startsWith("index "))
    .map((line) => (line.startsWith("@@") ? "@@" : line))
    .join("\n");
}

const shellGit: Git = (args) => must(["git", ...args]);

async function patchOf(spec: string, git: Git): Promise<string> {
  const [, from = "", to = ""] = range.exec(spec) ?? [];
  if (!(from && to)) throw new Error(`expected <base>..<head>, got ${spec}`);
  return zeroContext(
    await git(["diff", "-U0", "--no-color", "--no-ext-diff", from, to]),
  );
}

export async function samePatch(
  old: string,
  next: string,
  git: Git = shellGit,
): Promise<PatchMatch> {
  const [a, b] = await Promise.all([patchOf(old, git), patchOf(next, git)]);
  return { next: b, old: a, same: a === b };
}

export async function runSamePatch(args: string[]): Promise<number> {
  const [old, next] = args;
  if (!(old && next)) {
    console.error("usage: same-patch <oldbase>..<old> <newbase>..<new>");
    return 2;
  }
  try {
    const match = await samePatch(old, next);
    if (match.same) {
      console.log(`same zero-context patch: ${old} = ${next}`);
      return 0;
    }
    console.log(`zero-context patch differs: ${old} != ${next}`);
    return 1;
  } catch (error) {
    console.error(
      `same-patch: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
}

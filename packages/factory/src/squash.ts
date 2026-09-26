import { repoSlug } from "#factory/config";
import { json } from "#factory/exec";

export type SquashSource = {
  number: number;
  title: string;
  body: string;
  issues: number[];
};
export type SquashMessage = { subject: string; body: string };

export const coAuthor = "Co-authored-by: Theodor Vararu <theo@vararu.org>";

const conventional =
  /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([^)]+\))?!?: \p{Lu}/u;
const closingLine = /^\s*(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#\d+/i;
const headingLine = /^#{1,6}\s/;
const blank = /\n\s*\n/;
const space = /\s+/;
const width = 72;
const digits = /^\d+$/;

export function subjectProblem(title: string): string | null {
  if (title.length > 50)
    return `PR title is ${title.length} characters, more than 50`;
  if (!conventional.test(title))
    return "PR title is not a Conventional Commit capitalised after the prefix";
  return null;
}

function wrap(paragraph: string): string {
  const lines: string[] = [];
  let line = "";
  for (const word of paragraph.split(space).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

export function why(body: string): string {
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  const end = lines.findIndex((line) => headingLine.test(line));
  const lead = (end === -1 ? lines : lines.slice(0, end)).filter(
    (line) => !closingLine.test(line),
  );
  const [first = ""] = lead.join("\n").trim().split(blank);
  return wrap(first);
}

export function squashMessage(pr: SquashSource): SquashMessage {
  const problem = subjectProblem(pr.title);
  if (problem) throw new Error(problem);
  const prose = why(pr.body);
  if (!prose)
    throw new Error(
      `PR #${pr.number} body has no why paragraph before its first heading`,
    );
  if (pr.issues.length === 0)
    throw new Error(`PR #${pr.number} closes no issue`);
  const trailers = [
    ...pr.issues.map((issue) => `Refs: #${issue}`),
    `PR: #${pr.number}`,
    coAuthor,
  ];
  return { body: `${prose}\n\n${trailers.join("\n")}`, subject: pr.title };
}

type PrView = {
  number: number;
  title: string;
  body: string;
  closingIssuesReferences: { number: number }[];
};

export async function runSquashMessage(args: string[]): Promise<number> {
  const number = args[0];
  if (!(number && digits.test(number))) {
    console.error("usage: squash-message <pr>");
    return 2;
  }
  try {
    const view = await json<PrView>([
      "gh",
      "pr",
      "view",
      number,
      "-R",
      repoSlug,
      "--json",
      "number,title,body,closingIssuesReferences",
    ]);
    const issues = view.closingIssuesReferences.map((ref) => ref.number);
    console.log(JSON.stringify(squashMessage({ ...view, issues })));
    return 0;
  } catch (error) {
    console.error(
      `squash-message: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

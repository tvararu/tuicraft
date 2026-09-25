import { repoSlug } from "factory/config";
import { json, must } from "factory/exec";

export type Commit = {
  sha: string;
  subject: string;
  body: string;
  refs: number[];
  prs: number[];
};

export type PrInfo = {
  number: number;
  title: string;
  url: string;
  body: string;
  closes: number[];
};

export type IssueInfo = {
  number: number;
  title: string;
  url: string;
  state: string;
  body: string;
};

export type Sources = {
  log: (prev: string, sha: string) => Promise<Commit[]>;
  pulls: (sha: string) => Promise<number[]>;
  pr: (number: number) => Promise<PrInfo>;
  issue: (number: number) => Promise<IssueInfo>;
};

export type Source = "trailers" | "api" | "none";

export type Changes = {
  range: string;
  commits: {
    sha: string;
    subject: string;
    body: string;
    source: Source;
    prs: number[];
    issues: number[];
  }[];
  prs: {
    number: number;
    title: string;
    url: string;
    issues: number[];
    proof: string | null;
  }[];
  issues: {
    number: number;
    title: string;
    url: string;
    state: string;
    prs: number[];
    acceptance: string | null;
  }[];
};

type Node = Record<string, unknown>;

const field = "\x1f";
const record = "\x1e";
const closing = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi;
const issueRef = /#(\d+)/g;
const newline = /\r?\n/;
const fenceLine = /^\s*(```|~~~)/;
const headingLine = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const leadingNewlines = /^\n+/;

export async function mapChanges(
  prev: string,
  sha: string,
  sources: Sources,
): Promise<Changes> {
  const log = await sources.log(prev, sha);
  const commits = await Promise.all(
    log.map((commit) => linkCommit(commit, sources)),
  );
  const prNumbers = unique(commits.flatMap((commit) => commit.prs));
  const prs = await Promise.all(prNumbers.map((n) => sources.pr(n)));
  const prIssues = new Map(
    prs.map((pr) => {
      const refs = commits
        .filter((commit) => commit.prs.includes(pr.number))
        .flatMap((commit) => commit.refs);
      return [
        pr.number,
        unique([...pr.closes, ...keywordIssues(pr.body), ...refs]),
      ];
    }),
  );
  const out = commits.map((commit) => ({
    body: commit.body,
    issues: unique([
      ...commit.refs,
      ...commit.prs.flatMap((n) => prIssues.get(n) ?? []),
    ]),
    prs: commit.prs,
    sha: commit.sha,
    source: commit.source,
    subject: commit.subject,
  }));
  const issueNumbers = unique(out.flatMap((commit) => commit.issues));
  const issues = await Promise.all(issueNumbers.map((n) => sources.issue(n)));
  return {
    commits: out,
    issues: issues.map((issue) => ({
      acceptance: section(issue.body, "acceptance criteria"),
      number: issue.number,
      prs: prNumbers.filter((n) => prIssues.get(n)?.includes(issue.number)),
      state: issue.state,
      title: issue.title,
      url: issue.url,
    })),
    prs: prs.map((pr) => ({
      issues: prIssues.get(pr.number) ?? [],
      number: pr.number,
      proof: section(pr.body, "proof"),
      title: pr.title,
      url: pr.url,
    })),
    range: `${prev}..${sha}`,
  };
}

async function linkCommit(
  commit: Commit,
  sources: Sources,
): Promise<Commit & { source: Source }> {
  if (commit.prs.length > 0) return { ...commit, source: "trailers" };
  const prs = unique(await sources.pulls(commit.sha));
  return { ...commit, prs, source: prs.length > 0 ? "api" : "none" };
}

export function keywordIssues(body: string): number[] {
  return unique([...body.matchAll(closing)].map((match) => Number(match[1])));
}

export function section(markdown: string, title: string): string | null {
  const lines = markdown.split(newline);
  const found: string[] = [];
  let level = 0;
  let fence = false;
  for (const line of lines) {
    if (fenceLine.test(line)) fence = !fence;
    const heading = fence ? null : headingLine.exec(line);
    if (heading?.[1] && level > 0 && heading[1].length <= level) break;
    if (level > 0) found.push(line);
    else if (heading?.[1] && heading[2]?.toLowerCase() === title.toLowerCase())
      level = heading[1].length;
  }
  const text = found.join("\n").trim();
  return text ? text : null;
}

export function logFormat(): string {
  const trailers = ["Refs", "PR"].map(
    (key) => `%(trailers:key=${key},valueonly,separator=%x2c)`,
  );
  return `${["%H", "%s", "%b", ...trailers].join("%x1f")}%x1e`;
}

export function parseLog(out: string): Commit[] {
  return out
    .split(record)
    .map((entry) => entry.replace(leadingNewlines, ""))
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [sha = "", subject = "", body = "", refs = "", prs = ""] =
        entry.split(field);
      return {
        body: body.trim(),
        prs: numbers(prs),
        refs: numbers(refs),
        sha,
        subject,
      };
    });
}

function numbers(text: string): number[] {
  return unique([...text.matchAll(issueRef)].map((match) => Number(match[1])));
}

function unique(list: number[]): number[] {
  return [...new Set(list)];
}

const githubSources: Sources = {
  async issue(number) {
    const node = await json<Node>([
      "gh",
      "issue",
      "view",
      String(number),
      "-R",
      repoSlug,
      "--json",
      "number,title,url,state,body",
    ]);
    return {
      body: str(node["body"]),
      number: num(node["number"]),
      state: str(node["state"]),
      title: str(node["title"]),
      url: str(node["url"]),
    };
  },
  async log(prev, sha) {
    const range = `${prev}..${sha}`;
    const format = `--format=${logFormat()}`;
    return parseLog(await must(["git", "log", "--reverse", format, range]));
  },
  async pr(number) {
    const node = await json<Node>([
      "gh",
      "pr",
      "view",
      String(number),
      "-R",
      repoSlug,
      "--json",
      "number,title,url,body,closingIssuesReferences",
    ]);
    const refs = node["closingIssuesReferences"];
    return {
      body: str(node["body"]),
      closes: Array.isArray(refs)
        ? refs.map((ref) => num(obj(ref)["number"]))
        : [],
      number: num(node["number"]),
      title: str(node["title"]),
      url: str(node["url"]),
    };
  },
  async pulls(sha) {
    const list = await json<unknown>([
      "gh",
      "api",
      `repos/${repoSlug}/commits/${sha}/pulls`,
    ]);
    if (!Array.isArray(list))
      throw new Error("qa-changes: expected pulls array");
    return list
      .map(obj)
      .filter((pr) => typeof pr["merged_at"] === "string")
      .map((pr) => num(pr["number"]));
  },
};

export async function runQaChanges(
  args: string[],
  sources: Sources = githubSources,
): Promise<number> {
  const [prev, sha] = args;
  if (!(prev && sha) || args.length !== 2) {
    console.error("usage: qa-changes <prev> <sha>");
    return 2;
  }
  try {
    console.log(JSON.stringify(await mapChanges(prev, sha, sources), null, 2));
    return 0;
  } catch (error) {
    console.error(
      `qa-changes: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
}

function obj(value: unknown): Node {
  if (typeof value !== "object" || value === null)
    throw new Error("qa-changes: expected object");
  return value as Node;
}

function str(value: unknown): string {
  if (typeof value !== "string") throw new Error("qa-changes: expected string");
  return value;
}

function num(value: unknown): number {
  if (typeof value !== "number") throw new Error("qa-changes: expected number");
  return value;
}

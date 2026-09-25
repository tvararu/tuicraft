import { labels, repoSlug } from "factory/config";
import { json } from "factory/exec";

export type Status = { name: string; state: string };
export type LabelEvent = { label: string; actor: string; at: string };

export type Pr = {
  number: number;
  state: string;
  branch: string;
  head: string;
  decision: string | null;
  draft: boolean;
  statuses: Status[];
};

export type Issue = {
  number: number;
  title: string;
  author: string;
  labels: string[];
  blockers: string[];
  events: LabelEvent[];
  prs: Pr[];
};

type Node = Record<string, unknown>;

const query = `query($q:String!){search(type:ISSUE,query:$q,first:100){nodes{... on Issue{
  number title author{login} labels(first:50){nodes{name}} blockedBy(first:20){nodes{state}}
  timelineItems(itemTypes:LABELED_EVENT,last:50){nodes{... on LabeledEvent{label{name} actor{login} createdAt}}}
  closedByPullRequestsReferences(first:5,includeClosedPrs:false){nodes{
    number state headRefName headRefOid reviewDecision isDraft
    statusCheckRollup{contexts(first:50){nodes{__typename
      ... on StatusContext{context state} ... on CheckRun{name conclusion}}}}}}}}}}`;

export function searchQuery(): string {
  const names = Object.values(labels).map((name) => `"${name}"`);
  return `repo:${repoSlug} is:issue is:open label:${names.join(",")}`;
}

export async function fetchIssues(): Promise<Issue[]> {
  const cmd = [
    "gh",
    "api",
    "graphql",
    "-f",
    `q=${searchQuery()}`,
    "-f",
    `query=${query}`,
  ];
  return parseIssues(await json<unknown>(cmd));
}

export function parseIssues(body: unknown): Issue[] {
  const search = obj(obj(obj(body)["data"])["search"]);
  return nodes(search).map(parseIssue);
}

function parseIssue(node: Node): Issue {
  return {
    author: login(node["author"]),
    blockers: nodes(node["blockedBy"]).map((blocker) => str(blocker["state"])),
    events: nodes(node["timelineItems"]).map(parseEvent),
    labels: nodes(node["labels"]).map((label) => str(label["name"])),
    number: num(node["number"]),
    prs: nodes(node["closedByPullRequestsReferences"]).map(parsePr),
    title: str(node["title"]),
  };
}

function parseEvent(node: Node): LabelEvent {
  const label = str(obj(node["label"])["name"]);
  return { actor: login(node["actor"]), at: str(node["createdAt"]), label };
}

function parsePr(node: Node): Pr {
  const decision = node["reviewDecision"];
  const rollup = node["statusCheckRollup"];
  return {
    branch: str(node["headRefName"]),
    decision: typeof decision === "string" ? decision : null,
    draft: node["isDraft"] === true,
    head: str(node["headRefOid"]),
    number: num(node["number"]),
    state: str(node["state"]),
    statuses: rollup ? nodes(obj(rollup)["contexts"]).map(parseStatus) : [],
  };
}

function parseStatus(node: Node): Status {
  if (node["__typename"] === "CheckRun") {
    const conclusion = node["conclusion"];
    return {
      name: str(node["name"]),
      state: typeof conclusion === "string" ? conclusion : "PENDING",
    };
  }
  return { name: str(node["context"]), state: str(node["state"]) };
}

function nodes(value: unknown): Node[] {
  const list = obj(value)["nodes"];
  if (!Array.isArray(list)) throw new Error("github: expected nodes array");
  return list.map(obj);
}

function obj(value: unknown): Node {
  if (typeof value !== "object" || value === null)
    throw new Error("github: expected object");
  return value as Node;
}

function str(value: unknown): string {
  if (typeof value !== "string") throw new Error("github: expected string");
  return value;
}

function num(value: unknown): number {
  if (typeof value !== "number") throw new Error("github: expected number");
  return value;
}

function login(value: unknown): string {
  return value ? str(obj(value)["login"]) : "ghost";
}

import { type BoardStatus, board, repoSlug, statusOf } from "factory/config";
import {
  graphql,
  login,
  type Node,
  nodes,
  num,
  obj,
  page,
  paginate,
  str,
} from "factory/gql";

export type Status = { name: string; state: string };
export type Marker = { id: number; body: string; at: string };
export type Verdict = { oid: string; state: string; at: string };

export type Pr = {
  number: number;
  state: string;
  base: string;
  branch: string;
  head: string;
  decision: string | null;
  draft: boolean;
  checked: string;
  statuses: Status[];
  verdicts: Verdict[];
};

export type Issue = {
  number: number;
  author: string;
  status: BoardStatus | null;
  statusAt: string;
  blockers: string[];
  markers: Marker[];
  prs: Pr[];
};

const reviewState = `status{context(name:"factory/review"){state createdAt}}`;

const query = `query($q:String!,$cursor:String){search(type:ISSUE,query:$q,first:25,after:$cursor){
  pageInfo{hasNextPage endCursor} nodes{... on Issue{
  number author{login} blockedBy(first:20){nodes{state}}
  projectItems(first:20){nodes{project{id}
    fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{optionId updatedAt}}}}
  comments(last:40){nodes{databaseId body createdAt}}
  closedByPullRequestsReferences(first:3,includeClosedPrs:false){nodes{
    number state baseRefName headRefName headRefOid reviewDecision isDraft
    history:commits(last:30){nodes{commit{oid ${reviewState}}}}
    timelineItems(itemTypes:HEAD_REF_FORCE_PUSHED_EVENT,last:30){nodes{
      ... on HeadRefForcePushedEvent{beforeCommit{oid ${reviewState}}}}}
    commits(last:1){nodes{commit{oid statusCheckRollup{contexts(first:50){nodes{__typename
      ... on StatusContext{context state} ... on CheckRun{name conclusion}}}}}}}}}}}}}`;

export function factoryPr<T extends { state: string; branch: string }>(
  issue: number,
  prs: T[],
): T | undefined {
  return prs.find(
    (pr) => pr.state === "OPEN" && pr.branch.startsWith(`factory/${issue}-`),
  );
}

export async function fetchIssues(): Promise<Issue[]> {
  const q = `repo:${repoSlug} is:issue is:open`;
  const all = await paginate(async (cursor) =>
    page((await graphql(query, { cursor, q }))["search"]),
  );
  return all.map(parseIssue);
}

function parseIssue(node: Node): Issue {
  const item = nodes(node["projectItems"]).find(
    (i) => str(obj(i["project"])["id"]) === board.project,
  );
  const value = item?.["fieldValueByName"];
  const field = value ? obj(value) : null;
  return {
    author: login(node["author"]),
    blockers: nodes(node["blockedBy"]).map((blocker) => str(blocker["state"])),
    markers: nodes(node["comments"]).flatMap(parseMarker),
    number: num(node["number"]),
    prs: nodes(node["closedByPullRequestsReferences"]).map(parsePr),
    status: field ? statusOf(str(field["optionId"])) : null,
    statusAt: field ? str(field["updatedAt"]) : "",
  };
}

function parseMarker(node: Node): Marker[] {
  const body = str(node["body"]);
  if (!body.startsWith("<!-- factory:")) return [];
  return [{ at: str(node["createdAt"]), body, id: num(node["databaseId"]) }];
}

function verdict(commit: unknown): Verdict[] {
  if (!commit) return [];
  const c = obj(commit);
  const status = c["status"];
  const context = status ? obj(status)["context"] : null;
  if (!context) return [];
  const { state, createdAt } = obj(context);
  return [{ at: str(createdAt), oid: str(c["oid"]), state: str(state) }];
}

function parsePr(node: Node): Pr {
  const decision = node["reviewDecision"];
  const [last] = nodes(node["commits"]);
  const commit = last ? obj(last["commit"]) : {};
  const rollup = commit["statusCheckRollup"];
  const seen = new Set<string>();
  const verdicts = [
    ...nodes(node["history"]).flatMap((n) => verdict(n["commit"])),
    ...nodes(node["timelineItems"]).flatMap((n) => verdict(n["beforeCommit"])),
  ].filter((v) => !seen.has(v.oid) && seen.add(v.oid));
  return {
    base: str(node["baseRefName"]),
    branch: str(node["headRefName"]),
    checked: last ? str(commit["oid"]) : "",
    decision: typeof decision === "string" ? decision : null,
    draft: node["isDraft"] === true,
    head: str(node["headRefOid"]),
    number: num(node["number"]),
    state: str(node["state"]),
    statuses: rollup ? nodes(obj(rollup)["contexts"]).map(parseStatus) : [],
    verdicts,
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

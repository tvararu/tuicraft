import {
  type BoardStatus,
  board,
  isBoardStatus,
  repo,
  statusOf,
} from "factory/config";
import { factoryPr } from "factory/github";
import { graphql, nodes, obj, str } from "factory/gql";

export type Card = {
  id: string;
  item: string | null;
  status: BoardStatus | null;
  prs: { number: number; state: string; branch: string }[];
};

const cardQuery = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){issue(number:$n){
  id projectItems(first:20){nodes{id project{id}
    fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{optionId}}}}
  closedByPullRequestsReferences(first:10,includeClosedPrs:false){nodes{number state headRefName}}}}}`;

const addMutation = `mutation($project:ID!,$content:ID!){
  added:addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{id}}}`;

const setMutation = `mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){
  updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,
    value:{singleSelectOptionId:$option}}){projectV2Item{id}}}`;

export async function readCard(issue: number): Promise<Card> {
  const data = await graphql(cardQuery, { n: issue, ...repo });
  const node = obj(obj(data["repository"])["issue"]);
  const item = nodes(node["projectItems"]).find(
    (i) => str(obj(i["project"])["id"]) === board.project,
  );
  const value = item?.["fieldValueByName"];
  return {
    id: str(node["id"]),
    item: item ? str(item["id"]) : null,
    prs: nodes(node["closedByPullRequestsReferences"]).map((pr) => ({
      branch: str(pr["headRefName"]),
      number: Number(pr["number"]),
      state: str(pr["state"]),
    })),
    status: value ? statusOf(str(obj(value)["optionId"])) : null,
  };
}

export function readyRefusal(issue: number, card: Card): string | null {
  if (factoryPr(issue, card.prs)) return null;
  return `#${issue} has no open factory/${issue}-… PR; only the maintainer moves fresh cards to Ready`;
}

export async function addToBoard(contentId: string): Promise<string> {
  const data = await graphql(addMutation, {
    content: contentId,
    project: board.project,
  });
  return str(obj(obj(data["added"])["item"])["id"]);
}

export async function setItemStatus(
  item: string,
  status: BoardStatus,
): Promise<void> {
  await graphql(setMutation, {
    field: board.field,
    item,
    option: board.options[status],
    project: board.project,
  });
}

export async function setStatus(
  issue: number,
  status: BoardStatus,
  card?: Card,
): Promise<void> {
  const known = card ?? (await readCard(issue));
  const item = known.item ?? (await addToBoard(known.id));
  await setItemStatus(item, status);
}

const usage = `usage: status <issue> [${Object.keys(board.options).join("|")}]`;

export async function runStatus(args: string[]): Promise<number> {
  const [issueArg, want] = args;
  const issue = Number(issueArg);
  if (!(Number.isInteger(issue) && issue > 0) || args.length > 2) {
    console.error(usage);
    return 2;
  }
  if (want !== undefined && !isBoardStatus(want)) {
    console.error(usage);
    return 2;
  }
  const card = await readCard(issue);
  if (want === undefined) {
    console.log(JSON.stringify({ issue, status: card.status }));
    return 0;
  }
  const refusal = want === "ready" ? readyRefusal(issue, card) : null;
  if (refusal !== null) {
    console.error(`status: ${refusal}`);
    return 1;
  }
  await setStatus(issue, want, card);
  console.log(JSON.stringify({ issue, status: want }));
  return 0;
}

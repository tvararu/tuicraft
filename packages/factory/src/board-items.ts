import { type BoardStatus, board, repoSlug, statusOf } from "#factory/config";
import { json } from "#factory/exec";
import { graphql, type Node, obj, page, paginate, str } from "#factory/gql";

export type OpenIssue = {
  number: number;
  title: string;
  author: string;
  labels: string[];
};

export type BoardItem = {
  item: string;
  status: BoardStatus | null;
  issue: number | null;
  draft: { id: string; title: string; body: string } | null;
};

const itemsQuery = `query($project:ID!,$cursor:String){node(id:$project){... on ProjectV2{
  items(first:100,after:$cursor){pageInfo{hasNextPage endCursor}
    nodes{id type fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{optionId}}
      content{... on DraftIssue{id title body} ... on Issue{number repository{nameWithOwner}}}}}}}}`;

export function parseItem(node: Node): BoardItem {
  const value = node["fieldValueByName"];
  const content = node["content"] ? obj(node["content"]) : {};
  const optionId = value ? obj(value)["optionId"] : undefined;
  const repository = content["repository"];
  const ours =
    node["type"] === "ISSUE" &&
    repository !== undefined &&
    str(obj(repository)["nameWithOwner"]) === repoSlug;
  return {
    draft:
      node["type"] === "DRAFT_ISSUE"
        ? {
            body: str(content["body"]),
            id: str(content["id"]),
            title: str(content["title"]),
          }
        : null,
    issue: ours ? Number(content["number"]) : null,
    item: str(node["id"]),
    status: typeof optionId === "string" ? statusOf(optionId) : null,
  };
}

export async function boardItems(): Promise<BoardItem[]> {
  const all = await paginate(async (cursor) => {
    const data = await graphql(itemsQuery, { cursor, project: board.project });
    return page(obj(obj(data["node"])["items"]));
  });
  return all.map(parseItem);
}

export async function openIssues(): Promise<OpenIssue[]> {
  const list = await json<
    {
      number: number;
      title: string;
      author: { login: string } | null;
      labels: { name: string }[];
    }[]
  >([
    "gh",
    "issue",
    "list",
    "-R",
    repoSlug,
    "--state",
    "open",
    "--limit",
    "1000",
    "--json",
    "number,title,author,labels",
  ]);
  return list.map(({ number, title, author, labels }) => ({
    author: author?.login ?? "ghost",
    labels: labels.map(({ name }) => name),
    number,
    title,
  }));
}

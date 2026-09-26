import { json } from "factory/exec";

export type Node = Record<string, unknown>;
export type Vars = Record<string, string | number | null>;

export async function graphql(query: string, vars: Vars = {}): Promise<Node> {
  const args = Object.entries(vars).flatMap(([key, value]) => {
    if (value === null) return [];
    return [typeof value === "number" ? "-F" : "-f", `${key}=${value}`];
  });
  const body = await json<unknown>([
    "gh",
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    ...args,
  ]);
  return obj(obj(body)["data"]);
}

export function nodes(value: unknown): Node[] {
  const list = obj(value)["nodes"];
  if (!Array.isArray(list)) throw new Error("github: expected nodes array");
  return list.map(obj);
}

export function obj(value: unknown): Node {
  if (typeof value !== "object" || value === null)
    throw new Error("github: expected object");
  return value as Node;
}

export function str(value: unknown): string {
  if (typeof value !== "string") throw new Error("github: expected string");
  return value;
}

export function num(value: unknown): number {
  if (typeof value !== "number") throw new Error("github: expected number");
  return value;
}

export function login(value: unknown): string {
  return value ? str(obj(value)["login"]) : "ghost";
}

export type Page = { nodes: Node[]; next: string | null };

export function page(value: unknown): Page {
  const info = obj(obj(value)["pageInfo"]);
  return {
    next: info["hasNextPage"] === true ? str(info["endCursor"]) : null,
    nodes: nodes(value),
  };
}

export async function paginate(
  fetchPage: (cursor: string | null) => Promise<Page>,
): Promise<Node[]> {
  const all: Node[] = [];
  let cursor: string | null = null;
  do {
    const { nodes: batch, next } = await fetchPage(cursor);
    all.push(...batch);
    cursor = next;
  } while (cursor !== null);
  return all;
}

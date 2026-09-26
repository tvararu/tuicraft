import { describe, expect, test } from "bun:test";
import { listView } from "#factory/soap-cli";

const entry = {
  account: "FAC6AB6E05F5A",
  character: "Fgklgoafpfk",
  createdAt: "2026-09-26T00:00:00.000Z",
  owner: "test",
  password: "hunter2hunter2",
  preset: "elwynn10" as const,
};

describe("listView", () => {
  test("leaves passwords out by default", () => {
    const [shown] = listView([entry]);
    expect(shown).toEqual({
      account: "FAC6AB6E05F5A",
      character: "Fgklgoafpfk",
      createdAt: "2026-09-26T00:00:00.000Z",
      owner: "test",
      preset: "elwynn10",
    });
    expect(JSON.stringify(listView([entry]))).not.toContain("hunter2");
  });

  test("--with-passwords keeps them", () => {
    expect(listView([entry], true)).toEqual([entry]);
  });
});

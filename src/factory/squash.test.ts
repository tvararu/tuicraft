import { describe, expect, test } from "bun:test";
import { squashMessage, subjectProblem, why } from "factory/squash";

const source = {
  body: "Agents need X because Y.\n\nFixes #12\n\n## Proof\n\nran it",
  issues: [12, 13],
  number: 40,
  title: "feat: Add X",
};

describe("squashMessage", () => {
  test("title, why, then one trailer block crediting the maintainer", () => {
    expect(squashMessage(source)).toEqual({
      body: [
        "Agents need X because Y.",
        "",
        "Refs: #12",
        "Refs: #13",
        "PR: #40",
        "Co-authored-by: Theodor Vararu <theo@vararu.org>",
      ].join("\n"),
      subject: "feat: Add X",
    });
  });

  test("refuses a PR without a why paragraph or a closed issue", () => {
    expect(() =>
      squashMessage({ ...source, body: "Fixes #12\n\n## Proof" }),
    ).toThrow("no why paragraph");
    expect(() => squashMessage({ ...source, issues: [] })).toThrow(
      "closes no issue",
    );
  });

  test("refuses a title the commit hooks would reject", () => {
    expect(() =>
      squashMessage({ ...source, title: "feat: add lowercase" }),
    ).toThrow("Conventional");
  });
});

describe("subjectProblem", () => {
  test("allows scopes and breaking marks up to 50 characters", () => {
    expect(subjectProblem("fix(factory)!: Land by squash")).toBeNull();
    expect(subjectProblem(`chore: ${"A".repeat(43)}`)).toBeNull();
    expect(subjectProblem(`chore: ${"A".repeat(44)}`)).toContain("51");
    expect(subjectProblem("Update things")).toContain("Conventional");
  });
});

describe("why", () => {
  test("takes the first lead paragraph, drops closing lines, wraps at 72", () => {
    const long = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
    const text = why(`Fixes #1\n${long}\nstill first\n\nsecond\n## Proof`);
    expect(text.split("\n").every((line) => line.length <= 72)).toBe(true);
    expect(text.replaceAll("\n", " ")).toBe(`${long} still first`);
  });

  test("is empty when the body starts with a heading", () => {
    expect(why("## Summary\n\ntext")).toBe("");
  });
});

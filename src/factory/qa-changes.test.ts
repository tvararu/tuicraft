import { describe, expect, test } from "bun:test";
import {
  type Commit,
  type IssueInfo,
  keywordIssues,
  logFormat,
  mapChanges,
  type PrInfo,
  parseLog,
  type Sources,
  section,
} from "factory/qa-changes";
import { git } from "test/git";

function commit(sha: string, extra: Partial<Commit> = {}): Commit {
  return {
    body: "",
    prs: [],
    refs: [],
    sha,
    subject: `subject ${sha}`,
    ...extra,
  };
}

function fakeSources(
  log: Commit[],
  pulls: Record<string, number[]>,
  prs: PrInfo[],
): Sources & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async issue(number): Promise<IssueInfo> {
      calls.push(`issue ${number}`);
      const body = `Intro\n\n## Acceptance criteria\n\n- works ${number}\n\n## Notes\n\nlater`;
      return {
        body,
        number,
        state: "CLOSED",
        title: `issue ${number}`,
        url: `u/${number}`,
      };
    },
    async log() {
      return log;
    },
    async pr(number) {
      calls.push(`pr ${number}`);
      const found = prs.find((info) => info.number === number);
      if (!found) throw new Error(`no pr ${number}`);
      return found;
    },
    async pulls(sha) {
      calls.push(`pulls ${sha}`);
      return pulls[sha] ?? [];
    },
  };
}

function pr(number: number, extra: Partial<PrInfo> = {}): PrInfo {
  return {
    body: "",
    closes: [],
    number,
    title: `pr ${number}`,
    url: `p/${number}`,
    ...extra,
  };
}

describe("mapChanges", () => {
  test("several commits from one PR share one PR and issue", async () => {
    const sources = fakeSources(
      [commit("a"), commit("b")],
      { a: [95], b: [95] },
      [pr(95, { body: "Fixes #93\n\n## Proof\n\nran it", closes: [93] })],
    );
    const changes = await mapChanges("p", "b", sources);
    expect(changes.range).toBe("p..b");
    expect(
      changes.commits.map((c) => [c.sha, c.source, c.prs, c.issues]),
    ).toEqual([
      ["a", "api", [95], [93]],
      ["b", "api", [95], [93]],
    ]);
    expect(changes.prs).toEqual([
      {
        issues: [93],
        number: 95,
        proof: "ran it",
        title: "pr 95",
        url: "p/95",
      },
    ]);
    expect(changes.issues).toEqual([
      {
        acceptance: "- works 93",
        number: 93,
        prs: [95],
        state: "CLOSED",
        title: "issue 93",
        url: "u/93",
      },
    ]);
    expect(sources.calls.filter((call) => call.startsWith("pr "))).toEqual([
      "pr 95",
    ]);
  });

  test("a commit with no PR falls back to its message", async () => {
    const direct = commit("c", { body: "why it changed" });
    const sources = fakeSources([direct], {}, []);
    const changes = await mapChanges("p", "c", sources);
    expect(changes.commits).toEqual([
      {
        body: "why it changed",
        issues: [],
        prs: [],
        sha: "c",
        source: "none",
        subject: "subject c",
      },
    ]);
    expect(changes.prs).toEqual([]);
    expect(changes.issues).toEqual([]);
  });

  test("a PR closing several issues links all of them", async () => {
    const body = "Fixes #11, closes #12 and resolves: #13";
    const sources = fakeSources([commit("a")], { a: [20] }, [
      pr(20, { body, closes: [10, 11] }),
    ]);
    const changes = await mapChanges("p", "a", sources);
    expect(changes.commits[0]?.issues).toEqual([10, 11, 12, 13]);
    expect(changes.prs[0]?.proof).toBeNull();
    expect(changes.issues.map((issue) => [issue.number, issue.prs])).toEqual([
      [10, [20]],
      [11, [20]],
      [12, [20]],
      [13, [20]],
    ]);
  });

  test("trailers skip the API lookup and add their issues", async () => {
    const tagged = commit("t", { prs: [30], refs: [31] });
    const sources = fakeSources([tagged, commit("u")], { u: [40] }, [
      pr(30),
      pr(40, { closes: [41] }),
    ]);
    const changes = await mapChanges("p", "u", sources);
    expect(
      changes.commits.map((c) => [c.sha, c.source, c.prs, c.issues]),
    ).toEqual([
      ["t", "trailers", [30], [31]],
      ["u", "api", [40], [41]],
    ]);
    expect(changes.prs.map((p) => [p.number, p.issues])).toEqual([
      [30, [31]],
      [40, [41]],
    ]);
    expect(sources.calls).not.toContain("pulls t");
  });
});

describe("parseLog", () => {
  test("reads fields and trailer numbers from the log format", () => {
    const out =
      "aaa\x1ffeat: One\x1fwhy one\n\nRefs: #5\nPR: #6\n\x1f#5\x1f#6\x1e\n" +
      "bbb\x1fchore: Two\x1f\x1f\x1f\x1e\n";
    expect(parseLog(out)).toEqual([
      {
        body: "why one\n\nRefs: #5\nPR: #6",
        prs: [6],
        refs: [5],
        sha: "aaa",
        subject: "feat: One",
      },
      { body: "", prs: [], refs: [], sha: "bbb", subject: "chore: Two" },
    ]);
  });

  test("reads trailers from a real commit", async () => {
    const dir = `${process.cwd()}/tmp/qa-changes-${Date.now()}`;
    try {
      await Bun.$`mkdir -p ${dir}`.quiet();
      await git(dir, "init", "-q");
      const identity = [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "-c",
        "core.hooksPath=/dev/null",
      ];
      await git(
        dir,
        ...identity,
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "chore: Base",
      );
      await git(
        dir,
        ...identity,
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "feat: X",
        "-m",
        "Why.",
        "-m",
        "Refs: #7, #8\nPR: #9",
      );
      const out = await git(
        dir,
        "log",
        "--reverse",
        `--format=${logFormat()}`,
        "HEAD~1..HEAD",
      );
      expect(parseLog(out).map((c) => [c.subject, c.refs, c.prs])).toEqual([
        ["feat: X", [7, 8], [9]],
      ]);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });
});

describe("section", () => {
  test("stops at the next heading of the same level, not inside fences", () => {
    const body =
      "## Proof\n\n```sh\n# not a heading\n```\n\n### Detail\n\nmore\n\n## Next\n\nno";
    expect(section(body, "proof")).toBe(
      "```sh\n# not a heading\n```\n\n### Detail\n\nmore",
    );
  });

  test("is null when missing or empty", () => {
    expect(section("## Other\n\ntext", "proof")).toBeNull();
    expect(section("## Proof\n\n## Next", "proof")).toBeNull();
  });
});

test("keywordIssues ignores plain references", () => {
  expect(keywordIssues("See #1. Fixed #2, fixes #3")).toEqual([2, 3]);
});

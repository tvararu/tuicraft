export type DocKind = "instructions" | "evidence";
export type Doc = { path: string; text: string; kind: DocKind };
export type Finding = {
  path: string;
  line: number;
  match: string;
  reason: string;
};

type Rule = {
  pattern: RegExp;
  reason: string;
  allow?: (match: string) => boolean;
};

const tmpOutputs = [
  "namigator/",
  "worktree-archive-<date>/",
  "squash.json",
  "qa-changes.json",
];

const tmpPrefix = /^(?:\.\/)?tmp\//;
const whitespace = /\s+/g;

const historyRules: Rule[] = [
  {
    pattern: /\b(?:since|until|as\s+of)\s+\d{4}-\d{2}-\d{2}/g,
    reason: "dated history: state the current rule",
  },
  {
    pattern: /\bon\s+\d{4}-\d{2}-\d{2}/g,
    reason: "says when something changed: state what holds now",
  },
  {
    pattern:
      /\b(?:ruling|review|decision|cleanup)\s+of\s+\d{4}-\d{2}-\d{2}|\b\d{4}-\d{2}-\d{2}\s+(?:ruling|review|decision|cleanup)\b/g,
    reason: "cites a dated event: state the rule it set",
  },
  {
    pattern:
      /\b(?:was|were|has\s+been|have\s+been)\s+(?:deleted|removed|retired|dropped|archived)\b/g,
    reason: "narrates a removal: say what exists now",
  },
  {
    pattern: /\bat\s+the\s+maintainer's\s+request\b/g,
    reason: "narrates who asked: state the rule",
  },
];

const deadRules: Rule[] = [
  {
    allow: (match) => {
      const path = match.replace(tmpPrefix, "");
      return path === "" || tmpOutputs.some((p) => path.startsWith(p));
    },
    pattern: /(?<![\w./-])(?:\.\/)?tmp\/(?:[^\s`'"),;]*[^\s`'"),;.:])?/g,
    reason:
      "points under tmp/, which is ephemeral: link a committed file or say it is not committed",
  },
  {
    pattern: /\b(?:DECISIONS|JOURNAL)\.md\b|\bovn-|\bgameplay-\*/g,
    reason: "names a deleted notes file or worktree",
  },
  {
    pattern: /\bfactory-(?:worker|reviewer|merger|qa)\b/g,
    reason: "old automation name: the automations are work, review, merge, qa",
  },
];

const sources: Record<DocKind, string[]> = {
  evidence: ["docs/evidence/*.md", "docs/evidence/**/README.md"],
  instructions: [
    "AGENTS.md",
    "README.md",
    "docs/*.md",
    "src/factory/prompts/*.md",
    "src/cli/help.ts",
    ".claude/skills/tuicraft/SKILL.md",
  ],
};

function findings(doc: Doc, rule: Rule): Finding[] {
  return [...doc.text.matchAll(rule.pattern)]
    .filter(([match]) => !rule.allow?.(match))
    .map(({ 0: match, index }) => ({
      line: doc.text.slice(0, index).split("\n").length,
      match: match.replace(whitespace, " "),
      path: doc.path,
      reason: rule.reason,
    }));
}

export function staleFindings(doc: Doc): Finding[] {
  const rules =
    doc.kind === "instructions" ? [...historyRules, ...deadRules] : deadRules;
  return rules
    .flatMap((rule) => findings(doc, rule))
    .sort((a, b) => a.line - b.line);
}

async function load(root: string): Promise<Doc[]> {
  const docs = new Map<string, Doc>();
  for (const [kind, patterns] of Object.entries(sources) as [
    DocKind,
    string[],
  ][])
    for (const pattern of patterns)
      for await (const path of new Bun.Glob(pattern).scan({
        cwd: root,
        dot: true,
      }))
        docs.set(path, {
          kind,
          path,
          text: await Bun.file(`${root}/${path}`).text(),
        });
  return [...docs.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function main(): Promise<void> {
  const found = (await load(process.cwd())).flatMap(staleFindings);
  for (const f of found)
    console.error(`${f.path}:${f.line}: ${f.reason}: ${f.match}`);
  if (found.length === 0) return;
  console.error(
    `${found.length} stale passage(s); see "Documentation" in AGENTS.md`,
  );
  process.exitCode = 1;
}

if (import.meta.main) await main();

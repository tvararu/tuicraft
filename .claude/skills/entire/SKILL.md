---
name: entire
description: Use when the user asks why a change was made, what the reasoning behind code was, or wants to understand the context of past agent sessions and commits
---

# Entire Introspect

Query the `entire` CLI to recover the full reasoning context behind code changes — prompts, decisions, trade-offs, and rejected alternatives.

## Quick Reference

| Goal                       | Command                                     |
| -------------------------- | ------------------------------------------- |
| Active sessions            | `entire status`                             |
| List checkpoints on branch | `entire explain --no-pager`                 |
| Explain a commit           | `entire explain --commit <sha> --no-pager`  |
| Checkpoint summary         | `entire explain -c <id> --short --no-pager` |
| Checkpoint with prompts    | `entire explain -c <id> --no-pager`         |
| Full transcript            | `entire explain -c <id> --full --no-pager`  |
| Filter by session          | `entire explain --session <id> --no-pager`  |
| Search all branches        | `entire explain --search-all --no-pager`    |

Always pass `--no-pager` — interactive pagers block non-interactive shells.

## Workflow

1. **Find the commit** — `git log`, `git blame`, or the user provides a SHA/file path
2. **Get the checkpoint** — `entire explain --commit <sha> --no-pager`
3. **Read the context** — default view shows intent, files, and scoped transcript. Escalate to `--full` only if the scoped view is insufficient.
4. **Summarize** — extract the intent, constraints considered, alternatives rejected, and trade-offs accepted

## Output Anatomy

```
Checkpoint: 475e4ca1a6a5          ← checkpoint ID (use with -c flag)
Session: e2c8984d-f259...         ← session ID (use with --session flag)
Created: 2026-02-23 00:30:27
Tokens: 4939429

Commits: (1)
  7be9939 feat: Switch READ_WAIT to window-based slicing

Intent: What's simplest to implement and least surprising?

Files: (2)
  - src/daemon/commands.ts
  - src/daemon/commands.test.ts

Transcript (checkpoint scope):       ← conversation excerpts
[User] ...
[Assistant] ...
```

## Tips

- `--commit` accepts any commit-ish: SHA, `HEAD~2`, branch name
- Pipe through `head -n 100` when `--full` output is very long
- If a commit has no checkpoint, it was made outside an agent session
- Entire was enabled on 2026-02-23 — commits before that date have no checkpoints
- The `Intent` field is the user prompt that triggered the checkpoint — start there

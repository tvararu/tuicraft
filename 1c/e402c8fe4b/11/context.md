# Session Context

## User Prompts

### Prompt 1

Read docs/plans/2026-03-04-mail-plan.md. Tasks 1 and 2 are already committed on branch feat/mail. Execute Tasks 3 through 10, committing after each task. Run mise test after each commit. After all tasks, run mise ci. Then open a PR against main with title "feat: In-game mail support" and a short prose description. When completely done, run: openclaw system event --text "Done: mail PR opened" --mode now

### Prompt 2

Base directory for this skill: /home/openclaw/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/executing-plans

# Executing Plans

## Overview

Load plan, review critically, execute tasks in batches, report for review between batches.

**Core principle:** Batch execution with checkpoints for architect review.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

## The Process

### Step 1: Load and Review Plan
1. Read plan file
2. Review ...

### Prompt 3

Base directory for this skill: /home/openclaw/code/tuicraft/.claude/skills/typescript-style

# TypeScript Style

Prettier with defaults handles formatting.
This covers structure and taste.

## Types

- `type` only. No `interface`, no `enum`.
- `as const` objects for opcode tables and constant maps.
- Unions for enumerations: `type Status = "active" | "pending"`
- Never `any`. Reserve `unknown` for true boundaries. If you know the type, use
  it.
- Discriminated unions over loose fields. `User...


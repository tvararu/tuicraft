# Session Context

## User Prompts

### Prompt 1

Base directory for this skill: /home/openclaw/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/using-superpowers

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

This is not negotiable. This is not optional. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

## How to Access Skills

*...

### Prompt 2

Base directory for this skill: /home/openclaw/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/brainstorming

# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.

<HARD-GATE>
Do NOT invoke any imp...

### Prompt 3

Track SMSG_SHOW_MAILBOX. Store the GUID when the server sends it. /mail commands should error with a clear message if no mailbox GUID is stored. This is the simplest correct approach — we can add auto-use later if needed. The user might be near a mailbox at login, or interact with one via playerbot commands. Go with option 1.

### Prompt 4

Continue from where you left off.

### Prompt 5

Quoted strings. /mail send Player "Subject" body text here. Familiar, clean, consistent with how shells work. Option 1.

### Prompt 6

Continue from where you left off.

### Prompt 7

Sequential indices. Much better UX. /mail read 1 is clean. Reset on each refresh. Option 1. Now move on to writing the plan please — no more questions needed, make reasonable decisions for anything remaining.

### Prompt 8

Design looks good. Write the plan. /superpowers:write-plan

### Prompt 9

Base directory for this skill: /home/openclaw/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/writing-plans

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commi...

### Prompt 10

Continue from where you left off.

### Prompt 11

Execute the plan. Branch, implement, open PR. When completely finished, run: openclaw system event --text "Done: mail feature implemented and PR opened" --mode now

### Prompt 12

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

### Prompt 13

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

### Prompt 14

Continue from where you left off.

### Prompt 15

Continue executing the plan. You were interrupted. You created the feat/mail branch but have no commits yet. Implement the plan task by task, commit after each task, then open the PR. When done, run: openclaw system event --text "Done: mail feature PR opened" --mode now

### Prompt 16

Continue from where you left off.

### Prompt 17

Good progress — Task 1 files are written and all 31 tests pass. Commit Task 1 now, then continue with Task 2. Keep going through all tasks. When completely done and PR is opened, run: openclaw system event --text "Done: mail PR opened" --mode now

### Prompt 18

Continue from where you left off.

### Prompt 19

Task 1 committed. Continue with Task 2 and onwards. When done and PR opened, run: openclaw system event --text "Done: mail PR" --mode now

### Prompt 20

Continue. You were working on Task 2 (world-handlers.ts is modified). Finish it and keep going through all remaining tasks. When done and PR opened, run: openclaw system event --text "Done: mail PR" --mode now


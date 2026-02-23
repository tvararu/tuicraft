# Session Context

## User Prompts

### Prompt 1

Base directory for this skill: /Users/deity/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/using-superpowers

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

This is not negotiable. This is not optional. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

## How to Access Skills

**In C...

### Prompt 2

Base directory for this skill: /Users/deity/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/brainstorming

# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.

<HARD-GATE>
Do NOT invoke any implemen...

### Prompt 3

What's simplest to implement and least surprising?

### Prompt 4

What is least surprising, most idiomatic, easiest to build?

### Prompt 5

Base directory for this skill: /Users/deity/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/writing-plans

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

...

### Prompt 6

Is this a regression in how `tuicraft read` works? I'm not sure I like it always returning a full buffer, that would be spammy

### Prompt 7

Base directory for this skill: /Users/deity/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/subagent-driven-development

# Subagent-Driven Development

Execute plan by dispatching fresh subagent per task, with two-stage review after each: spec compliance review first, then code quality review.

**Core principle:** Fresh subagent per task + two-stage review (spec then quality) = high quality, fast iteration

## When to Use

```dot
digraph when_to_use {
    "Have implementat...

### Prompt 8

Base directory for this skill: /Users/deity/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/finishing-a-development-branch

# Finishing a Development Branch

## Overview

Guide completion of development work by presenting clear options and handling chosen workflow.

**Core principle:** Verify tests → Present options → Execute choice → Clean up.

**Announce at start:** "I'm using the finishing-a-development-branch skill to complete this work."

## The Process

### Ste...

### Prompt 9

Compare to #47, which has the better implementation?

### Prompt 10

Can you bump coverage to 100%?

### Prompt 11

src/test/mock-world-server.ts |   96.15 |   98.47 | 166-169

Fix this

### Prompt 12

• The new window-based READ_WAIT logic introduces a message-loss gap for polling clients
  like tail. Because events that arrive between polls are excluded from both windows,
  behavior is no longer a reliable continuous stream.

  Review comment:

  - [P1] Include events that arrive between READ_WAIT polls — /Users/deity/Code/tuicraft/
    src/daemon/commands.ts:224-224
    READ_WAIT now snapshots events.writePos at request start and only returns slice(start)
    after the timeout, which dr...

### Prompt 13

All good /compact

### Prompt 14

This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

Analysis:
Let me chronologically analyze the conversation:

1. User initiated brainstorming for a tail/read socket conflict design problem in tuicraft (a WoW TUI client)
2. The core problem: `tuicraft tail` polls with `READ_WAIT*`, draining the same shared ring buffer used by `read` and `--wait` flows, causing contention
3. Through brainstorming...

### Prompt 15

I added some Entire hooks/stuff, do you have knowledge/access to them?

### Prompt 16

Interesting, I don't know either how it works, can you try the `entire` CLI, look up their docs, research, figure stuff out? Maybe there's a skill for you somewhere?

### Prompt 17

You have a skill for writing skills right?

### Prompt 18

Yes, can you write a skill (project-local) that can be used to introspect with `entire` as to why stuff was done in a certain way?

### Prompt 19

Base directory for this skill: /Users/deity/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/writing-skills

# Writing Skills

## Overview

**Writing skills IS Test-Driven Development applied to process documentation.**

**Personal skills live in agent-specific directories (`~/.claude/skills` for Claude Code, `~/.agents/skills/` for Codex)** 

You write test cases (pressure scenarios with subagents), watch them fail (baseline behavior), write the skill (documentation), watc...

### Prompt 20

Willl the skill be automatically invoked?

### Prompt 21

Add something to note that there are no entire trailers before today's date

### Prompt 22

Yeah test with a subagent, ask it something about `tuicraft tail`

### Prompt 23

Let's try adding it to CLAUDE and then give it another shot

### Prompt 24

Give me a prompt, i'll try it in a fresh claude window, but commit first in a new branch


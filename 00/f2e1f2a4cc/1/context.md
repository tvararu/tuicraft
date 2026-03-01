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

Add text emote support: /e and /emote slash commands. This sends a chat message with CHAT_MSG_EMOTE type. Also handle receiving emotes from other players. Look at how say/yell work and follow the same pattern. This is tiny — branch, implement with full test coverage, and open a PR. Use feat: prefix for commits.

### Prompt 3

Base directory for this skill: /home/openclaw/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/brainstorming

# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.

<HARD-GATE>
Do NOT invoke any imp...

### Prompt 4

Yes, proceed. Branch, implement, test, PR. Don't ask more questions.

### Prompt 5

Base directory for this skill: /home/openclaw/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/verification-before-completion

# Verification Before Completion

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

**Violating the letter of this rule is violating the spirit of this rule.**

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you ha...

### Prompt 6

You are a senior security engineer conducting a focused security review of the changes on this branch.

GIT STATUS:

```
On branch feat/text-emote
Your branch is up to date with 'origin/feat/text-emote'.

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	docs/plans/2026-02-19-reconnect-auth-design.md
	docs/plans/2026-02-19-reconnect-auth-plan.md

nothing added to commit but untracked files present (use "git add" to track)
```

FILES MODIFIED:

```
.claude/skil...

### Prompt 7

You are an expert code reviewer. Follow these steps:

      1. If no PR number is provided in the args, run `gh pr list` to show open PRs
      2. If a PR number is provided, run `gh pr view <number>` to get PR details
      3. Run `gh pr diff <number>` to get the diff
      4. Analyze the changes and provide a thorough code review that includes:
         - Overview of what the PR does
         - Analysis of code quality and style
         - Specific suggestions for improvements
         - An...

### Prompt 8

Base directory for this skill: /home/openclaw/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/requesting-code-review

# Requesting Code Review

Dispatch superpowers:code-reviewer subagent to catch issues before they cascade.

**Core principle:** Review early, review often.

## When to Request Review

**Mandatory:**
- After each task in subagent-driven development
- After completing major feature
- Before merge to main

**Optional but valuable:**
- When stuck (fresh pers...


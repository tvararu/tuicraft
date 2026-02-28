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

I want to implement SMSG_CONTACT_LIST (friend list) support. This is the only item in docs/bugs.md. The server already sends this packet at login. I want: 1) Parse SMSG_CONTACT_LIST (0x0067) — the format is described in bugs.md. 2) Store friend entries somewhere sensible. 3) Add a /friends slash command to display the list in the TUI. 4) Add CMSG_ADD_FRIEND / CMSG_DEL_FRIEND so users can /friend add <name> and /friend remove <name>. 5) Handle SMSG_FRIEND_STATUS for real-time updates (friend c...

### Prompt 3

Base directory for this skill: /home/openclaw/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/brainstorming

# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.

<HARD-GATE>
Do NOT invoke any imp...

### Prompt 4

Friends only. Parse all entry types from the packet but only store and expose friends for now. Ignored/muted can come later. Now write the implementation plan. /superpowers:write-plan

### Prompt 5

Design looks good. Proceed — write the implementation plan and then execute it. Branch, implement, get tests passing, open a PR. Don't ask me any more questions — make reasonable decisions yourself. /superpowers:write-plan

### Prompt 6

Base directory for this skill: /home/openclaw/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/writing-plans

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commi...


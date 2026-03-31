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

Implement guild roster support. This involves: 1) Send CMSG_GUILD_ROSTER to request the roster. 2) Parse SMSG_GUILD_ROSTER response — contains member list with names, ranks, online status, level, class, zone, notes, etc. 3) Add a /guild roster or /groster command to display the roster in the TUI. 4) Store guild members and handle updates. Check wow_messages and AzerothCore source for the exact packet format. This is medium complexity — brainstorm the design first. /superpowers:brainstorming

### Prompt 3

Base directory for this skill: /home/openclaw/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/brainstorming

# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.

<HARD-GATE>
Do NOT invoke any imp...

### Prompt 4

1) Show MOTD and guild info at the top, then the member list. 2) Send CMSG_GUILD_QUERY for rank names. Proceed with the design and then implement. Branch, full test coverage, PR. Don't ask more questions — make reasonable decisions.

### Prompt 5

Design looks good. Skip the plan doc — go straight to implementation. Branch, implement, test, PR. No more questions.

### Prompt 6

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

### Prompt 7

This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

Analysis:
Let me chronologically analyze the conversation:

1. **Initial Request**: User asked to implement guild roster support with specific requirements:
   - Send CMSG_GUILD_ROSTER to request the roster
   - Parse SMSG_GUILD_ROSTER response
   - Add /guild roster or /groster command
   - Store guild members and handle updates
   - Check w...

### Prompt 8

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

### Prompt 9

Base directory for this skill: /home/openclaw/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/finishing-a-development-branch

# Finishing a Development Branch

## Overview

Guide completion of development work by presenting clear options and handling chosen workflow.

**Core principle:** Verify tests → Present options → Execute choice → Clean up.

**Announce at start:** "I'm using the finishing-a-development-branch skill to complete this work."

## The Process

### Step...


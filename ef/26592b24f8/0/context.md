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

Option A — context-aware dispatch. Track a "pending request" state (group invite or duel request), and /accept /decline route based on which arrived most recently. If nothing is pending, show an error. Also add /duel <name> to initiate a duel request. Now write the plan.

### Prompt 4

Design is good, but drop /duel <name> initiation — CMSG_CAST_SPELL is complex and we dont have spell casting infrastructure yet. Just handle incoming duel requests (all 6 SMSG handlers) and accept/decline via context-aware /accept /decline. We can add duel initiation later when we build spell casting. Also: update the README mail notifications row to ✅ while youre at it — it was implemented in the last PR but the table is stale. Now /superpowers:write-plan


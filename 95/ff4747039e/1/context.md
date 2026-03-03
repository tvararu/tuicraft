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

/superpowers:brainstorming

Implement mail notifications (SMSG_RECEIVED_MAIL). When the server notifies us that new mail has arrived, display a system message in chat like "[Mail] You have new mail." This is receive-only — we are NOT implementing the full mailbox (reading/sending mail). Just the notification.

Scope:
- Handle SMSG_RECEIVED_MAIL opcode (0x0285)
- Display a notification in the TUI and daemon output
- Add /mail command stub that says "Mail reading not yet implemented" (so users ...

### Prompt 3

Base directory for this skill: /home/openclaw/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/brainstorming

# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.

<HARD-GATE>
Do NOT invoke any imp...

### Prompt 4

Lowercase [mail] — match existing conventions. Design looks good. Proceed.


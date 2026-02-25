# Session Context

## User Prompts

### Prompt 1

What's the next big thing to work on?

### Prompt 2

I think I'd like something related to v0.4, actually parsing nearby NPCs and game objects

/using-superpowers 
/brainstorming

### Prompt 3

Base directory for this skill: /Users/deity/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/using-superpowers

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

This is not negotiable. This is not optional. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

## How to Access Skills

**In C...

### Prompt 4

Base directory for this skill: /Users/deity/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/brainstorming

# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.

<HARD-GATE>
Do NOT invoke any implemen...

### Prompt 5

[Request interrupted by user for tool use]

### Prompt 6

Sorry, ask me again

### Prompt 7

Both, but awareness first

### Prompt 8

Do we need something like an entity component system?

### Prompt 9

yes

### Prompt 10

Is it hard to do everything in one go?

### Prompt 11

yes

### Prompt 12

I'm afraid of adding commands that are not part of the standard wow slash command set...

### Prompt 13

Yeah, events in the chat log but we might need a verbosity setting as it can be quite spammy by default

### Prompt 14

Simple to begin with

### Prompt 15

Any downside to eager? what does the game client do?

### Prompt 16

yes

### Prompt 17

Store positions

### Prompt 18

100% test coverage :nerd:

### Prompt 19

B

### Prompt 20

yes

### Prompt 21

yes

### Prompt 22

yes

### Prompt 23

yes

### Prompt 24

yes

### Prompt 25

I like slash tuicraft as the namespace

yes

### Prompt 26

Perhaps a live test which logs in as a second character and tests that the first instance sees it? We have Xia and Yia for this purpose

### Prompt 27

yes

### Prompt 28

Base directory for this skill: /Users/deity/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/writing-plans

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

...

### Prompt 29

1 sdd using this branch

### Prompt 30

Base directory for this skill: /Users/deity/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/subagent-driven-development

# Subagent-Driven Development

Execute plan by dispatching fresh subagent per task, with two-stage review after each: spec compliance review first, then code quality review.

**Core principle:** Fresh subagent per task + two-stage review (spec then quality) = high quality, fast iteration

## When to Use

```dot
digraph when_to_use {
    "Have implementat...


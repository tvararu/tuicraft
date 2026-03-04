# Session Context

## User Prompts

### Prompt 1

Fix these 3 issues in the guild roster PR on branch feat/guild-roster:

1. RACE CONDITION: requestGuildRoster() is fire-and-forget but getGuildRoster() reads synchronously, so the first /groster always shows 'no roster available'. Make requestGuildRoster() return a Promise<GuildRoster> using dispatch.expect() like who() does.

2. RANK NAME FILTERING: world-handlers.ts line 674 filters empty rank names with .filter(n => n.length > 0), which breaks index alignment with member rankIndex. Don't f...

### Prompt 2

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


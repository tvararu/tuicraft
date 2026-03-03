# Session Context

## User Prompts

### Prompt 1

Coverage gaps to fix on branch feat/guild-roster:

- src/daemon/commands.ts: lines 132, 469, 478, 667-679
- src/wow/client.ts: lines 454, 457, 735-758
- src/wow/world-handlers.ts: lines 653-655, 659-663

Add tests to cover these lines. Must reach 100% line coverage on all files. Run mise test:coverage to verify. Push when done.

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


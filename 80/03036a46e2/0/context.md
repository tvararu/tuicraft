# Session Context

## User Prompts

### Prompt 1

On branch feat/guild-management, coverage gaps:
- src/daemon/commands.ts: 99.87% lines
- src/ui/tui.ts: 90.04% lines (163-185)

Add tests to cover all uncovered lines. Must reach 100% line coverage on every file. Run mise test:coverage to verify. Push when done.

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


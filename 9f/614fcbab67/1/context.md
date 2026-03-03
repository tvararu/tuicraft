# Session Context

## User Prompts

### Prompt 1

On branch feat/guild-roster, coverage is not 100%. Run mise test:coverage, identify all uncovered lines, add tests to cover them. Must reach 100% line and function coverage on every file. Push when done.

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


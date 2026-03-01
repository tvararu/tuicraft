# Session Context

## User Prompts

### Prompt 1

The ping test in src/wow/client.test.ts (line ~580, 'ping interval fires and server handles CMSG_PING') uses a hacky polling loop with Date.now() deadline to wait for a CMSG_PING packet. Make this more idiomatic — look at how other tests in this file wait for async events and follow the same pattern. The mock server has a 'captured' array of packets. Fix just this test, run mise ci to verify, and push.

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


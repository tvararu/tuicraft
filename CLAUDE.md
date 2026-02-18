# AGENTS.md

## Commands

Use `mise` to run tasks (not `bun` directly, not `mise run`):

- `mise start` — run the client (`bun src/index.ts`)
- `mise test` — run all tests (`bun test`)
- `mise typecheck` — type-check (`tsc --noEmit`)
- `mise format` — check formatting (`prettier --check`)
- `mise format:fix` — fix formatting (`prettier --write`)
- `mise bundle` — install dependencies (`bun install`)
- `mise ci` — run typecheck, test, and format in parallel
- `mise test:live` — run live server tests (`bun test ./src/test/live.ts`)

## Code Style

- Follow `/typescript-style` skill for structure and taste decisions
- Strict TypeScript — `noUncheckedIndexedAccess`, `noUnusedLocals`,
  `noUnusedParameters`, all strict flags on (see tsconfig.json)
- Never write comments
- Use Bun APIs over Node.js equivalents (`Bun.file` over `node:fs`, `WebSocket`
  built-in, etc.)
- Bun automatically loads `.env`, so don't use dotenv

## Testing

- Tests are colocated: `foo.ts` → `foo.test.ts` in the same directory
- Import from `bun:test`: `import { test, expect, describe } from "bun:test"`
- Run with `mise test`

## Commits

Use Tim Pope style:

- Subject line: imperative, ~50 chars, capitalized, no trailing punctuation
- Blank line, then 1-3 sentence description of "why" (wrap at 72 chars)
- No bullet points, NEVER add "Co-Authored-By" or other footers
- Check `git log -n 5` first to match existing style
- Never use `--oneline` — commit bodies carry important context

PRs:

- Write a short essay (1-2 paragraphs) describing why the changes are needed
- NEVER add a Claude Code attribution footer

## Reference Codebases

- `../wow-chat-client` — Node.js WoW chat client, primary protocol reference
- `../azerothcore-wotlk-playerbots` — AzerothCore server source (C++)

## Protocol Gotchas

- Server sends message lengths including the null terminator — strip trailing \0
  when decoding
- `drainWorldPackets` must catch handler errors — one bad packet breaks all
  subsequent processing
- Always test protocol parsers against the live server (`mise test:live`), not
  just hand-built fixtures
- Live-first testing: validate behavior against the real server, then encode it
  in mock integration tests as a living spec

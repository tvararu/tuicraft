# tuicraft

A TUI client for World of Warcraft 3.3.5a, implementing the auth and world
server protocols from scratch in TypeScript.

Reference implementation: `../wow-chat-client` (Node.js/JS version of the same
protocol). (Upstream: https://github.com/swiftmatt/wow-chat-client)

## Commands

Use `mise` to run tasks (not `bun` directly):

- `mise start` — run the client (`bun src/index.ts`)
- `mise test` — run all tests (`bun test`)
- `mise typecheck` — type-check (`tsc --noEmit`)
- `mise bundle` — install dependencies (`bun install`)

## Code Style

- Strict TypeScript — `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, all strict flags on (see tsconfig.json)
- Never write comments
- Use Bun APIs over Node.js equivalents (`Bun.file` over `node:fs`, `WebSocket` built-in, etc.)
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

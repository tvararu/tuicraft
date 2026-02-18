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
- `mise build` — compile single binary (`bun build --compile`)

## Code Style

- Follow `/typescript-style` skill for structure and taste decisions
- Strict TypeScript — `noUncheckedIndexedAccess`, `noUnusedLocals`,
  `noUnusedParameters`, all strict flags on (see tsconfig.json)
- Never write comments
- Use Bun APIs over Node.js equivalents (`Bun.file` over `node:fs`, `WebSocket`
  built-in, etc.)
- `node:os` (tmpdir/homedir), `node:fs/promises` (mkdir/appendFile) are fine — no
  Bun equivalents exist
- `Bun.file().exists()` only works on regular files — use `fs.access()` for
  unix sockets and other special files
- Bun automatically loads `.env`, so don't use dotenv

## Testing

- Tests are colocated: `foo.ts` → `foo.test.ts` in the same directory
- Import from `bun:test`: `import { test, expect, describe } from "bun:test"`
- Run with `mise test`
- Use `jest.useFakeTimers()` / `advanceTimersByTime()` from `bun:test` for
  timer-dependent tests (wrap in `try/finally` with `jest.useRealTimers()`)
- Prefer promise-based waiting over `Bun.sleep()` — await the event, not a
  hardcoded delay
- Use `./tmp/` for scratch files, not `/tmp/` (gitignored)
- macOS `tmpdir()` returns `/var/folders/.../T/`, not `/tmp/` — don't hardcode
  `/tmp/` paths
- Live tests read `WOW_LANGUAGE` env var (default: 1/Orcish for Horde accounts)

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
- Always run `mise test:live` after protocol changes — never claim something
  works without verifying against the real server
- Live-first testing: validate behavior against the real server, then encode it
  in mock integration tests as a living spec
- Chat messages must use a valid racial language (LANG_ORCISH=1 for Horde,
  LANG_COMMON=7 for Alliance) — server rejects LANG_UNIVERSAL (0) silently

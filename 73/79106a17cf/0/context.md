# Session Context

## User Prompts

### Prompt 1

Coverage gaps in new mail code need fixing. Run: bun test --coverage 2>&1 | grep -A1 -E "(format\.ts|commands\.ts|tui\.ts|client\.ts|world-handlers\.ts|mail\.ts|mock-handle)" to see uncovered lines. Then add tests to reach 100% coverage on ALL files. Focus on: src/ui/format.ts 512-594, src/daemon/commands.ts 623-712, src/wow/world-handlers.ts 303-342, src/wow/client.ts uncovered lines, src/wow/protocol/mail.ts uncovered line. Commit when done.


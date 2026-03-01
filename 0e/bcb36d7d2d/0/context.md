# Session Context

## User Prompts

### Prompt 1

src/wow/protocol/chat.ts shows 80% function coverage but 100% line coverage in mise test:coverage. All 11 exported functions have unit tests in chat.test.ts. Investigate why Bun reports 2 functions uncovered. Check if it's a Bun coverage quirk (default parameters, inline functions, etc.) or a real gap. If it's fixable, fix it and push. If it's a Bun bug, explain what's happening.


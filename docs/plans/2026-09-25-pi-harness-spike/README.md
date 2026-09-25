# Pi harness spike (throwaway reference)

Prototype code from the spike described in
[../2026-09-25-pi-harness-design.md](../2026-09-25-pi-harness-design.md).
It is kept as a working reference for the harness skeleton milestone, not
as product code. It does not follow the repo's code style, is excluded from
`mise typecheck`, and has no tests. Build the real harness under `src/`
rather than extending this.

| File | Purpose |
|---|---|
| `harness.ts` | Bun entrypoint: embeds stock Pi via the SDK (`createAgentSessionRuntime`, `InteractiveMode`) with coding features off |
| `wow-extension.ts` | Inline extension: `/connect`, chat commands, `wow_*` tools, event push, message renderers, map widget |
| `map.ts` | Entity-only top-down ASCII map and legend |
| `sync-auth.ts` | Spike credential hack: copies short-lived OAuth access tokens from omp's `~/.omp/agent/agent.db` into an isolated Pi `auth.json`, never refresh tokens |
| `run.sh` | Launcher: installs the pinned Pi dependency, syncs auth, sets `PI_CODING_AGENT_DIR`, runs under `mise` for `WOW_*` credentials |

Run from anywhere:

```
docs/plans/2026-09-25-pi-harness-spike/run.sh
```

It logs in as test account 1 (`WOW_ACCOUNT_1`, `WOW_PASSWORD_1`,
`WOW_CHARACTER_1` from `mise.local.toml`) on `/connect`. Runtime state
(Pi agent dir, auth, empty workspace) goes to `tmp/pi-harness-spike/`.

Environment switches: `PI_MODEL=provider/id` (default
`openai-codex/gpt-6-sol`), `WOW_AUTOCONNECT=1`, `WOW_MAP_LAYOUT=side|stack`.

Commands: `/connect`, `/disconnect`, `/say`, `/yell`, `/w <name> <msg>`,
`/g`, `/p`, `/e`, `/zoom <yd-per-row>`, `/maplayout stack|side`,
`/wake on|off`.

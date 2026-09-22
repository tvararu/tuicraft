# Uniform CLI JSON output envelope

Date: 2026-09-22. Status: design approved in chat, pending written review.

## Purpose

An agent should parse every finite `--json` command as one JSON document. It
should use the same field names for state, requests, events, and errors. A
successful request must not look like a confirmed result in the game world.

Today `--json` returns a single object or array for some commands. `nearby`,
`read`, and `tail` return JSONL. An empty `nearby` or `read` returns no JSON.
`send --wait` returns an acknowledgment followed by event lines. The CLI also
replaces some chat replies with `{"status":"ok"}` without checking for `ERR`.

## Boundary and compatibility

Change CLI stdout for `--json`. Keep the daemon's line-based IPC, event buffer,
session log, game state, and default human-readable output unchanged. The
existing `--json` payload format changes without a legacy flag or alias.
Scripts that read the old format must migrate.

Support `--json` on all daemon-backed one-shot gameplay commands, including
mutations, `start`, `status`, and `stop`. Existing `--json` commands stay
supported. Chat flags such as `-w --json` use the `send` command name in the
envelope. `--json` on `setup`, `help`, `version`, `logs`, `skill`, the interactive
mode, or the internal daemon mode is unsupported. Reject an explicit
`--json` on those modes instead of silently printing plain text. Keep the
existing raw session-log and reference-document output for `logs` and `skill`.

Every finite `--json` invocation writes exactly one JSON object and a newline
to stdout. This includes empty results and errors. It writes no other stdout
text. `tail --json` is the only continuous mode. It writes one envelope per
event and no envelope for an empty poll. A continuous stream cannot be one
complete JSON document. A terminal error writes one error envelope and exits.

## Envelope contract

All envelopes have these five top-level fields:

```ts
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

type Envelope = {
  command: string | null;
  kind: "intent" | "result" | "events" | "error";
  data: JsonValue | null;
  events: JsonObject[];
  error: {
    stage: "arguments" | "startup" | "command" | "wait";
    message: string;
  } | null;
};
```

`command` is the public command name. Use `send` for its chat aliases. Use
`null` when argument parsing cannot identify a command. `data` contains the
unmodified JSON value of an inspection or query. It can be an object or an
array. `events` contains event objects, never encoded JSON strings. `error`
is `null` on success. The CLI sets exit status 1 when `error` is not `null`.

`kind: "intent"` means that the daemon acknowledged a request. It does not
mean that the server accepted it or that its effect occurred. For example,
`fight`, `goto`, `follow`, quest mutations, and loot mutations return intent.
Inspect subsequent state and server events for their outcomes. `kind:
"result"` means that the CLI returned data. It does not upgrade predicted
poses or unknown state to server observations. `kind: "events"` contains
zero or more events. `kind: "error"` means that the request did not receive
an intent acknowledgment or a result.

A failure during `send --wait` can occur after the daemon replied. Keep the
initial `kind` and `data`, and set `error.stage` to `"wait"`. For an
acknowledged send, the kind stays `"intent"`. Exit with status 1. Do not imply
that the earlier request was undone or that its world outcome is known. Other
errors use `kind: "error"`. Use `"arguments"` for local argument errors,
`"startup"` for daemon startup or initial connection errors, and `"command"`
for daemon `ERR`, unsupported slash commands, malformed daemon JSON, or a
command connection failure before a reply. Preserve the daemon's reason as
the error message.

Examples omit no fields:

```json
{"command":"fight","kind":"intent","data":null,"events":[],"error":null}
{"command":"spells","kind":"result","data":[],"events":[],"error":null}
{"command":"nearby","kind":"result","data":[],"events":[],"error":null}
{"command":"read","kind":"events","data":null,"events":[],"error":null}
{"command":"send","kind":"intent","data":null,"events":[{"type":"SAY","sender":"A","message":"hi"}],"error":null}
{"command":"tail","kind":"events","data":null,"events":[{"type":"SAY","sender":"A","message":"hi"}],"error":null}
{"command":"follow","kind":"error","data":null,"events":[],"error":{"stage":"command","message":"target_motion_unknown"}}
{"command":"send","kind":"intent","data":null,"events":[],"error":{"stage":"wait","message":"connection lost"}}
```

## CLI data flow

Keep IPC framing private to the CLI. Parse a single daemon JSON document for
inspections such as `control`, `who`, and `spells`. Parse each daemon event or
nearby-entity line once. Put event objects in `events`. Put the nearby array
and inspection results in `data`. Do not change their field names or infer
new game facts. `read --wait` returns one envelope even when its event array
is empty. `send --wait` waits for the event read, then returns one intent
envelope with all events. If the initial reply is `ERR`, report it and do
not start the wait.

A slash command sent through `send` can return human-readable daemon lines.
Wrap a successful non-`OK` slash reply as `kind: "result"` with
`data: {"lines":[...]}`. Do not guess a structured game result from those
lines. A successful `OK` reply is intent. Convert `ERR` and `UNIMPLEMENTED`
replies to error envelopes. Do not replace any error reply with success.

`status --json` returns `data: { "socket": "responsive" }` when the daemon
answers its probe. It returns `data: { "socket": "not_running" }` when it
cannot reach the daemon. Neither result verifies world-session health.
`start --json` returns `data: { "socket": "responsive", "started": true }`
after a new daemon answers, or `started: false` when one already answered.
When `stop --json` finds no daemon, return `kind: "result"` with
`data: { "socket": "not_running" }`. A successful stop is an intent
acknowledgment with `data: null`, not proof of a server-side logout.

Place argument parsing inside the CLI error boundary. A malformed `--json`
invocation must produce one error envelope rather than an uncaught exception.
Only interpret `--json` as an option where that mode supports it. Do not
mistake a setup value for the option. Preserve the current human-readable
error path when `--json` is absent.

## Implementation and evidence

Normalize replies at the CLI boundary in `src/main.ts` and the existing CLI
output helper. Add the flag to applicable actions in `src/cli/args.ts`. Do not
change `src/daemon/commands.ts` or the IPC wire format. Remove the fabricated
chat success path. Update `src/cli/help.ts`, `docs/manual.md`,
`.claude/skills/tuicraft/SKILL.md`, and `README.md` together.

Exercise a real CLI process against a local mock daemon socket. Cover a
single-document inspection, an empty and nonempty list, a mutation `ERR`,
`send --wait` with and without events, a failure after send acknowledgment,
and `tail` events. Check one parseable envelope per finite invocation, the
stream envelope per event, exit statuses, and unchanged human output. Run the
relevant tests, typecheck, format check, and CLI smoke scenario. If the work
changes daemon or protocol behavior, also run `mise test:live` on the server.

## Exclusions

Do not add server-outcome inference, automatic retries, a new daemon IPC
protocol, or a compatibility shim for old `--json` payloads. Do not wrap raw
`logs` output or the `skill` document.

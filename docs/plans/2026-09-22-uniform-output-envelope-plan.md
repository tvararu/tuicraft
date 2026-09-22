# Uniform CLI JSON Envelope Implementation Plan

> **For agentic workers:** Read the approved design at `docs/plans/2026-09-22-uniform-output-envelope-design.md`. Use isolated Orca worktrees for independent changes. The user approved immediate implementation and shipment.

**Goal:** Give every finite `--json` CLI command one stable JSON envelope and make `tail --json` emit that envelope per event.

**Architecture:** Keep daemon IPC and human output intact. Parse daemon replies once in the CLI output module, then let `src/main.ts` emit envelopes at the process boundary. Parse `--json` for daemon-backed actions without changing positional command meanings.

**Tech Stack:** Bun, strict TypeScript, `bun:test`, `mise` tasks.

**Spec:** `docs/plans/2026-09-22-uniform-output-envelope-design.md`

## Global Constraints

- Every finite `--json` call prints exactly one JSON object and newline, including empty results and errors. `tail --json` prints one per event and none per empty poll.
- Envelopes have exactly `command`, `kind`, `data`, `events`, and `error`. `kind` is `intent`, `result`, `events`, or `error`.
- An intent only acknowledges the daemon request. Keep predicted and unknown game facts unchanged. A failure after a send reply retains its original kind and data, sets `error.stage: "wait"`, and exits 1.
- Error stages are `arguments`, `startup`, `command`, and `wait`. Errors go to stdout as one envelope for `--json`, with exit status 1.
- Keep default human output, daemon IPC, event buffer, session log, and protocol unchanged. Do not add a legacy JSON flag, retries, server-outcome inference, or daemon changes.
- Use `mise` for verification. Run `mise test:live` if daemon or protocol behavior changes. Update help, manual, agent skill, and README for this user-visible change. Do not write code comments.
- Independent workers own disjoint files, work in Orca worktrees based on this branch, commit coherent changes, and skip build, lint, format, and tests while siblings edit. The integration owner runs validation once after integration.

## File ownership and interfaces

- **Args worker:** `src/cli/args.ts`, `src/cli/args.test.ts`. Existing `parseArgs(args: string[]): CliAction` remains exported. Existing modes keep their no-JSON object shapes. New action JSON requests carry `json: true`.
- **Output worker:** `src/cli/send-output.ts`, `src/cli/send-output.test.ts`. Replace fabricated `formatSendOutput`; keep `daemonCommandFailed` for the human path. Export `OutputEnvelope`, `ReplyKind`, `decodeReply(command: string, kind: ReplyKind, lines: string[]): OutputEnvelope`, `resultEnvelope(command: string, data: JsonValue): OutputEnvelope`, and `errorEnvelope(command: string | null, stage: OutputStage, message: string, previous?: OutputEnvelope): OutputEnvelope`.
- **Integration owner:** `src/main.ts`, a colocated CLI process test or existing `src/daemon/commands.test.ts`. Consume the worker interfaces. No worker edits these files.
- **Docs worker:** `src/cli/help.ts`, `docs/manual.md`, `.claude/skills/tuicraft/SKILL.md`, `README.md`. Document the same five fields and framing rules. No other worker edits these files.

The output worker implements this shared type contract:

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
type OutputStage = "arguments" | "startup" | "command" | "wait";
type OutputEnvelope = {
  command: string | null;
  kind: "intent" | "result" | "events" | "error";
  data: JsonValue | null;
  events: JsonObject[];
  error: { stage: OutputStage; message: string } | null;
};
type ReplyKind = "intent" | "json" | "nearby" | "events" | "slash";
```

`decodeReply` treats `ERR` and `UNIMPLEMENTED` as command errors before decoding. It accepts `OK` or `OK ...` as intent. `json` parses exactly one document into `data`. `nearby` parses each line into `data` as an array. `events` parses lines into `events`. `slash` returns intent for `OK`; otherwise it returns `kind: "result"` with `data: { lines }`. Empty or malformed replies fail unless empty is valid for `nearby` or `events`. `errorEnvelope` retains a previous reply's `kind`, `data`, and `events` when the wait fails.

## Review Focus

1. `send --json` receives `ERR` rather than `OK`: output is an error, not fabricated success.
2. `send --wait --json` fails after an `OK`: the envelope retains `kind: "intent"` and reports a wait error without a second JSON document.
3. Empty `read` and `nearby`: each prints one valid envelope with an empty array in the correct field.
4. `setup --password --json`: treat `--json` as the password value, not a JSON mode option.
5. `tail --json` receives no events, then one event: print nothing during empty polls and exactly one JSON envelope for the event.

## Task 1: CLI JSON flag parsing

**Files:** `src/cli/args.ts`, `src/cli/args.test.ts`.

**Interfaces:** Preserve `parseArgs` and each existing command's arguments. Produce `json: true` for any daemon-backed command when explicitly requested. Reject unsupported explicit `--json` except a setup flag value.

- [ ] Write tests first for `fight --json`, `goto --json`, `follow --json`, `take-loot --json`, `status --json`, `-w ... --json`, unsupported `help --json`, and `setup --password --json`. Assert that action arguments and non-JSON results remain unchanged. One example:

```ts
expect(parseArgs(["fight", "0xa", "--json"])).toMatchObject({ mode: "fight", guid: 10n, json: true });
expect(parseArgs(["setup", "--password", "--json"])).toEqual({ mode: "setup", args: ["--password", "--json"] });
expect(() => parseArgs(["help", "--json"])).toThrow();
```

- [ ] Implement the option split without inserting `--json` into positional arguments or messages. Preserve boolean `json` on existing read, tail, send, who, nearby, and state modes. Return `json: true` on action and lifecycle modes only when requested. Do not interpret setup values as options. Reject explicit JSON on unsupported modes.
- [ ] Commit only these two files with a `feat:` subject. Do not run validation while workers run concurrently.

## Task 2: CLI envelope decoder

**Files:** `src/cli/send-output.ts`, `src/cli/send-output.test.ts`.

**Interfaces:** Export the functions and types in File ownership above. The integration owner consumes them in `src/main.ts`.

- [ ] Replace tests that pin fabricated success and raw slash JSON. Write contract tests first for `OK`, daemon `ERR`, `UNIMPLEMENTED`, a single object, an array, multiple nearby/event objects, an empty list, malformed JSON, a slash text result, and a wait error after intent. For example:

```ts
expect(decodeReply("send", "intent", ["ERR rooted"])).toEqual({
  command: "send", kind: "error", data: null, events: [],
  error: { stage: "command", message: "rooted" },
});
expect(decodeReply("read", "events", [])).toEqual({
  command: "read", kind: "events", data: null, events: [], error: null,
});
```

- [ ] Implement `decodeReply`, `resultEnvelope`, and `errorEnvelope` with strict line classification. Parse JSON values only at this boundary. Reject non-object event lines and extra documents for the `json` kind. Retain `daemonCommandFailed` for the human path, then remove `formatSendOutput` and its obsolete test.
- [ ] Commit only these two files with a `feat:` subject. Do not run validation while workers run concurrently.

## Task 3: CLI process integration

**Files:** `src/main.ts`, `src/daemon/commands.test.ts` or a colocated CLI process test if simpler.

**Interfaces:** Consume `parseArgs`, `decodeReply`, `resultEnvelope`, and `errorEnvelope` as defined above. Treat all chat aliases as command `send`.

- [ ] Write a real CLI-process test against the existing local daemon test socket. First prove old behavior fails: `read --json` with no events prints zero lines, and `send --json` with a daemon error fabricates `{"status":"ok"}`. Add focused cases for `send --wait` with events, JSON mutation intent, invalid args, status, and tail. Use a bounded event-driven tail subprocess and close it after receiving one event. Assert parsed stdout and exit status, not source text.
- [ ] Move `parseArgs` inside the top-level error boundary so malformed JSON-mode arguments print one error envelope. Keep the old stderr path for human mode. Write a single JSON envelope to stdout for finite calls. For `tail --json`, emit an envelope only for a nonempty event poll. Set exit status 1 when an envelope has an error.
- [ ] Route daemon-backed inspection replies through `decodeReply(..., "json", ...)`, `nearby` through `"nearby"`, `read` through `"events"`, mutations through `"intent"`, and slash chat through `"slash"`. Keep ordinary human text and its existing failure behavior. `send --wait` must decode the first reply, avoid waiting on error, then add waited events to the same envelope. On wait failure, use `errorEnvelope(..., "wait", message, previous)`.
- [ ] Return exact lifecycle data from the spec: status `{socket:"responsive"|"not_running"}`, start `{socket:"responsive",started:boolean}`, absent stop `{socket:"not_running"}`. Successful stop is intent. Do not confuse socket response with world-session health.
- [ ] Run the focused tests and a real process smoke command. Fix integration errors. Commit the CLI process change and its tests together with a `feat:` subject.

## Task 4: Documentation, review, and shipment

**Files:** `src/cli/help.ts`, `docs/manual.md`, `.claude/skills/tuicraft/SKILL.md`, `README.md`.

- [ ] Replace the three-shape parsing guidance with finite-single-document and continuous-tail framing. Give one finite envelope example, one tail event example, the empty-list rule, and the intent-versus-world-outcome rule. List `--json` support on mutations and lifecycle commands; state that `logs` and `skill` remain raw.
- [ ] Commit docs/help with the right conventional prefixes. Do not run checks while sibling workers edit.
- [ ] Integration owner cherry-picks independent worker commits, resolves conflicts without merge commits, and reviews the resulting tree. Run focused tests, `mise ci`, and a real CLI-process scenario. If daemon or protocol code changed, run `mise test:live` personally. Review for lost human output, swallowed daemon errors, and JSON double-encoding.
- [ ] Commit fixes in coherent units, then integrate and push to `main` under the repo's linear-history rules. Do not force-push, bypass hooks, delete branches, or publish releases.

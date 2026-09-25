# Uniform CLI JSON envelope implementation plan

Date: 2026-09-22. Condensed 2026-09-24. The full worker plan, with its test
examples, is at `9c47b07`.

**Goal:** give every finite `--json` CLI command one stable JSON envelope and
make `tail --json` emit that envelope per event.

**Spec:** [2026-09-22-uniform-output-envelope-design.md](2026-09-22-uniform-output-envelope-design.md).

**Status:** implemented. The four doc places describe the shipped contract.

## Constraints

- Every finite `--json` call prints exactly one JSON object and a newline,
  including empty results and errors. `tail --json` prints one per event and
  none per empty poll.
- Envelopes have exactly `command`, `kind`, `data`, `events` and `error`.
- An intent only acknowledges the daemon request. A failure after a send reply
  keeps its kind and data, sets `error.stage: "wait"` and exits 1.
- Default human output, daemon IPC, event buffer, session log and protocol
  stay unchanged. No legacy JSON flag, retries or server-outcome inference.

## Tasks as landed

1. **Flag parsing** (`9affc74 feat: Parse JSON for daemon-backed CLI actions`).
   `--json` on every daemon-backed command; explicit `--json` rejected on
   unsupported modes; a setup value such as `--password --json` is not the
   option.
2. **Envelope decoder** (`7f1f8d4 feat: Normalize CLI reply envelopes`).
   `src/cli/send-output.ts` exports `decodeReply`, `resultEnvelope` and
   `errorEnvelope`. `ERR` and `UNIMPLEMENTED` are command errors; the
   fabricated `{"status":"ok"}` chat success is gone.
3. **Process integration** (`d7b6341 feat: Emit uniform CLI JSON envelopes`).
   `src/main.ts` emits envelopes at the process boundary, parses arguments
   inside the error boundary, and returns the lifecycle data for `status`,
   `start` and `stop`.
4. **Docs** (`412e2f5 docs: Explain uniform CLI JSON output`).

## Review focus, kept as regression targets

1. `send --json` receiving `ERR` prints an error, not success.
2. `send --wait --json` failing after `OK` keeps `kind: "intent"` and prints
   one document.
3. Empty `read` and `nearby` each print one envelope with an empty array.
4. `setup --password --json` treats `--json` as the password.
5. `tail --json` prints nothing for empty polls and one envelope per event.

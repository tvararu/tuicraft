# Pattern Charter

The target shape for code merged since the roadmap (`009434b..9c47b07`).
The baseline is the pre-roadmap tree at `db6bbcf` plus
`.claude/skills/typescript-style/SKILL.md`. Read both. Where they disagree,
the skill wins. Where neither covers a case, copy the nearest pre-roadmap
file. Read old files with `git show db6bbcf:<path>`.

## Layers

The pre-roadmap tree has four layers. Each layer imports only from layers below it.

1. `wow/protocol/*` holds pure codecs, and each file covers one opcode family.
   A builder is named `buildX(...): Uint8Array` and uses `PacketWriter`, then
   `w.finish()`. A parser is named `parseX(r: PacketReader): X` and returns a
   plain typed object. A codec file does not keep state, does no I/O and
   imports nothing from the runtime. Opcode and flag tables are `as const`
   objects in `protocol/opcodes.ts` or `protocol/entity-fields.ts`.
   Reference files: `protocol/group.ts`, `protocol/guild.ts`,
   `protocol/social.ts`.
2. `wow/*-store.ts` and small runtime modules hold state. A store is a small
   class that holds a `Map`. It has one `onEvent(cb)` listener and emits a
   discriminated-union event (`FriendEvent`, `EntityEvent`). Reference files:
   `friend-store.ts`, `entity-store.ts`.
3. `wow/world-handlers.ts` and `wow/client.ts` are the session layer.
   Handlers are `handleX(conn, r)` functions. `client.ts` owns `WorldConn`,
   the packet drain and the `WorldHandle` facade. `WorldHandle` is a flat
   type of verb-named methods. A command method returns `void`. A query
   method returns `Promise<T>`.
4. `daemon/*`, `cli/*`, `ui/*` and `main.ts` are the surface.
   `dispatchCommand` is a `switch (cmd.type)`. Each case calls one
   `WorldHandle` method, writes its lines and returns. Formatting happens in
   `ui/format.ts` or in the `format*` helpers beside it, and each has a text
   variant and an `Obj`/JSON variant. Parsing happens in `ui/commands.ts`
   and `cli/args.ts`.

New gameplay domains (combat, navigation, loot, quests, recovery, control,
Jev, the encounter cycle) must fit these layers:

- Codecs go in `protocol/`.
- State goes in a store or a small, focused class.
- Session wiring goes in `client.ts` and `world-handlers.ts`.
- User-visible behaviour goes in the surface layer.

A domain module must not own a socket, parse packets inline, or format output.

## Size

- Files are about 50–200 lines. A file over about 400 lines has two or more
  responsibilities, so split it along those responsibilities, as
  `docs/plans/2026-03-01-file-split-design.md` did.
- Functions are 3–10 lines. The hard maximum is 30 lines.
- Classes are small and have one responsibility. A class with hundreds of
  lines, such as `ControlRuntime` in `control.ts` at about 940 lines, is a
  split target. Pull the pure maths and the decisions out into functions,
  and keep only the state machine in the class.

## Types

- Use `type` only. Do not use `interface` or `enum`. Use unions for sets of
  values and discriminated unions for events and outcomes.
- Never use `any`. Use `unknown` only at a real boundary. Remove
  `as unknown as`.
- If three or more functions take the same arguments, pass one context
  object. Keep signatures to one line.
- Use absolute imports through `baseUrl`, with no `.ts` extension and no
  barrel files.

## Control flow

- Write optimistic code. Validate only at the system boundaries: network
  packets, IPC input, CLI args, Jev responses and native navmesh FFI. Remove
  any `try`/`catch` around internal code whose preconditions we control.
  `drainWorldPackets` keeps its per-handler catch.
- Do not nest ternaries. Use a `let` with `if`/`else` for three-way branches.
- Do the work synchronously when that is possible. Every `setTimeout`, poll
  loop or timer needs a reason that comes from the protocol or from timing in
  the game world.
- Await events. Do not sleep for a fixed delay.
- Getters are pure.

## Duplication

A helper that appears twice must live in one place. Put it in the lowest
layer that needs it. Candidates to check (not verified) are the guid packing and unpacking
helpers (`packedToBigint` and its equivalents), pose and position maths,
distance and facing maths, and the timeout and abort wrappers.

## Tests

- Colocate them: `foo.ts` has `foo.test.ts` beside it. Import from
  `bun:test`. Use `describe` per exported function and `test` per behaviour.
- A codec test round-trips through `PacketWriter` and `PacketReader` and
  asserts `r.remaining === 0`. Reference file: `protocol/group.test.ts`.
- Test the behaviour and the protocol boundaries. Delete tests that only pin
  implementation details, tests that duplicate other tests, and tests written
  to lift coverage. Do not add tests to reach a percentage.
- Use the two shared mocks, `src/test/mock-handle.ts` and the inline mock in
  `src/daemon/start.test.ts`. Keep them both current.
- Use fake timers for timer logic. Do not use `Bun.sleep` in tests where you
  can await an event.

## Comments and naming

- Do not write comments. Remove any that exist.
- Use short, terse names on the surface. Make field names match where the
  value goes, so call sites can use shorthand.

## Latitude

Agents may change interfaces, CLI output and JSON shapes, and may delete
features or code that do not earn their place. Two conditions apply:

- The gameplay loop that each accepted milestone proves (M1 control, M2
  navigation and encounters, M3 tactical movement, M4 encounter cycle) must
  still work against the live server.
- A user-visible change updates all four doc places: `src/cli/help.ts`,
  `docs/manual.md`, `.claude/skills/tuicraft/SKILL.md` and `README.md`.

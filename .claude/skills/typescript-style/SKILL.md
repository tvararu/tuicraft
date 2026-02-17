---
name: typescript-style
description: Use when writing or modifying any TypeScript code. Defines the preferred code style — functional, inference-heavy, optimistic, compact.
---

# TypeScript Style

Prettier with defaults handles formatting.
This covers structure and taste.

## Types

- `type` only. No `interface`, no `enum`.
- `as const` objects for opcode tables and constant maps.
- Unions for enumerations: `type Status = "active" | "pending"`
- Never `any`. Reserve `unknown` for true boundaries. If you know the type, use
  it.
- Discriminated unions over loose fields. `UserEntry | AgentEntry` not `{ data:
unknown }`.
- Compose types with `&` for extending, but prefer nested fields over flat
  intersections when callers pass a shared object. Spread objects bypass
  TypeScript's excess property checks — nesting preserves them.
- When 3+ functions share the same args, extract a context type and pass it as a
  nested field rather than repeating individual args at every call site.
- Extract types to keep function signatures to one line.
- Annotate params and return types. Skip the annotation when the type is inferred
  from a default value (`now = new Date()` not `now: Date = new Date()`).
- Absolute imports via baseUrl. No `.ts` extensions.

## Functions

- `function` for named/exported. Arrows for callbacks only.
- 3-10 lines ideal. 30 lines hard max.
- Never break an argument list across multiple lines. If Prettier would wrap the
  args, extract a type and take a single arg object instead.
- Destructure in the signature when it fits one line. Move to the body when it
  gets wide.
- Guards grouped at the top. Symmetry in sequential ifs.
- Build symmetrical helper pairs so call sites read like prose.
- Group related variables together at the top of the body.
- Functions should call their own dependencies — don't make callers pass in what
  the function can get itself.
- Pull nested config objects into named variables above the call that uses them.
- Prefer template literals over `[...].join("\n")` for multi-line strings.

```ts
export function handle({ type, channel, user }: Event): string {
  if (!user) return "";
  if (type === "bot") return "";

  const sender = resolve(user);
  const formatted = formatFor(channel);

  return `${sender}: ${formatted}`;
}
```

## Classes

- Classes are fine for stateful protocol objects (ciphers, buffers, readers).
- Keep classes small and focused — one responsibility.
- No inheritance. Compose instead.
- Export the class directly, not through a factory function.

## Control Flow

- Ternaries and `??` for simple binary choices. Never nest ternaries.
- `let` + if/else for three-way branches.
- Optimistic code. Let it throw. Don't catch errors around internal code whose
  preconditions you control.
- Only validate at system boundaries: user input, external APIs, network
  responses.

## Data and Organization

- Functional where possible. Plain objects and functions.
- `as const` for constant objects.
- Group related functions in one file (~50-200 lines).
- Co-locate related things. No scattering across dirs.
- No barrel files. Import from the source module.
- Almost never write comments.

## Naming

- Short, terse names for APIs and tools users will see.
- Suffix by kind when it clarifies: `sessionKey`, `realmHost`.
- If Prettier breaks a signature, the name is too long.
- Match field names to their destination so call sites use shorthand.
- Don't add config files when defaults work.

## Simplicity

- Getters should be pure. No side effects in functions that return values.
- Don't debounce, batch, or schedule what you can do synchronously in one call.
- Setup/wiring functions should be lean. Extract handlers, keep registration
  code to a list of one-liners.
- Aim for one-liner call sites. If an API call needs renaming args, the variable
  names are wrong.

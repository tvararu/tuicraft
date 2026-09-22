# M4 Encounter Cycles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the M4 `cycle` loop command: GUID queue, per-target skip, auto-loot, death recovery, external-halt-wins.

**Architecture:** New `EncounterCycleRuntime` in `src/wow/` follows the `FollowRuntime` pattern: narrow structural deps, generation-counter cancellation, snapshot plus event listener. It drives the shipped `TacticsLoop`, `RewardsRuntime`, `RecoveryRuntime`, and `ControlRuntime` directly, never through `WorldHandle` methods that call `override()`. Wiring in `src/wow/client.ts` mirrors `follow`.

**Tech Stack:** Bun, strict TypeScript, `bun:test` colocated tests, existing daemon CLI/IPC path.

**Spec:** `docs/plans/2026-09-22-m4-encounter-cycles-design.md` — the plan argues from the spec, so the spec travels with it; executors read both. Roadmap `docs/roadmap.md:588-638` is canonical on conflicts.

## Global Constraints

- Strict TypeScript: `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, all strict flags on.
- Never write comments.
- Tests colocated: `foo.ts` → `foo.test.ts`, `import { test, expect, describe } from "bun:test"`.
- Verify with `mise test <file>`, `mise typecheck`, `mise format`. Full `mise ci` before final commit.
- `WorldHandle` has two mocks: `src/test/mock-handle.ts` (shared) and the inline mock in `src/daemon/start.test.ts`. Update both when adding methods.
- User-visible feature: update all four docs — `src/cli/help.ts`, `docs/manual.md`, `.claude/skills/tuicraft/SKILL.md`, `README.md` — plus the roadmap repair in Task 6.
- Timer tests use `jest.useFakeTimers()` / `advanceTimersByTime()` from `bun:test`, wrapped in `try/finally` with `jest.useRealTimers()`.
- No new protocol, no new Jev judgment input, no movement candidate or lease changes.

## File Structure

- Create `src/wow/encounter-cycle.ts`: `EncounterCycleRuntime`, `CycleState`, `CycleEvent`, `CycleDeps`, timeout and travel constants. One responsibility: sequence sequencing.
- Create `src/wow/encounter-cycle.test.ts`: fake-dep unit tests for queue, skip, loot, recovery, halt ownership.
- Modify `src/wow/client.ts`: construct the runtime beside `follow`, expose `startCycle` / `stopCycle` / `getCycleState` / `onCycleEvent` on the handle with loop-owned-call exemption from self-stop.
- Modify `src/test/mock-handle.ts` and `src/daemon/start.test.ts`: stub the four new handle methods.
- Modify `src/cli/args.ts` (+ `args.test.ts`), `src/daemon/commands.ts` (+ `commands.test.ts`), `src/cli/help.ts` (+ `help.test.ts`): `cycle` start command and `cycling` inspect command.
- Modify `docs/manual.md`, `.claude/skills/tuicraft/SKILL.md`, `README.md`, `docs/roadmap.md:600-607`: docs plus stale-paragraph rewrite.

---

### Task 1: Cycle runtime skeleton with queue and skip semantics

**Files:**
- Create: `src/wow/encounter-cycle.ts`
- Test: `src/wow/encounter-cycle.test.ts`

**Interfaces:**
- Consumes: nothing; standalone.
- Produces: `EncounterCycleRuntime`, `CycleState`, `CycleEvent`, `CycleDeps` for Tasks 2-4.

```typescript
import type { TacticsOutcome } from "wow/tactics";

export type CyclePhase = "idle" | "fighting" | "looting" | "recovering" | "stopped";
export type CycleTargetRecord = {
  guid: bigint;
  status: "queued" | "done" | "skipped";
  cause?: string;
  outcome?: TacticsOutcome;
};
export type CycleState = {
  active: boolean;
  phase: CyclePhase;
  queue: CycleTargetRecord[];
  currentIndex: number;
  instruction: string;
  maxStarts: number;
  startsUsed: number;
  stopCause: string | undefined;
  startedAt: number | undefined;
};
export type CycleEvent = {
  type: "started" | "target_done" | "stopped";
  state: CycleState;
  at: number;
};
export type CycleTactics = {
  start(context: { targetGuid: bigint; instruction: string }, signal: AbortSignal): Promise<void>;
  stop(reason: string): void;
  lastOutcome(): TacticsOutcome | undefined;
  selfDead(): boolean;
};
export type CycleDeps = {
  tactics: CycleTactics;
  now: () => number;
};
```

- [ ] **Step 1: Write the failing test for queue walk with per-target skip**

```typescript
import { test, expect } from "bun:test";
import { EncounterCycleRuntime } from "wow/encounter-cycle";

function fakeTactics(outcomes: (string | Error)[]) {
  let calls = 0;
  return {
    calls: () => calls,
    start: async (_ctx: { targetGuid: bigint; instruction: string }, _s: AbortSignal) => {
      const next = outcomes[calls++];
      if (next instanceof Error) throw next;
    },
    stop: (_r: string) => {},
    lastOutcome: () => undefined,
    selfDead: () => false,
  };
}

test("lost target records cause and advances, loop stops at end of queue", async () => {
  const tactics = fakeTactics([new Error("target_unreachable")]);
  const runtime = new EncounterCycleRuntime({ tactics, now: () => 0 });
  const events: string[] = [];
  runtime.onEvent((e) => events.push(e.type));
  await runtime.start({ guids: [1n, 2n], instruction: "fight", maxStarts: 5 });
  const state = runtime.snapshot();
  expect(state.queue[0]).toMatchObject({ status: "skipped", cause: "target_unreachable" });
  expect(tactics.calls()).toBe(2);
  expect(state.phase).toBe("stopped");
  expect(events).toEqual(["started", "target_done", "target_done", "stopped"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise test src/wow/encounter-cycle.test.ts`
Expected: FAIL with "Cannot find module 'wow/encounter-cycle'"

- [ ] **Step 3: Write minimal runtime with start, generation guard, and skip loop**

```typescript
import type { TacticsOutcome } from "wow/tactics";

export type CyclePhase = "idle" | "fighting" | "looting" | "recovering" | "stopped";
export type CycleTargetRecord = {
  guid: bigint;
  status: "queued" | "done" | "skipped";
  cause?: string;
  outcome?: TacticsOutcome;
};
export type CycleState = {
  active: boolean;
  phase: CyclePhase;
  queue: CycleTargetRecord[];
  currentIndex: number;
  instruction: string;
  maxStarts: number;
  startsUsed: number;
  stopCause: string | undefined;
  startedAt: number | undefined;
};
export type CycleEvent = {
  type: "started" | "target_done" | "stopped";
  state: CycleState;
  at: number;
};
export type CycleTactics = {
  start(context: { targetGuid: bigint; instruction: string }, signal: AbortSignal): Promise<void>;
  stop(reason: string): void;
  lastOutcome(): TacticsOutcome | undefined;
  selfDead(): boolean;
};
export type CycleDeps = {
  tactics: CycleTactics;
  now: () => number;
};

const DEFAULT_MAX_STARTS = 10;

export class EncounterCycleRuntime {
  private readonly deps: CycleDeps;
  private listener: ((event: CycleEvent) => void) | undefined;
  private generation = 0;
  private disposed = false;
  private state: CycleState = {
    active: false,
    phase: "idle",
    queue: [],
    currentIndex: 0,
    instruction: "",
    maxStarts: DEFAULT_MAX_STARTS,
    startsUsed: 0,
    stopCause: undefined,
    startedAt: undefined,
  };

  constructor(deps: CycleDeps) {
    this.deps = deps;
  }

  snapshot(): CycleState {
    return { ...this.state, queue: this.state.queue.map((record) => ({ ...record })) };
  }

  onEvent(callback: ((event: CycleEvent) => void) | undefined): void {
    this.listener = callback;
  }

  async start(args: { guids: bigint[]; instruction: string; maxStarts?: number }): Promise<void> {
    if (this.disposed) throw new Error("cycle_disposed");
    if (args.guids.length === 0) throw new Error("cycle_empty_queue");
    const maxStarts = args.maxStarts ?? DEFAULT_MAX_STARTS;
    if (!Number.isInteger(maxStarts) || maxStarts < 1) throw new Error("cycle_invalid_max");
    const generation = ++this.generation;
    this.state = {
      active: true,
      phase: "fighting",
      queue: args.guids.map((guid) => ({ guid, status: "queued" })),
      currentIndex: 0,
      instruction: args.instruction,
      maxStarts,
      startsUsed: 0,
      stopCause: undefined,
      startedAt: this.deps.now(),
    };
    this.emit("started");
    await this.drive(generation);
  }

  stop(reason: string): void {
    if (!this.state.active) return;
    this.generation++;
    this.state = { ...this.state, active: false, phase: "stopped", stopCause: reason };
    this.emit("stopped");
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.listener = undefined;
  }

  protected live(generation: number): boolean {
    return !this.disposed && generation === this.generation && this.state.active;
  }

  private async drive(generation: number): Promise<void> {
    while (this.live(generation) && this.state.currentIndex < this.state.queue.length) {
      if (this.state.startsUsed >= this.state.maxStarts) {
        this.stop("max_starts_reached");
        return;
      }
      const record = this.state.queue[this.state.currentIndex]!;
      const controller = new AbortController();
      this.state.startsUsed++;
      try {
        await this.deps.tactics.start(
          { targetGuid: record.guid, instruction: this.state.instruction },
          controller.signal,
        );
      } catch (error) {
        if (!this.live(generation)) return;
        record.status = "skipped";
        record.cause = error instanceof Error ? error.message : "fight_failed";
        record.outcome = this.deps.tactics.lastOutcome();
        this.advance();
        continue;
      }
      if (!this.live(generation)) return;
      if (this.deps.tactics.selfDead()) {
        await this.onDeath(generation);
        return;
      }
      record.status = "done";
      record.outcome = this.deps.tactics.lastOutcome();
      this.advance();
    }
    if (this.live(generation)) this.stop("queue_exhausted");
  }

  protected async onDeath(_generation: number): Promise<void> {
    throw new Error("cycle_no_recovery");
  }

  private advance(): void {
    this.state.currentIndex++;
    this.emit("target_done");
  }

  private emit(type: CycleEvent["type"]): void {
    this.listener?.({ type, state: this.snapshot(), at: this.deps.now() });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise test src/wow/encounter-cycle.test.ts`
Expected: PASS

- [ ] **Step 5: Add tests for max-starts cap, empty queue, invalid max, external stop, and replace**

```typescript
test("stops at max starts with cause", async () => {
  const tactics = fakeTactics([]);
  const runtime = new EncounterCycleRuntime({ tactics, now: () => 0 });
  await runtime.start({ guids: [1n, 2n, 3n], instruction: "fight", maxStarts: 2 });
  expect(runtime.snapshot()).toMatchObject({ stopCause: "max_starts_reached", startsUsed: 2 });
});

test("empty queue and bad max throw", async () => {
  const tactics = fakeTactics([]);
  const runtime = new EncounterCycleRuntime({ tactics, now: () => 0 });
  await expect(runtime.start({ guids: [], instruction: "fight" })).rejects.toThrow("cycle_empty_queue");
  await expect(runtime.start({ guids: [1n], instruction: "fight", maxStarts: 0 })).rejects.toThrow(
    "cycle_invalid_max",
  );
});

test("second start replaces the first", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const tactics = {
    calls: 0,
    start: async () => {
      tactics.calls++;
      await gate;
    },
    stop: (_r: string) => {},
    lastOutcome: () => undefined,
    selfDead: () => false,
  };
  const runtime = new EncounterCycleRuntime({ tactics, now: () => 0 });
  const first = runtime.start({ guids: [1n], instruction: "a" });
  await Bun.sleep(0);
  const second = runtime.start({ guids: [2n], instruction: "b" });
  release();
  await Promise.all([first, second]);
  expect(runtime.snapshot().queue.map((r) => r.guid)).toEqual([2n]);
});
```

- [ ] **Step 6: Run tests, typecheck, format**

Run: `mise test src/wow/encounter-cycle.test.ts && mise typecheck`
Expected: PASS, no type errors. Then `mise format:fix src/wow/encounter-cycle.ts src/wow/encounter-cycle.test.ts` if needed.

- [ ] **Step 7: Commit**

```bash
git add src/wow/encounter-cycle.ts src/wow/encounter-cycle.test.ts
git commit -m "feat: Add encounter cycle queue with skip" -m "GUID queue, per-target skip on fight failure, max-starts cap, replace on restart."
```

### Task 2: Loot step with empty-advance and denial-stop

**Files:**
- Modify: `src/wow/encounter-cycle.ts`
- Test: `src/wow/encounter-cycle.test.ts`

**Interfaces:**
- Consumes: `EncounterCycleRuntime` internals from Task 1 (add `CycleLoot` dep, `lastLoot` state, `loot_done` event).
- Produces: loot transition semantics for Task 5 wiring.

Read first: `src/wow/rewards.ts:32-106` (loot phases, request, errors, inventory), especially the exact method names on `RewardsRuntime` (`open`, `take`, `takeMoney`, close method name), the `RewardsEvent` types for opened versus error, and how `lastLootError` versus `lastInventoryError` with `inventoryFull` are reported.

```typescript
export type CycleLoot = {
  snapshot(): RewardsState;
  open(guid: bigint): void;
  take(slot: number): void;
  takeMoney(): void;
  close(): void;
  onEvent(callback: ((event: RewardsEvent) => void) | undefined): void;
};
export type CycleLootRecord = {
  guid: string;
  slotsTaken: number[];
  moneyTaken: number;
  coinageBefore: number | undefined;
  coinageAfter: number | undefined;
};
```

Timeout constant: `LOOT_SETTLE_MS = 5000`. After the last take, wait for quiescence (no loot event for the window) or timeout, then close and compute deltas from `snapshot().inventory.coinage` before versus after.

Transitions: offer error event or take throwing stops the loop with `loot_denied:<detail>`; inventory-full error stops with `loot_inventory_full`; empty offer (zero items, zero money) closes the window and advances; release-only denial stops with `loot_release_only_reconnect_required`.

- [ ] **Step 1: Write the failing test for take-all plus money with deltas**

```typescript
test("loot takes every slot plus money and records deltas", async () => {
  const loot = fakeLoot({ items: [4, 7], money: 9, coinageBefore: 10, coinageAfter: 19 });
  const runtime = new EncounterCycleRuntime({ tactics: fakeTactics([]), loot, now: () => 0 });
  await runtime.start({ guids: [2n], instruction: "fight" });
  expect(loot.taken()).toEqual([4, 7]);
  expect(loot.moneyTaken()).toBe(true);
  expect(runtime.snapshot().lastLoot).toMatchObject({
    slotsTaken: [4, 7],
    moneyTaken: 9,
    coinageBefore: 10,
    coinageAfter: 19,
  });
});
```

The `fakeLoot` harness queues scripted `RewardsState` snapshots and emits `RewardsEvent`s on `open`/`take`/`takeMoney`; define it in the test file mirroring the `rewards.test.ts` fixture style.

- [ ] **Step 2: Run test to verify it fails**

Run: `mise test src/wow/encounter-cycle.test.ts`
Expected: FAIL (no loot dep, no `lastLoot`)

- [ ] **Step 3: Implement the loot step**

Add `loot: CycleLoot` to `CycleDeps`, `lastLoot: CycleLootRecord | undefined` to `CycleState`, `"loot_done"` to `CycleEvent["type"]`. After a fight record is marked done, call the loot step for the same GUID before advancing: open, await opened-or-error event (bounded by `LOOT_SETTLE_MS`), take each offered slot, take money when nonzero, await settle, close, snapshot coinage delta, emit `loot_done`. Wire each error branch to `stop()` with the causes above.

- [ ] **Step 4: Add tests for empty-advance, denied-stop, refused-stop, full-stop, release-only-stop**

```typescript
test("empty offer closes and advances without stopping", async () => { ... });
test("denied offer stops with loot_denied cause", async () => { ... });
test("refused take stops with cause", async () => { ... });
test("full inventory stops with loot_inventory_full", async () => { ... });
test("release-only denial stops with reconnect cause", async () => { ... });
```

- [ ] **Step 5: Run tests, typecheck, format**

Run: `mise test src/wow/encounter-cycle.test.ts && mise typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/wow/encounter-cycle.ts src/wow/encounter-cycle.test.ts
git commit -m "feat: Add cycle auto-loot with denial stops" -m "Take-all plus money with coinage deltas. Empty advances; denied, refused, full, and release-only stop."
```

### Task 3: Recovery step with bounded waits and honest travel

**Files:**
- Modify: `src/wow/encounter-cycle.ts`
- Test: `src/wow/encounter-cycle.test.ts`

**Interfaces:**
- Consumes: `EncounterCycleRuntime` from Tasks 1-2 (override `onDeath`, add `CycleRecovery` and `CycleControl` deps).
- Produces: full runtime for Task 5 wiring.

Read first: `src/wow/recovery.ts` (snapshot fields `life`, `corpse`, `reclaim`, `reclaimDelay`, `resurrection` with `response`, epoch invalidation rules, exact method names `releaseSpirit`, `queryCorpse`, `reclaimCorpse`, `respondResurrection`, `RecoveryEvent` types) and `src/wow/control.ts` (snapshot `pose`, `move`, `face`, movement-stopped event shape and ground-refusal reasons).

```typescript
export type CycleRecovery = {
  snapshot(): RecoveryState;
  releaseSpirit(): void;
  queryCorpse(): void;
  reclaimCorpse(): void;
  respondResurrection(accept: boolean): void;
  onEvent(callback: ((event: RecoveryEvent) => void) | undefined): void;
};
export type CycleControl = {
  pose(): ControlPose | undefined;
  face(orientation: number): void;
  move(direction: MovementDirection, durationMs: number): void;
};
```

Constants: `RECLAIM_MARGIN_MS = 2000`, `LEG_LEASE_MS = 3000`, `DETOUR_RAD = Math.PI / 4`, `RECOVERY_WAIT_MS = 30000` for ghost/life observation bounds.

Behavior, in order: current-epoch unanswered resurrection offer goes accept, await observed life (bounded), resume next GUID. Else release when dead (skip when already ghost), await ghost. Query corpse, await observed (bounded); absent stops with `corpse_absent`. Reclaim delay waits remaining plus margin, retries once, still gated stops with `reclaim_delayed`. Cross-map or out-of-range stops with `corpse_out_of_range` carrying pose and range. Travel legs: face bearing, one move lease, re-read pose, arrival via `reclaim.canRequest`; ground refusal gets one fixed-angle retry, then stops with `corpse_unreachable` carrying pose and range. Reclaim, await observed life (bounded), resume next GUID. Stale-epoch offers ignored throughout.

- [ ] **Step 1: Write the failing test for accept-current-resurrection and resume**

```typescript
test("current resurrection offer is accepted and loop resumes", async () => {
  const recovery = fakeRecovery({ offerEpoch: "current", life: ["ghost", "alive"] });
  const runtime = new EncounterCycleRuntime({
    tactics: fakeTactics([], { deadOn: 0 }),
    loot: fakeLoot({ items: [], money: 0 }),
    recovery,
    control: fakeControl(),
    now: () => 0,
  });
  await runtime.start({ guids: [1n, 2n], instruction: "fight" });
  expect(recovery.answered()).toBe(true);
  expect(runtime.snapshot()).toMatchObject({ phase: "stopped", stopCause: "queue_exhausted" });
});
```

Fake harnesses script `RecoveryState` snapshots and emit `RecoveryEvent`s per call, mirroring `recovery.test.ts` fixture style.

- [ ] **Step 2: Run test to verify it fails**

Run: `mise test src/wow/encounter-cycle.test.ts`
Expected: FAIL (no recovery path)

- [ ] **Step 3: Implement the recovery step replacing `onDeath`**

Implement the ordered behavior above. Every wait subscribes to the runtime event listener once per wait with a `setTimeout` bound; late events after the bound are ignored. Death enters `recovering` phase and emits a `recovery` event type (add to `CycleEvent`).

- [ ] **Step 4: Add tests for each branch**

```typescript
test("stale resurrection offer is ignored, corpse run proceeds", async () => { ... });
test("reclaim delay waits bounded then retries once", async () => { ... });
test("cross-map corpse stops with pose and range", async () => { ... });
test("ground refusal retries once at fixed angle then stops", async () => { ... });
test("reclaim restores life and resumes next target", async () => { ... });
```

Use `jest.useFakeTimers()` with `advanceTimersByTime()` in `try/finally` with `jest.useRealTimers()` for the delay-wait test.

- [ ] **Step 5: Run tests, typecheck, format**

Run: `mise test src/wow/encounter-cycle.test.ts && mise typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/wow/encounter-cycle.ts src/wow/encounter-cycle.test.ts
git commit -m "feat: Add cycle death recovery with bounds" -m "Resurrection accept-if-current, bounded delay wait, honest direct-leg travel, all waits bounded."
```

### Task 4: Halt ownership and client wiring

**Files:**
- Modify: `src/wow/client.ts`, `src/test/mock-handle.ts`, `src/daemon/start.test.ts`

**Interfaces:**
- Consumes: `EncounterCycleRuntime` from Tasks 1-3.
- Produces: `startCycle` / `stopCycle` / `getCycleState` / `onCycleEvent` on `WorldHandle` for Task 5.

Read first: `src/wow/client.ts:604-718` (`rawHalt`, `override`, runtime construction) and `src/wow/client.ts:1279-1300` (handle `move`/`halt` showing the override pattern). Note which handle methods the loop must avoid: every method calling `override()` stops tactics and follow. The cycle runtime receives the inner `tactics`, `rewards`, `recovery`, and `control` objects directly, exactly like `FollowRuntime` receives `control`. The `CycleTactics` adapter maps `start` to `tactics.start({ targetGuid, instruction, framing? }, signal)`, `lastOutcome` to `tactics.snapshot().lastOutcome`, `selfDead` to `recovery.snapshot().life` being `dead` or `ghost`.

Critical: `handle.startCycle` calls `override()` first (like `follow` does at `client.ts:1367-1370`), then starts the runtime. The runtime's own internal calls go to the inner objects and never through handle methods, so they never self-stop. External `halt()` stops the runtime with cause `halt` alongside the existing `follow.stop` / `tactics.stop` / `rawHalt` sequence. Death already stops tactics and follow via the `life_observed` handler at `client.ts:666-676`; the cycle observes the same recovery events and enters its own recovery phase rather than being stopped by them.

- [ ] **Step 1: Write the failing test for wiring**

In `src/daemon/start.test.ts` style (read the inline mock section first): start a cycle through the handle, assert `getCycleState()` reports the phase, call `halt()`, assert the cycle stopped with cause `halt`. Also assert both mocks expose the four methods.

- [ ] **Step 2: Run test to verify it fails**

Run: `mise test src/daemon/start.test.ts`
Expected: FAIL (no `startCycle` on handle)

- [ ] **Step 3: Implement wiring**

Add the four methods to the `WorldHandle` type, construct `EncounterCycleRuntime` next to `follow` in `worldSession`, add handle methods, extend `cleanup()` to dispose the runtime, add the halt branch, and update both mocks. Keep the runtime adapted to inner objects only.

- [ ] **Step 4: Run affected tests, typecheck, format**

Run: `mise test src/daemon/start.test.ts src/wow/client.test.ts && mise typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wow/client.ts src/test/mock-handle.ts src/daemon/start.test.ts
git commit -m "feat: Wire encounter cycle into world handle" -m "Loop-owned calls bypass override; external halt stops the loop."
```

### Task 5: CLI command, daemon dispatch, and help

**Files:**
- Modify: `src/cli/args.ts`, `src/cli/args.test.ts`, `src/daemon/commands.ts`, `src/daemon/commands.test.ts`, `src/cli/help.ts`, `src/cli/help.test.ts`

**Interfaces:**
- Consumes: handle methods from Task 4.
- Produces: the operator and LLM interface.

Read first: `src/cli/args.ts:279-281,553-581` (`parseFight` pattern for guid plus free-text instruction), `src/daemon/commands.ts:100-145` (command union), `commands.ts:351-353` (arg mapping), `commands.ts:843-850` (dispatch), and `src/cli/ipc.ts` (92 lines, how CLI reaches the daemon).

Syntax: `cycle <guid...> [--instruction ...] [--max N] [--framing <variant>]` and `cycling [--json]`. `--max N` caps tactics-loop starts, positive integer, default 10. At least one nonzero GUID required. `--framing` follows the `fight` variant validation. `cycling` mirrors `tactics`/`following` inspect output: phase, current target, queue record, last loot deltas, recovery summary, stop cause. The cycle state object is the same snapshot the event stream carries.

- [ ] **Step 1: Write failing args tests**

```typescript
expect(parseArgs(["cycle", "0xa", "0xb", "--max", "3"])).toEqual({
  mode: "cycle",
  guids: [0xan, 0xbn],
  instruction: "defeat the selected target while keeping the character alive",
  maxStarts: 3,
});
expect(parseArgs(["cycling", "--json"])).toEqual({ mode: "cycling", json: true });
expect(() => parseArgs(["cycle"])).toThrow("Invalid cycle arguments");
expect(() => parseArgs(["cycle", "0"])).toThrow("Invalid cycle guid");
expect(() => parseArgs(["cycle", "0xa", "--max", "0"])).toThrow("Invalid cycle max");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `mise test src/cli/args.test.ts`
Expected: FAIL (no `cycle` mode)

- [ ] **Step 3: Implement args, daemon command types, mapping, dispatch, help text**

Follow `parseFight` for instruction joining and framing validation. Daemon `cycle` dispatch uses the async control-action path like `fight` (`runControlActionAsync`); `cycling` uses `writeInspect` like `tactics`. Help lines:

```
tuicraft cycle <guid...> [--instruction ...] [--max N]  Run fight-loot-next loop (default max 10 starts)
tuicraft cycling [--json]  Cycle phase, queue, loot deltas and stop cause
```

Add both subcommands to `help.test.ts` coverage lists. Update the four docs in Task 6, not here.

- [ ] **Step 4: Run tests, typecheck, format**

Run: `mise test src/cli/args.test.ts src/daemon/commands.test.ts src/cli/help.test.ts && mise typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/args.ts src/cli/args.test.ts src/daemon/commands.ts src/daemon/commands.test.ts src/cli/help.ts src/cli/help.test.ts
git commit -m "feat: Add cycle CLI and daemon commands" -m "Explicit GUID queue with max-starts cap; cycling inspects phase, queue, loot, and stop cause."
```

### Task 6: Docs, roadmap repair, and full verification

**Files:**
- Modify: `docs/manual.md`, `.claude/skills/tuicraft/SKILL.md`, `README.md`, `docs/roadmap.md`

**Interfaces:**
- Consumes: final CLI surface from Task 5.
- Produces: complete M4 implementation increment.

Roadmap repair replaces `docs/roadmap.md:600-607` (the stale movement paragraph):

```markdown
Movement is an offered action since milestone 3: Jev selects among
`move_forward`, `move_backward`, `strafe_left`, `strafe_right`, and
`stop_moving`, held under a renewable 2500ms lease with ground safety
outranking the lease. This milestone consumes that capability as is and
changes no movement candidate, lease value, or movement judgment. Route
planning to a destination lives under milestone 3a; corpse travel here
uses bounded direct legs only, with no planner, destination sampling, or
arrival logic.
```

Verify the line range before editing; re-read `docs/roadmap.md:595-610` first.

- [ ] **Step 1: Update the four docs**

`help.ts` already done in Task 5. Add `cycle`/`cycling` to `docs/manual.md` command reference, the agent skill command list in `.claude/skills/tuicraft/SKILL.md`, and `README.md` feature list. Keep each entry to what the command does plus the skip and stop-cause semantics.

- [ ] **Step 2: Rewrite the stale roadmap paragraph**

Replace the paragraph at the verified line range with the text above.

- [ ] **Step 3: Run the full gate**

Run: `mise ci`
Expected: PASS (typecheck, coverage tests, format).

- [ ] **Step 4: Commit**

```bash
git add docs/manual.md .claude/skills/tuicraft/SKILL.md README.md docs/roadmap.md
git commit -m "docs: Document cycle loop and repair M4 text" -m "Cycle command in all four docs; M4 paragraph now consumes M3 movement as-is."
```

Live proof (spec Evidence section: fight run with loot plus one clean death cycle) needs the real server and two test accounts. Do not claim it without `mise test:live`. If credentials or server are unavailable, leave the run to the operator and say so in the handoff.

## Self-Review

**Spec coverage:** Loop unit → Tasks 1, 4, 5. Trouble rules → Tasks 1 (skip), 2 (loot), 3 (death). LLM ergonomics → Task 5 (explicit queue, auto-loot, single state object) plus Task 3 (honest travel) plus Task 4 (halt-wins). Roadmap repair → Task 6. Evidence record-keeping → lastLoot, per-target causes, raw runtime snapshots in state. No movement or judgment changes anywhere. Out-of-scope items have no task by design.

**Placeholder scan:** every step names exact files, exact commands, exact expected output, or exact code. The two "read first" pointers name file and line ranges, not "appropriate handling". Timeout and travel constants carry literal values.

**Type consistency:** `CycleTactics`, `CycleLoot`, `CycleRecovery`, `CycleControl` defined once in Task 1-3 headers; Task 4 adapts inner runtimes to them; `CycleState` gains `lastLoot` in Task 2 and keeps it after. `stopCause` strings (`max_starts_reached`, `queue_exhausted`, `halt`, `loot_denied:*`, `loot_inventory_full`, `loot_release_only_reconnect_required`, `corpse_absent`, `reclaim_delayed`, `corpse_out_of_range`, `corpse_unreachable`) are produced in Tasks 1-3 and surfaced unchanged in Task 5.

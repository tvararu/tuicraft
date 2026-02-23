# Tail/Read Conflict Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate event contention between `tail`, `read`, and `--wait` by making `READ_WAIT` non-destructive.

**Architecture:** Add a `slice(from)` method to RingBuffer for non-destructive reads. Change `READ_WAIT`/`READ_WAIT_JSON` dispatch to snapshot `writePos` before sleeping, then `slice(savedPos)` after. `READ`/`READ_JSON` keep using `drain()`.

**Tech Stack:** TypeScript, Bun, bun:test

---

### Task 1: RingBuffer — add `slice()` and `writePos` getter

**Files:**

- Modify: `src/lib/ring-buffer.ts`
- Test: `src/lib/ring-buffer.test.ts`

**Step 1: Write failing tests for `slice()` and `writePos`**

Add to the existing `describe("RingBuffer")` block in `src/lib/ring-buffer.test.ts`:

```typescript
test("writePos starts at zero", () => {
  const buf = new RingBuffer<string>(10);
  expect(buf.writePos).toBe(0);
});

test("writePos advances on push", () => {
  const buf = new RingBuffer<string>(10);
  buf.push("a");
  buf.push("b");
  expect(buf.writePos).toBe(2);
});

test("slice returns items from position to writePos", () => {
  const buf = new RingBuffer<string>(10);
  buf.push("a");
  buf.push("b");
  buf.push("c");
  expect(buf.slice(1)).toEqual(["b", "c"]);
});

test("slice from zero returns all items", () => {
  const buf = new RingBuffer<string>(10);
  buf.push("a");
  buf.push("b");
  expect(buf.slice(0)).toEqual(["a", "b"]);
});

test("slice from writePos returns empty", () => {
  const buf = new RingBuffer<string>(10);
  buf.push("a");
  buf.push("b");
  expect(buf.slice(2)).toEqual([]);
});

test("slice clamps to oldest on overflow", () => {
  const buf = new RingBuffer<string>(3);
  buf.push("a");
  buf.push("b");
  buf.push("c");
  buf.push("d");
  expect(buf.slice(0)).toEqual(["b", "c", "d"]);
});

test("slice is non-destructive", () => {
  const buf = new RingBuffer<string>(10);
  buf.push("a");
  buf.push("b");
  expect(buf.slice(0)).toEqual(["a", "b"]);
  expect(buf.slice(0)).toEqual(["a", "b"]);
});

test("slice does not affect drain cursor", () => {
  const buf = new RingBuffer<string>(10);
  buf.push("a");
  buf.push("b");
  buf.slice(0);
  expect(buf.drain()).toEqual(["a", "b"]);
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/lib/ring-buffer.test.ts`
Expected: FAIL — `writePos` and `slice` don't exist yet.

**Step 3: Implement `slice()` and `writePos` getter**

In `src/lib/ring-buffer.ts`, rename the `writePos` field to `_writePos`, add
a getter, and add the `slice` method:

```typescript
export class RingBuffer<T> {
  private items: (T | undefined)[];
  private capacity: number;
  private _writePos = 0;
  private cursor = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.items = new Array<T | undefined>(capacity);
  }

  get writePos(): number {
    return this._writePos;
  }

  push(item: T): void {
    this.items[this._writePos % this.capacity] = item;
    this._writePos++;
    const oldest = this._writePos - this.capacity;
    if (this.cursor < oldest) {
      this.cursor = oldest;
    }
  }

  drain(): T[] {
    const result: T[] = [];
    for (let i = this.cursor; i < this._writePos; i++) {
      result.push(this.items[i % this.capacity] as T);
    }
    this.cursor = this._writePos;
    return result;
  }

  slice(from: number): T[] {
    const oldest = this._writePos - this.capacity;
    const start = from < oldest ? oldest : from;
    const result: T[] = [];
    for (let i = start; i < this._writePos; i++) {
      result.push(this.items[i % this.capacity] as T);
    }
    return result;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `mise test src/lib/ring-buffer.test.ts`
Expected: All PASS.

**Step 5: Commit**

```
feat: Add non-destructive slice method to RingBuffer

READ_WAIT needs to read events from a window without advancing the
shared cursor. The new slice(from) method returns items from a given
position to writePos without mutating any internal state.
```

---

### Task 2: Switch `read_wait` dispatch to window-based slicing

**Files:**

- Modify: `src/daemon/commands.ts`
- Test: `src/daemon/commands.test.ts`

**Step 1: Write failing test for window-based read_wait**

Add a new test in `src/daemon/commands.test.ts` inside the `dispatchCommand`
describe block. This test verifies that events pushed BEFORE the read_wait call
are NOT returned, and events pushed DURING the wait ARE returned:

```typescript
test("read_wait returns only events arriving during wait window", async () => {
  jest.useFakeTimers();
  try {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    events.push({ text: "[say] Old: before", json: '{"type":"SAY"}' });
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const promise = dispatchCommand(
      { type: "read_wait", ms: 1000 },
      handle,
      events,
      socket,
      cleanup,
    );

    events.push({ text: "[say] New: during", json: '{"type":"SAY"}' });
    jest.advanceTimersByTime(1000);
    await promise;
    expect(socket.written()).toBe("[say] New: during\n\n");
  } finally {
    jest.useRealTimers();
  }
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/daemon/commands.test.ts`
Expected: FAIL — current implementation drains ALL events including "Old: before".

**Step 3: Add sliceText and sliceJson helpers, update dispatch**

In `src/daemon/commands.ts`, add two new helper functions after the existing
`drainText`/`drainJson`:

```typescript
function sliceText(events: RingBuffer<EventEntry>, from: number): string[] {
  return events
    .slice(from)
    .flatMap((e) => (e.text !== undefined ? [e.text] : []));
}

function sliceJson(events: RingBuffer<EventEntry>, from: number): string[] {
  return events.slice(from).map((e) => e.json);
}
```

Then change the `read_wait` and `read_wait_json` cases in `dispatchCommand`:

```typescript
    case "read_wait": {
      const start = events.writePos;
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          writeLines(socket, sliceText(events, start));
          resolve();
        }, cmd.ms);
      });
      return false;
    }
    case "read_wait_json": {
      const start = events.writePos;
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          writeLines(socket, sliceJson(events, start));
          resolve();
        }, cmd.ms);
      });
      return false;
    }
```

**Step 4: Run all tests to verify they pass**

Run: `mise test src/daemon/commands.test.ts`
Expected: All PASS. The existing `read_wait delays then drains` test pushes an
event BEFORE the call and expects it in output — this test needs updating first
(see step 5).

**Step 5: Update the existing read_wait test**

The existing test at line 469 (`read_wait delays then drains`) pushes an event
before the dispatch call. With window-based slicing, that pre-existing event
won't be returned. Update the test to push the event DURING the wait:

```typescript
test("read_wait delays then drains", async () => {
  jest.useFakeTimers();
  try {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const promise = dispatchCommand(
      { type: "read_wait", ms: 1000 },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(socket.written()).toBe("");
    events.push({ text: "[say] Alice: hi", json: '{"type":"SAY"}' });
    jest.advanceTimersByTime(1000);
    await promise;
    expect(socket.written()).toBe("[say] Alice: hi\n\n");
  } finally {
    jest.useRealTimers();
  }
});
```

Do the same for the `read_wait_json delays then drains json` test at line 589:

```typescript
test("read_wait_json delays then drains json", async () => {
  jest.useFakeTimers();
  try {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const promise = dispatchCommand(
      { type: "read_wait_json", ms: 500 },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(socket.written()).toBe("");
    events.push({ text: "[say] Alice: hi", json: '{"type":"SAY"}' });
    jest.advanceTimersByTime(500);
    await promise;
    expect(socket.written()).toBe('{"type":"SAY"}\n\n');
  } finally {
    jest.useRealTimers();
  }
});
```

**Step 6: Run full test suite**

Run: `mise test`
Expected: All PASS.

**Step 7: Commit**

```
feat: Switch READ_WAIT to window-based slicing

READ_WAIT now snapshots writePos before sleeping and slices from that
position after waking. This makes READ_WAIT non-destructive — multiple
tail or --wait clients capture independent event windows without
draining the shared cursor that READ depends on.
```

---

### Task 3: Integration verification

**Step 1: Run full test suite**

Run: `mise ci`
Expected: typecheck, test, and format all pass.

**Step 2: Run live server tests**

Run: `MISE_TASK_TIMEOUT=60s mise test:live`
Expected: All PASS. If the server is unavailable, note it and defer to the user.

**Step 3: Commit design doc update**

The design doc at `docs/plans/2026-02-23-tail-read-conflict-design.md` was
already updated to reflect the hybrid approach. Amend or create a commit:

```
docs: Update tail/read conflict design to hybrid approach

Per-socket cursors don't work with ephemeral connections. The hybrid
approach keeps READ on the shared drain cursor and switches READ_WAIT
to non-destructive window-based slicing.
```

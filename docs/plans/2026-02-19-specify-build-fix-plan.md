# SPECIFY_BUILD Byte Skip Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix `parseRealmList` to skip 5 bytes (not 4) when the SPECIFY_BUILD flag is set, and correct the test fixture to match the real wire format.

**Architecture:** The version info block appended when flag `0x04` is set is 3x uint8 (major, minor, patch) + 1x uint16 (build) = 5 bytes. The parser currently treats build as uint8 and skips only 4 bytes, misaligning the reader for all subsequent realm entries. The test fixture has the same mistake: it writes 1 byte for build instead of 2.

**Tech Stack:** TypeScript, Bun, bun:test

---

### Task 1: Fix the test fixture, then the implementation

**Files:**
- Modify: `src/wow/protocol/auth.test.ts:220`
- Modify: `src/wow/protocol/auth.ts:137`
- Modify: `docs/bugs.md:7`

**Step 1: Update the test to write the correct wire format**

In `src/wow/protocol/auth.test.ts`, find the test `"parseRealmList skips version info when flags & 0x04"` (around line 201). The body writer section after `bodyWriter.uint8(7)` (the realm id) currently looks like:

```typescript
bodyWriter.uint8(3);
bodyWriter.uint8(3);
bodyWriter.uint8(5);
bodyWriter.uint8(0);   // BUG: build is uint16, this is only 1 byte
```

Change the last line to write a uint16:

```typescript
bodyWriter.uint8(3);
bodyWriter.uint8(3);
bodyWriter.uint8(5);
bodyWriter.uint16LE(12340);   // build number: uint16, 2 bytes
```

**Step 2: Run the test to verify it now fails**

```bash
mise test src/wow/protocol/auth.test.ts
```

Expected: the `"parseRealmList skips version info when flags & 0x04"` test fails with a RangeError or wrong value, because the parser is still only skipping 4 bytes.

**Step 3: Fix the parser skip count**

In `src/wow/protocol/auth.ts`, the SPECIFY_BUILD block at line 135 currently reads:

```typescript
if (flags & 0x04) {
  r.skip(3);
  r.skip(1);
}
```

Change `r.skip(1)` to `r.skip(2)`:

```typescript
if (flags & 0x04) {
  r.skip(3);
  r.skip(2);
}
```

**Step 4: Run the full test suite to verify everything passes**

```bash
mise test
```

Expected: all tests pass, including `"parseRealmList skips version info when flags & 0x04"`.

**Step 5: Check off the bug in docs/bugs.md**

In `docs/bugs.md`, line 7 currently reads:

```
- [ ] SPECIFY_BUILD flag skips wrong byte count in realm parsing
```

Change to:

```
- [x] SPECIFY_BUILD flag skips wrong byte count in realm parsing
```

**Step 6: Commit**

```bash
git add src/wow/protocol/auth.ts src/wow/protocol/auth.test.ts docs/bugs.md
git commit -m "fix: Skip 5 bytes for SPECIFY_BUILD version info in realm parsing

The build number field is uint16 (2 bytes), not uint8 (1 byte).
Skipping only 4 bytes misaligned the reader and corrupted all
subsequent realm entries when any realm had the 0x04 flag set."
```

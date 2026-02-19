# Design: Fix SPECIFY_BUILD byte skip in realm parsing

## Problem

When a realm entry has flag `0x04` (SPECIFY_BUILD) set, `parseRealmList` in
`src/wow/protocol/auth.ts` skips 4 bytes instead of 5. The version info block
contains 3x uint8 (major, minor, patch) followed by 1x uint16 (build number) —
5 bytes total. Skipping only 4 misaligns the reader and silently corrupts every
subsequent realm entry in the list.

The companion test (`parseRealmList skips version info when flags & 0x04`)
writes only 1 byte for the build field, so it passes against the buggy code.

## Fix

Two files, three one-line edits:

**`src/wow/protocol/auth.ts` line 137** — change `r.skip(1)` to `r.skip(2)`.
The build number is uint16 (2 bytes), not uint8.

**`src/wow/protocol/auth.test.ts` line 220** — change `bodyWriter.uint8(0)` to
`bodyWriter.uint16LE(12340)`. This makes the test packet match the real wire
format (12340 is the 3.3.5a build number used throughout the codebase).

**`docs/bugs.md` line 7** — check the box on the SPECIFY_BUILD bug entry.

## Scope

No interface changes. The `Realm` type does not expose version fields, and the
fix is skip-only: we discard the version bytes because the client has no use for
them. No new tests are needed — the existing test covers this path and will
validate the fix once its fixture data is corrected.

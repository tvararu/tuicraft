# M4 encounter cycles implementation plan

Date: 2026-09-22. Condensed 2026-09-24. The full task-by-task plan, with its
test code and step checklists, is at `9c47b07`.

**Goal:** build the M4 `cycle` loop command: GUID queue, per-target skip,
auto-loot, death recovery, external halt wins.

**Spec:** [2026-09-22-m4-encounter-cycles-design.md](2026-09-22-m4-encounter-cycles-design.md).
The milestone 4 section of the roadmap is canonical on conflicts.

**Status:** implemented and live-proven; see the roadmap and
[docs/evidence/m4/](../evidence/m4/).

## Tasks as planned and as landed

1. **Queue and skip** (`8257be6 feat: Add encounter cycle queue with skip`).
   `EncounterCycleRuntime` with `CycleState`, `CycleEvent` and narrow deps.
   A lost target records its cause and the loop advances; the loop stops at
   the end of the queue or when `--max` tactics-loop starts are used
   (default 10).
2. **Auto-loot** (`707f603 feat: Add cycle auto-loot with denial stops`).
   Open, take each offered slot, take money, wait for quiescence bounded by
   `LOOT_SETTLE_MS = 5000`, close, record `lastLoot`. An empty offer closes
   and advances. Offer error or refused take stops with `loot_denied:<detail>`;
   full inventory with `loot_inventory_full`; release-only denial with
   `loot_release_only_reconnect_required`.
3. **Death recovery** (`b360792 feat: Add cycle death recovery with bounds`).
   Constants `RECLAIM_MARGIN_MS = 2000`, `LEG_LEASE_MS = 3000`,
   `DETOUR_RAD = Math.PI / 4`, `RECOVERY_WAIT_MS = 30000`. Order: accept a
   current-epoch offer; else release if dead, query the corpse, wait a known
   reclaim delay once, travel in bounded legs with one fixed-angle retry,
   reclaim and await observed life. Stop causes `corpse_absent`,
   `reclaim_delayed`, `corpse_out_of_range`, `corpse_unreachable`.
4. **Handle wiring** (`0ac3fef feat: Wire encounter cycle into world handle`).
   `startCycle`, `stopCycle`, `getCycleState` and `onCycleEvent` on
   `WorldHandle` and both mocks. `startCycle` calls `override()` once; the
   runtime then drives the inner tactics, loot, recovery and control objects
   directly. External `halt` stops it with cause `halt`.
5. **CLI and daemon** (`a366411 feat: Add cycle CLI and daemon commands`,
   `d276381 feat: Wire cycle events into daemon stream`). `cycle <guid...>
   [--instruction ...] [--max N]` and `cycling [--json]`.
6. **Docs** (`6f7f4f7 docs: Document cycle loop and repair M4 text`). The four
   doc places and the roadmap movement paragraph.

Deviations from the plan text:

- The plan specified `cycle ... [--framing <variant>]`. It never shipped;
  `cycle` has no `--framing`, as the manual and skill state.
- The plan modelled the runtime on `FollowRuntime` and wired it beside
  `follow`. The 2026-09-24 review deleted `follow` (`05ee035`).
- Live runs added the release acknowledgement barrier and one-take-at-a-time
  confirmation (`b4c5c6c`, `02c1df7`). The shipped loop also stops with
  `loot_release_unconfirmed` and `loot_denied:timeout`
  (`src/wow/loot-run.ts`).
- The 2026-09-24 review split the loot and corpse steps out of
  `encounter-cycle.ts` into `loot-run.ts` and `corpse-run.ts` (`cdf79e3`).

## Verification

`mise ci` for each task, `mise test:live` for the daemon change, and live
cycles recorded in `docs/evidence/m4/`.

# M2 evidence: a constrained Jev-controlled encounter

Milestone 2 needs five completed autonomous encounters plus four robustness
exercises. Attempt05 is treated as history rather than as evidence, because it
predates the probability renormalisation fix in `3e1f3aa`; all five counted
encounters run after it.

## Encounters

None recorded yet.

| # | Result | Level | Creature | Decisions | Cadence /s | Variant |
|---|--------|-------|----------|-----------|------------|---------|

## Robustness exercises

| Exercise | Status | Record |
|----------|--------|--------|
| Cancellation after the correlated-failure repair | not run | |
| Delayed response past the bound | not run | |
| Obsolete decision | not run | |
| Model unavailable | not run | |

These three faults cannot be produced by farming. Each one is constructed at the
Jev boundary during a real session against the real server. A unit test does not
satisfy the gate.

## Reading a record

See [../README.md](../README.md). Note in particular that `cadence.perSecond` is
decisions over wall-clock time, not the reciprocal of request latency.

## Limits carried in these records

The character levels during the farming run, so her spell kit, mana pool and the
relative difficulty of creatures all change. Encounters are therefore not
controlled comparisons, and no prompt variant may be described as measured
better on this evidence. The single exception is the standing-instruction
contrast pair, which runs back to back at one level against comparable
creatures.

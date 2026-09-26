# Gameplay evidence

Compact, committed records of live gameplay. A milestone gate is an evidence
requirement, and evidence that exists only in `tmp/` satisfies nothing: `tmp/`
is gitignored and is pushed nowhere.

Each record is distilled from the daemon session log, which already captures
every tactics event as a `TACTICS` line. Produce one with:

    mise evidence:encounter <runId|latest> <prompt-variant> > docs/evidence/m2/encounter-NN.json

A record holds the offered actions, the Jev choice and its probabilities, the
measured request latency, whether the decision was applied or discarded, the
outcome, and both the character level and the creature level. The two levels
are there because the character levels during a farming run, so encounters are
not comparable without them.

`cadence.perSecond` is decisions over wall-clock time for the whole encounter,
including execution. It is not the reciprocal of a request latency, and the two
must never be presented as the same measurement.

Raw session-log slices stay in `tmp/` as backing detail. The committed record
is what a reader inspects.

## Milestones

- [m2/](m2/README.md) — a constrained Jev-controlled encounter
- [m3/](m3/README.md) — movement as a tactical action
- [m3a/](m3a/funnel-corner.md) — reliable local navigation (funnel corner)
- [m4/](m4/README.md) — repeatable encounter cycles
- [m5/](m5/README.md) — the first quest (8325) end to end

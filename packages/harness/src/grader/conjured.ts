import type { Truth } from "#harness/grader/truth";

type Pair = { baseline: Truth | null; final: Truth | null };

const CONJURED_ITEMS: ReadonlySet<number> = new Set([5349, 5350, 43_518]);

export function withoutRemovedConjured({ baseline, final }: Pair): Pair {
  if (baseline === null) return { baseline, final };
  const kept = new Set((final?.inventory ?? []).map(({ item }) => item));
  return {
    baseline: {
      ...baseline,
      inventory: baseline.inventory.filter(
        ({ item }) => !CONJURED_ITEMS.has(item) || kept.has(item),
      ),
    },
    final,
  };
}

import type { Truth } from "#harness/grader/truth";

const CONJURED_FLAG = 0x00_00_00_02;

type Pair = { baseline: Truth | null; final: Truth | null };

const isConjured = (
  item: number,
  flags: Readonly<Record<string, number>>,
): boolean => Math.floor((flags[item] ?? 0) / CONJURED_FLAG) % 2 === 1;

export function withoutRemovedConjured(
  { baseline, final }: Pair,
  flags: Readonly<Record<string, number>> = {},
): Pair {
  if (baseline === null || final === null) return { baseline, final };
  const held = final.inventory.map(({ item }) => item);
  return {
    baseline: {
      ...baseline,
      inventory: baseline.inventory.filter(
        ({ item }) => !isConjured(item, flags) || held.includes(item),
      ),
    },
    final,
  };
}

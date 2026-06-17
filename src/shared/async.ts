/**
 * Bounded-concurrency async map. Preserves input order in the output array, so
 * results stay deterministic regardless of completion order — important because
 * scoring must not depend on scheduling.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const effectiveLimit = Math.max(1, Math.floor(limit));
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  }

  const workers = Array.from({ length: Math.min(effectiveLimit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

import type { Candlestick } from '@/domain/candle';

/** Merge an extended trade window, replacing overlapping bars with fresh data. */
export function mergeCandles(
  current: Candlestick[],
  incoming: Candlestick[]
): Candlestick[] {
  if (!incoming.length) return current;
  if (!current.length) return incoming;
  if (incoming[incoming.length - 1].timestampMs < current[0].timestampMs) {
    return [...incoming, ...current];
  }
  if (incoming[0].timestampMs > current[current.length - 1].timestampMs) {
    return [...current, ...incoming];
  }
  const merged = new Map(current.map((candle) => [candle.timestampMs, candle]));
  let changed = false;
  for (const candle of incoming) {
    const existing = merged.get(candle.timestampMs);
    if (
      !existing ||
      existing.open !== candle.open ||
      existing.high !== candle.high ||
      existing.low !== candle.low ||
      existing.close !== candle.close ||
      existing.volume !== candle.volume
    ) {
      changed = true;
    }
    merged.set(candle.timestampMs, candle);
  }
  if (!changed) return current;
  return [...merged.values()].sort(
    (left, right) => left.timestampMs - right.timestampMs
  );
}

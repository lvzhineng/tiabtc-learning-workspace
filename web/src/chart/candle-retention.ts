import type { Candlestick } from '@/domain/candle';
import { mergeCandles } from './merge-candles';
import { recordPerformance } from '@/ui/performance-records';

/** Active chart data is bounded independently of API and shard-cache limits. */
export const MAX_ACTIVE_CANDLES = 12_000;

export function lowerBoundCandle(candles: Candlestick[], timestampMs: number): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (candles[middle].timestampMs < timestampMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function retainCandleWindow(
  candles: Candlestick[],
  direction: 'before' | 'after',
  anchorTimeMs?: number | null
): Candlestick[] {
  if (candles.length <= MAX_ACTIVE_CANDLES) return candles;
  const anchor = anchorTimeMs == null ? null : lowerBoundCandle(candles, anchorTimeMs);
  const start = anchor === null
    ? direction === 'before' ? 0 : candles.length - MAX_ACTIVE_CANDLES
    : Math.max(0, Math.min(candles.length - MAX_ACTIVE_CANDLES,
        anchor - Math.floor(MAX_ACTIVE_CANDLES * 0.75)));
  return candles.slice(start, start + MAX_ACTIVE_CANDLES);
}

export function mergeCandleWindow(
  current: Candlestick[],
  incoming: Candlestick[],
  direction: 'before' | 'after',
  anchorTimeMs?: number | null
): Candlestick[] {
  const started = performance.now();
  const retained = retainCandleWindow(mergeCandles(current, incoming), direction, anchorTimeMs);
  recordPerformance({ operation: 'chart.merge-window', durationMs: performance.now() - started, count: retained.length });
  return retained;
}

/** Keep the same visible candle and fractional offset through prepend/eviction. */
export function preserveCandleViewport(
  previous: Candlestick[],
  next: Candlestick[],
  range: { from: number; to: number }
): { from: number; to: number } {
  if (!previous.length || !next.length) return range;
  const oldIndex = Math.max(0, Math.min(previous.length - 1, Math.floor(range.from)));
  const newIndex = lowerBoundCandle(next, previous[oldIndex].timestampMs);
  if (next[newIndex]?.timestampMs !== previous[oldIndex].timestampMs) {
    // A replay cursor can move beyond a manually inspected old window.
    // Preserve zoom while safely clamping a viewport whose bars were evicted.
    const span = range.to - range.from;
    const from = Math.max(0, Math.min(next.length - 1 - span, newIndex));
    return { from, to: from + span };
  }
  const offset = newIndex - oldIndex;
  return { from: range.from + offset, to: range.to + offset };
}

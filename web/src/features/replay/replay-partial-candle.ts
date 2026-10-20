import type { Candlestick } from '@/domain/candle';
import { REVIEW_TIMEFRAMES, type ReviewTimeframe } from '@/domain/timeframe';
import { timeframeMs } from '@/chart/chart-time';

export type ReplayCandleSegment = {
  interval: ReviewTimeframe;
  fromMs: number;
  toMs: number;
};

/** Partition only elapsed time, using coarse closed bars plus a fine tail. */
export function replayCandleSegments(
  startMs: number,
  cursorMs: number,
  timeframe: ReviewTimeframe
): ReplayCandleSegment[] {
  const segments: ReplayCandleSegment[] = [];
  let fromMs = startMs;
  const endMs = Math.min(cursorMs, startMs + timeframeMs(timeframe));
  for (const interval of [...REVIEW_TIMEFRAMES].reverse()) {
    const step = timeframeMs(interval);
    if (step >= timeframeMs(timeframe)) continue;
    const count = Math.floor((endMs - fromMs) / step);
    if (count <= 0) continue;
    const toMs = fromMs + count * step;
    segments.push({ interval, fromMs, toMs });
    fromMs = toMs;
  }
  return segments;
}

export function aggregateReplayCandle(
  rows: Candlestick[],
  symbol: string,
  interval: ReviewTimeframe,
  startMs: number,
  cursorMs: number
): Candlestick | null {
  // Never use even a smaller bar unless it has closed by the replay clock.
  const elapsed = rows.filter((bar) => bar.symbol === symbol &&
    bar.timestampMs >= startMs &&
    bar.timestampMs + timeframeMs(bar.interval) <= cursorMs
  ).sort((a, b) => a.timestampMs - b.timestampMs);
  if (elapsed.length === 0) return null;
  return {
    symbol, interval, timestampMs: startMs,
    open: elapsed[0].open,
    high: Math.max(...elapsed.map((bar) => bar.high)),
    low: Math.min(...elapsed.map((bar) => bar.low)),
    close: elapsed[elapsed.length - 1].close,
    volume: elapsed.reduce((sum, bar) => sum + bar.volume, 0),
  };
}

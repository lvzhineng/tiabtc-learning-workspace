import type { Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { timeframeMs } from '@/chart/chart-time';

function completionTimeMs(
  candle: Candlestick,
  timeframe: ReviewTimeframe
): number {
  return candle.timestampMs + timeframeMs(timeframe);
}

function firstCompletionAfter(
  candles: Candlestick[],
  targetTimeMs: number,
  timeframe: ReviewTimeframe,
  includeEqual: boolean
): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const completion = completionTimeMs(candles[middle], timeframe);
    const belongsOnLeft = includeEqual
      ? completion >= targetTimeMs
      : completion > targetTimeMs;
    if (belongsOnLeft) high = middle;
    else low = middle + 1;
  }
  return low;
}

export function filterVisibleCandles(
  candles: Candlestick[],
  cursorTimeMs: number,
  timeframe: ReviewTimeframe
): Candlestick[] {
  if (!candles || candles.length === 0) return [];
  const visibleCount = firstCompletionAfter(
    candles,
    cursorTimeMs,
    timeframe,
    false
  );
  return visibleCount === candles.length
    ? candles
    : candles.slice(0, visibleCount);
}

export function getNextCursorTimeMs(
  candles: Candlestick[],
  currentCursorTimeMs: number,
  timeframe: ReviewTimeframe
): number {
  if (!candles || candles.length === 0) return currentCursorTimeMs;
  const nextIndex = firstCompletionAfter(
    candles,
    currentCursorTimeMs,
    timeframe,
    false
  );
  return nextIndex < candles.length
    ? completionTimeMs(candles[nextIndex], timeframe)
    : currentCursorTimeMs;
}

export function findCandleCompletingAt(
  candles: Candlestick[],
  completionTime: number,
  timeframe: ReviewTimeframe
): Candlestick | null {
  const index = firstCompletionAfter(
    candles,
    completionTime,
    timeframe,
    true
  );
  const candle = candles[index];
  return candle &&
    completionTimeMs(candle, timeframe) === completionTime
    ? candle
    : null;
}

export function getPrevCursorTimeMs(
  candles: Candlestick[],
  currentCursorTimeMs: number,
  startCursorTimeMs: number,
  timeframe: ReviewTimeframe
): number {
  if (currentCursorTimeMs <= startCursorTimeMs) return startCursorTimeMs;
  if (!candles || candles.length === 0) return startCursorTimeMs;
  const currentIndex = firstCompletionAfter(
    candles,
    currentCursorTimeMs,
    timeframe,
    true
  );
  const previousIndex = currentIndex - 1;
  const previousTime =
    previousIndex >= 0
      ? completionTimeMs(candles[previousIndex], timeframe)
      : startCursorTimeMs;
  return Math.max(previousTime, startCursorTimeMs);
}

export function shouldPrefetchFuture(
  candles: Candlestick[],
  cursorTimeMs: number,
  timeframe: ReviewTimeframe,
  thresholdBars = 30
): boolean {
  if (!candles || candles.length === 0) return true;
  const cursorIndex = firstCompletionAfter(
    candles,
    cursorTimeMs,
    timeframe,
    true
  );
  if (cursorIndex >= candles.length) return true;
  return candles.length - cursorIndex - 1 <= thresholdBars;
}

export function formatDateTimeLocalInput(dateMs: number): string {
  const date = new Date(dateMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function parseDateTimeInput(inputStr: string): number {
  const trimmed = inputStr.trim();
  if (!trimmed) return Date.now();
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return parsed;
  return Date.now();
}

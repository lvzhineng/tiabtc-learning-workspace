import type { Candlestick } from '@/domain/candle';

export function filterVisibleCandles(candles: Candlestick[], cursorTimeMs: number): Candlestick[] {
  if (!candles || candles.length === 0) return [];
  return candles.filter((c) => c.timestampMs <= cursorTimeMs);
}

export function getNextCursorTimeMs(candles: Candlestick[], currentCursorTimeMs: number): number {
  if (!candles || candles.length === 0) return currentCursorTimeMs;
  const sorted = [...candles].sort((a, b) => a.timestampMs - b.timestampMs);
  const next = sorted.find((c) => c.timestampMs > currentCursorTimeMs);
  return next ? next.timestampMs : currentCursorTimeMs;
}

export function getPrevCursorTimeMs(
  candles: Candlestick[],
  currentCursorTimeMs: number,
  startCursorTimeMs: number
): number {
  if (currentCursorTimeMs <= startCursorTimeMs) return startCursorTimeMs;
  if (!candles || candles.length === 0) return startCursorTimeMs;

  const sorted = [...candles].sort((a, b) => b.timestampMs - a.timestampMs);
  const prev = sorted.find((c) => c.timestampMs < currentCursorTimeMs);
  if (!prev) return startCursorTimeMs;

  return Math.max(prev.timestampMs, startCursorTimeMs);
}

export function shouldPrefetchFuture(
  candles: Candlestick[],
  cursorTimeMs: number,
  thresholdBars = 30
): boolean {
  if (!candles || candles.length === 0) return true;
  const sorted = [...candles].sort((a, b) => a.timestampMs - b.timestampMs);
  const cursorIndex = sorted.findIndex((c) => c.timestampMs >= cursorTimeMs);
  if (cursorIndex < 0) return true;
  return sorted.length - cursorIndex - 1 <= thresholdBars;
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

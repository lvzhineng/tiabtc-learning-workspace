import type { Candlestick } from '@/domain/candle';

export type EmaPoint = { timestampMs: number; value: number };
export const EMA_PERIODS = [20, 60, 120] as const;
export type EmaPeriod = typeof EMA_PERIODS[number];
export type EmaVisibility = Record<EmaPeriod, boolean>;
export const EMA_COLORS: Record<EmaPeriod, string> = { 20: '#f59e0b', 60: '#3b82f6', 120: '#a855f7' };

/** Calculate from the supplied sequence; session filtering belongs to the caller. */
export function calculateEma(
  candles: readonly Candlestick[], period = 20, seed?: number
): EmaPoint[] {
  if (!candles.length || !Number.isInteger(period) || period < 1) return [];
  const alpha = 2 / (period + 1);
  let value = seed ?? candles[0].close;
  return candles.map((bar, index) => {
    if (index > 0 || seed !== undefined) value += alpha * (bar.close - value);
    return { timestampMs: bar.timestampMs, value };
  });
}

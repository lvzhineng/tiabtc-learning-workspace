import type { Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';

export type RawCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function parseCandleRows(
  rows: RawCandle[] | undefined,
  symbol: string,
  interval: ReviewTimeframe
): Candlestick[] {
  if (!Array.isArray(rows)) return [];

  const candles = new Map<number, Candlestick>();
  for (const raw of rows) {
    if (!raw) continue;
    const timestampMs = Number(raw.timestamp);
    const open = Number(raw.open);
    const high = Number(raw.high);
    const low = Number(raw.low);
    const close = Number(raw.close);
    const volume = Number(raw.volume);
    if (
      !Number.isFinite(timestampMs) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(volume) ||
      timestampMs <= 0 ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      volume < 0
    ) {
      continue;
    }
    // The last row for a timestamp wins, matching both API clients.
    candles.set(timestampMs, {
      symbol,
      interval,
      timestampMs,
      open,
      high,
      low,
      close,
      volume,
    });
  }
  return [...candles.values()].sort(
    (left, right) => left.timestampMs - right.timestampMs
  );
}

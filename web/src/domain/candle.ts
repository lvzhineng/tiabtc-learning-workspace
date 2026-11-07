import type { ReviewTimeframe } from './timeframe';

export type Candlestick = {
  symbol: string;
  interval: ReviewTimeframe;
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** A minute session is complete only when every expected timestamp is present. */
export function isCompleteMinuteSession(
  candles: readonly Pick<Candlestick, 'timestampMs'>[],
  session: { fromMs: number; toMs: number }
): boolean {
  const count = (session.toMs - session.fromMs) / 60_000;
  return Number.isInteger(count) && count > 0 && candles.length === count &&
    candles.every((bar, index) => bar.timestampMs === session.fromMs + index * 60_000);
}

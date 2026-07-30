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

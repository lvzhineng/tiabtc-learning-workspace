import type { Candlestick } from '@/domain/candle';
import {
  TIMEFRAME_SECONDS_MAP,
  type ReviewTimeframe,
} from '@/domain/timeframe';

const EARLIER_EMPTY_RETRY_MS = 30_000;
const LATER_MIN_RETRY_MS = 2_000;
const CANDLE_SETTLE_MS = 2_000;

export type CandleEdgeLoadGuard = {
  earlierAnchorMs: number | null;
  earlierRetryAtMs: number;
  laterAnchorMs: number | null;
  laterRetryAtMs: number;
};

export function createCandleEdgeLoadGuard(): CandleEdgeLoadGuard {
  return {
    earlierAnchorMs: null,
    earlierRetryAtMs: 0,
    laterAnchorMs: null,
    laterRetryAtMs: 0,
  };
}

export function resetCandleEdgeLoadGuard(
  guard: CandleEdgeLoadGuard
): void {
  guard.earlierAnchorMs = null;
  guard.earlierRetryAtMs = 0;
  guard.laterAnchorMs = null;
  guard.laterRetryAtMs = 0;
}

export function shouldAttemptEarlierCandleLoad(
  guard: CandleEdgeLoadGuard,
  anchorMs: number,
  nowMs = Date.now()
): boolean {
  return !(
    guard.earlierAnchorMs === anchorMs && nowMs < guard.earlierRetryAtMs
  );
}

export function shouldAttemptLaterCandleLoad(
  guard: CandleEdgeLoadGuard,
  anchorMs: number,
  nowMs = Date.now()
): boolean {
  return !(
    guard.laterAnchorMs === anchorMs && nowMs < guard.laterRetryAtMs
  );
}

export function recordEarlierCandleLoad(
  guard: CandleEdgeLoadGuard,
  anchorMs: number,
  candles: Candlestick[],
  hasWarning: boolean,
  nowMs = Date.now()
): void {
  const extended = candles.some((candle) => candle.timestampMs < anchorMs);
  if (!extended && !hasWarning) {
    guard.earlierAnchorMs = anchorMs;
    guard.earlierRetryAtMs = nowMs + EARLIER_EMPTY_RETRY_MS;
    return;
  }
  guard.earlierAnchorMs = null;
  guard.earlierRetryAtMs = 0;
}

export function recordLaterCandleLoad(
  guard: CandleEdgeLoadGuard,
  anchorMs: number,
  timeframe: ReviewTimeframe,
  candles: Candlestick[],
  hasWarning: boolean,
  nowMs = Date.now()
): void {
  const extended = candles.some((candle) => candle.timestampMs > anchorMs);
  if (!extended && !hasWarning) {
    guard.laterAnchorMs = anchorMs;
    guard.laterRetryAtMs = Math.max(
      nowMs + LATER_MIN_RETRY_MS,
      anchorMs + TIMEFRAME_SECONDS_MAP[timeframe] * 1000 + CANDLE_SETTLE_MS
    );
    return;
  }
  guard.laterAnchorMs = null;
  guard.laterRetryAtMs = 0;
}

import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import { timestampMsToUtcTimestamp } from './chart-time';
import { timeframeMs } from './chart-time';
import type { Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';

export const SYSTEM_MARKER_ID = '__system__:video-published';

export function buildVideoPublishedMarker(
  publishedTimeMs: number,
  titleOrDate: string,
  candles: Candlestick[],
  timeframe: ReviewTimeframe
): SeriesMarker<UTCTimestamp> {
  const intervalMs = timeframeMs(timeframe);
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].timestampMs + intervalMs <= publishedTimeMs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const containingSeriesCandle = candles[low - 1];
  const markerTimeMs =
    containingSeriesCandle?.timestampMs ?? publishedTimeMs;
  return {
    time: timestampMsToUtcTimestamp(markerTimeMs),
    position: 'aboveBar',
    color: '#FACC15',
    shape: 'arrowDown',
    text: `🎬 发布: ${titleOrDate}`,
  };
}

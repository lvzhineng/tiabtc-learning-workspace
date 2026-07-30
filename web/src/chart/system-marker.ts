import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import { timestampMsToUtcTimestamp } from './chart-time';

export const SYSTEM_MARKER_ID = '__system__:video-published';

export function buildVideoPublishedMarker(
  publishedTimeMs: number,
  titleOrDate: string
): SeriesMarker<UTCTimestamp> {
  return {
    time: timestampMsToUtcTimestamp(publishedTimeMs),
    position: 'aboveBar',
    color: '#FACC15',
    shape: 'arrowDown',
    text: `🎬 发布: ${titleOrDate}`,
  };
}

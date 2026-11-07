import type { IChartApi, Logical } from 'lightweight-charts';
import type { Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { TIMEFRAME_SECONDS_MAP } from '@/domain/timeframe';
import { timestampMsToUtcTimestamp } from '@/chart/chart-time';

/** Project onto the nearest horizontal, vertical, or 45-degree screen direction. */
export function constrainDrawingAngle(
  anchor: { x: number; y: number },
  point: { x: number; y: number }
): { x: number; y: number } {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const threshold = Math.tan(Math.PI / 8);
  if (Math.abs(dy) <= Math.abs(dx) * threshold) return { x: point.x, y: anchor.y };
  if (Math.abs(dx) <= Math.abs(dy) * threshold) return { x: anchor.x, y: point.y };
  const distance = (Math.abs(dx) + Math.abs(dy)) / 2;
  return {
    x: anchor.x + Math.sign(dx) * distance,
    y: anchor.y + Math.sign(dy) * distance,
  };
}

function barSpacing(chart: IChartApi): number | null {
  const scale = chart.timeScale();
  const left = scale.logicalToCoordinate(0 as Logical);
  const right = scale.logicalToCoordinate(1 as Logical);
  return left === null || right === null || right <= left ? null : right - left;
}

/** Interpolate actual adjacent bars, including compressed market closures. */
export function drawingTimestampToCoordinate(
  chart: IChartApi,
  candles: Candlestick[],
  timestampMs: number,
  interval: ReviewTimeframe
): number | null {
  if (candles.length === 0) return null;
  const scale = chart.timeScale();
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].timestampMs < timestampMs) low = middle + 1;
    else high = middle;
  }
  const right = candles[low];
  if (right?.timestampMs === timestampMs) {
    return scale.timeToCoordinate(timestampMsToUtcTimestamp(timestampMs));
  }
  if (low === 0 || low === candles.length) {
    const edge = candles[low === 0 ? 0 : candles.length - 1];
    const x = scale.timeToCoordinate(timestampMsToUtcTimestamp(edge.timestampMs));
    const spacing = barSpacing(chart);
    if (x === null || spacing === null) return null;
    return x + ((timestampMs - edge.timestampMs) / (TIMEFRAME_SECONDS_MAP[interval] * 1000)) * spacing;
  }
  const left = candles[low - 1];
  const leftX = scale.timeToCoordinate(timestampMsToUtcTimestamp(left.timestampMs));
  const rightX = scale.timeToCoordinate(timestampMsToUtcTimestamp(right.timestampMs));
  if (leftX === null || rightX === null) return null;
  return leftX + ((timestampMs - left.timestampMs) / (right.timestampMs - left.timestampMs)) * (rightX - leftX);
}

/** Drawing movement keeps sub-bar precision; chart navigation still snaps to bars. */
export function coordinateToDrawingTimestamp(
  chart: IChartApi,
  candles: Candlestick[],
  coordinate: number,
  interval: ReviewTimeframe
): number | null {
  if (candles.length === 0) return null;
  const scale = chart.timeScale();
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const x = scale.timeToCoordinate(timestampMsToUtcTimestamp(candles[middle].timestampMs));
    if (x === null) return null;
    if (x < coordinate) low = middle + 1;
    else high = middle;
  }
  if (low === 0 || low === candles.length) {
    const edge = candles[low === 0 ? 0 : candles.length - 1];
    const x = scale.timeToCoordinate(timestampMsToUtcTimestamp(edge.timestampMs));
    const spacing = barSpacing(chart);
    if (x === null || spacing === null) return null;
    return edge.timestampMs + ((coordinate - x) / spacing) * TIMEFRAME_SECONDS_MAP[interval] * 1000;
  }
  const left = candles[low - 1];
  const right = candles[low];
  const leftX = scale.timeToCoordinate(timestampMsToUtcTimestamp(left.timestampMs));
  const rightX = scale.timeToCoordinate(timestampMsToUtcTimestamp(right.timestampMs));
  if (leftX === null || rightX === null || rightX <= leftX) return null;
  return left.timestampMs + ((coordinate - leftX) / (rightX - leftX)) * (right.timestampMs - left.timestampMs);
}

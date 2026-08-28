import type { Candlestick } from '@/domain/candle';

export type ReadoutInfo = {
  candle: Candlestick | null;
  priceChange: number;
  priceChangePercent: number;
  formattedOpen: string;
  formattedHigh: string;
  formattedLow: string;
  formattedClose: string;
  formattedVolume: string;
  formattedChange: string;
  formattedOi: string | null;
  formattedCvd: string | null;
  isUp: boolean;
};

export function formatPrice(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1000) {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (absolute >= 1) {
    return value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }
  return value.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 8 });
}

export function formatVolume(volume: number): string {
  const sign = volume < 0 ? '-' : '';
  const absolute = Math.abs(volume);
  if (absolute >= 1_000_000) {
    return `${sign}${(absolute / 1_000_000).toFixed(2)}M`;
  }
  if (absolute >= 1_000) {
    return `${sign}${(absolute / 1_000).toFixed(2)}K`;
  }
  return `${sign}${absolute.toFixed(2)}`;
}

export function findExactTimestampValue(
  points: { timestampMs: number; value: number }[],
  timestampMs: number
): number | null {
  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const current = points[middle].timestampMs;
    if (current === timestampMs) return points[middle].value;
    if (current < timestampMs) low = middle + 1;
    else high = middle - 1;
  }
  return null;
}

export function computeReadoutInfo(
  candle: Candlestick | null,
  extras?: { oi?: number | null; cvd?: number | null }
): ReadoutInfo | null {
  if (!candle) return null;

  const change = candle.close - candle.open;
  const changePercent = candle.open !== 0 ? (change / candle.open) * 100 : 0;
  const isUp = change >= 0;

  const formattedChange = `${isUp ? '+' : ''}${formatPrice(change)} (${isUp ? '+' : ''}${changePercent.toFixed(
    2
  )}%)`;

  return {
    candle,
    priceChange: change,
    priceChangePercent: changePercent,
    formattedOpen: formatPrice(candle.open),
    formattedHigh: formatPrice(candle.high),
    formattedLow: formatPrice(candle.low),
    formattedClose: formatPrice(candle.close),
    formattedVolume: formatVolume(candle.volume),
    formattedChange,
    formattedOi:
      extras?.oi == null || !Number.isFinite(extras.oi)
        ? null
        : formatVolume(extras.oi),
    formattedCvd:
      extras?.cvd == null || !Number.isFinite(extras.cvd)
        ? null
        : formatVolume(extras.cvd),
    isUp,
  };
}

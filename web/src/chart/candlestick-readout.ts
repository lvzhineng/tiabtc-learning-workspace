import type { Candlestick } from '@/domain/candle';
import { candlePricePrecision, formatPrice } from './chart-price';

export { formatPrice };

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
  isUp: boolean;
};

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

export function computeReadoutInfo(
  candle: Candlestick | null,
  precision?: number
): ReadoutInfo | null {
  if (!candle) return null;

  const digits = precision ?? candlePricePrecision([candle]);
  const change = candle.close - candle.open;
  const changePercent = candle.open !== 0 ? (change / candle.open) * 100 : 0;
  const isUp = change >= 0;

  const formattedChange = `${isUp ? '+' : ''}${formatPrice(change, digits)} (${isUp ? '+' : ''}${changePercent.toFixed(
    2
  )}%)`;

  return {
    candle,
    priceChange: change,
    priceChangePercent: changePercent,
    formattedOpen: formatPrice(candle.open, digits),
    formattedHigh: formatPrice(candle.high, digits),
    formattedLow: formatPrice(candle.low, digits),
    formattedClose: formatPrice(candle.close, digits),
    formattedVolume: formatVolume(candle.volume),
    formattedChange,
    isUp,
  };
}

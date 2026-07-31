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
  isUp: boolean;
};

export function formatPrice(value: number): string {
  if (value >= 1000) {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (value >= 1) {
    return value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }
  return value.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 8 });
}

export function formatVolume(volume: number): string {
  if (volume >= 1_000_000) {
    return `${(volume / 1_000_000).toFixed(2)}M`;
  }
  if (volume >= 1_000) {
    return `${(volume / 1_000).toFixed(2)}K`;
  }
  return volume.toFixed(2);
}

export function computeReadoutInfo(candle: Candlestick | null): ReadoutInfo | null {
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
    isUp,
  };
}

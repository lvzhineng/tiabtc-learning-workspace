import type { PriceFormatCustom } from 'lightweight-charts';
import type { Candlestick } from '@/domain/candle';

export const MIN_PRICE_PRECISION = 2;
export const MAX_PRICE_PRECISION = 8;
const SIGNIFICANT_DIGITS = 4;

function decimalPlacesFromText(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  const [coefficient, exponentText] = Math.abs(value)
    .toString()
    .toLowerCase()
    .split('e');
  const fractionLength = coefficient.split('.')[1]?.length ?? 0;
  const exponent = exponentText ? Number(exponentText) : 0;
  return Math.max(0, fractionLength - exponent);
}

function decimalPlacesFromMagnitude(value: number): number {
  const abs = Math.abs(value);
  if (!Number.isFinite(abs) || abs === 0) return 0;
  const exponent = Math.floor(Math.log10(abs));
  return Math.max(0, SIGNIFICANT_DIGITS - exponent);
}

function neededPrecision(value: number): number {
  return Math.min(
    MAX_PRICE_PRECISION,
    Math.max(decimalPlacesFromText(value), decimalPlacesFromMagnitude(value))
  );
}

export function pricePrecision(
  values: Iterable<number | null | undefined>
): number {
  let precision = MIN_PRICE_PRECISION;
  for (const value of values) {
    if (value == null || !Number.isFinite(value) || value === 0) continue;
    precision = Math.max(precision, neededPrecision(value));
    if (precision >= MAX_PRICE_PRECISION) return MAX_PRICE_PRECISION;
  }
  return precision;
}

export function candlePricePrecision(candles: Candlestick[]): number {
  return pricePrecision(
    candles.flatMap((candle) => [
      candle.open,
      candle.high,
      candle.low,
      candle.close,
    ])
  );
}

export function formatPrice(
  value: number | null | undefined,
  precision = pricePrecision([value])
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  let digits = Math.min(
    MAX_PRICE_PRECISION,
    Math.max(0, Math.round(precision))
  );
  while (
    digits < MAX_PRICE_PRECISION &&
    value !== 0 &&
    Number(value.toFixed(digits)) === 0
  ) {
    digits += 1;
  }
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function candlePriceFormat(candles: Candlestick[]): PriceFormatCustom {
  const precision = candlePricePrecision(candles);
  const minMove = Number((10 ** -precision).toFixed(precision));
  return {
    type: 'custom',
    minMove,
    formatter: (price) => formatPrice(price, precision),
  };
}

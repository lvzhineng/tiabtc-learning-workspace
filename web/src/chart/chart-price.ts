import type { PriceFormatCustom } from 'lightweight-charts';
import type { Candlestick } from '@/domain/candle';

export const MIN_PRICE_PRECISION = 2;
export const MAX_PRICE_PRECISION = 8;
const SIGNIFICANT_DIGITS = 4;
const OUTLIER_RATIO = 100;

function decimalPlacesFromText(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  const text = Math.abs(value)
    .toFixed(MAX_PRICE_PRECISION)
    .replace(/\.?0+$/, '');
  return text.split('.')[1]?.length ?? 0;
}

function decimalPlacesFromMagnitude(value: number): number {
  const abs = Math.abs(value);
  if (!Number.isFinite(abs) || abs === 0) return 0;
  const exponent = Math.floor(Math.log10(abs));
  return Math.max(0, SIGNIFICANT_DIGITS - exponent);
}

function magnitudeDecimalCap(typicalAbs: number): number {
  if (typicalAbs >= 100) return 2;
  if (typicalAbs >= 1) return 4;
  if (typicalAbs >= 0.01) return 6;
  return MAX_PRICE_PRECISION;
}

function neededPrecision(value: number, cap: number): number {
  return Math.min(
    cap,
    Math.max(decimalPlacesFromText(value), decimalPlacesFromMagnitude(value))
  );
}

function typicalAbs(values: number[]): number {
  const len = values.length;
  if (len <= 64) {
    const sorted = values.map(Math.abs).sort((left, right) => left - right);
    return sorted[Math.floor(len / 2)];
  }
  const step = Math.floor(len / 33);
  const sampled: number[] = [];
  for (let index = 0; index < len && sampled.length < 33; index += step) {
    sampled.push(Math.abs(values[index]));
  }
  sampled.sort((left, right) => left - right);
  return sampled[Math.floor(sampled.length / 2)];
}

export function* candlePrices(candles: Candlestick[]): Generator<number> {
  for (const candle of candles) {
    yield candle.open;
    yield candle.high;
    yield candle.low;
    yield candle.close;
  }
}

export function pricePrecision(
  values: Iterable<number | null | undefined>
): number {
  const finite: number[] = [];
  for (const value of values) {
    if (value == null || !Number.isFinite(value) || value === 0) continue;
    finite.push(value);
  }
  if (!finite.length) return MIN_PRICE_PRECISION;

  const typical = typicalAbs(finite);
  const cap = magnitudeDecimalCap(typical);
  let precision = Math.min(MIN_PRICE_PRECISION, cap);

  for (const value of finite) {
    const ratio = Math.abs(value) / typical;
    if (ratio < 1 / OUTLIER_RATIO || ratio > OUTLIER_RATIO) continue;
    precision = Math.max(precision, neededPrecision(value, cap));
    if (precision >= cap) return cap;
  }
  return precision;
}

export function candlePricePrecision(candles: Candlestick[]): number {
  return pricePrecision(candlePrices(candles));
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

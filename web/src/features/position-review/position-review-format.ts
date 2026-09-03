import type { Candlestick } from '@/domain/candle';
import type { PositionFillKind, ReviewPosition } from './position-review-types';

export const FILL_KIND_LABEL: Record<PositionFillKind, string> = {
  open: '开',
  scaleIn: '加',
  reduce: '减',
  close: '平',
};

export {
  formatLeverage,
  formatShanghaiTime,
  formatShanghaiTimeShort,
  formatNumber,
  formatHoldingDuration,
  formatRoi,
} from '@/domain/formatters';

export function calculatePositionRoi(position: ReviewPosition): number | null {
  const { entryPrice, exitPrice, side, leverage, netPnl, realizedPnl, contracts } =
    position;
  const pnl = netPnl ?? realizedPnl;
  if (entryPrice && exitPrice && entryPrice > 0) {
    const lev = leverage && leverage > 0 ? leverage : 1;
    const priceChange = (exitPrice - entryPrice) / entryPrice;
    return (side === 'long' ? priceChange : -priceChange) * lev * 100;
  }
  if (pnl != null && entryPrice && contracts && contracts > 0 && entryPrice > 0) {
    const lev = leverage && leverage > 0 ? leverage : 1;
    const initialMargin = (entryPrice * contracts) / lev;
    if (initialMargin > 0) {
      return (pnl / initialMargin) * 100;
    }
  }
  return null;
}

export function mergeCandles(
  current: Candlestick[],
  incoming: Candlestick[]
): Candlestick[] {
  if (!incoming.length) return current;
  if (!current.length) return incoming;
  if (incoming[incoming.length - 1].timestampMs < current[0].timestampMs) {
    return [...incoming, ...current];
  }
  if (incoming[0].timestampMs > current[current.length - 1].timestampMs) {
    return [...current, ...incoming];
  }
  const merged = new Map(current.map((candle) => [candle.timestampMs, candle]));
  let changed = false;
  for (const candle of incoming) {
    const existing = merged.get(candle.timestampMs);
    if (
      !existing ||
      existing.open !== candle.open ||
      existing.high !== candle.high ||
      existing.low !== candle.low ||
      existing.close !== candle.close ||
      existing.volume !== candle.volume
    ) {
      changed = true;
    }
    merged.set(candle.timestampMs, candle);
  }
  if (!changed) return current;
  return [...merged.values()].sort(
    (left, right) => left.timestampMs - right.timestampMs
  );
}

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
  const pnl = position.netPnl ?? position.realizedPnl;
  const { entryPrice, contracts, leverage } = position;
  if (pnl == null || !Number.isFinite(pnl)) return null;
  if (entryPrice == null || !(entryPrice > 0)) return null;
  if (contracts == null || !(contracts > 0)) return null;
  const lev = leverage != null && leverage > 0 ? leverage : 1;
  const initialMargin = (entryPrice * contracts) / lev;
  if (!(initialMargin > 0) || !Number.isFinite(initialMargin)) return null;
  return (pnl / initialMargin) * 100;
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

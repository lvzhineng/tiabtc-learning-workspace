import type { Candlestick } from '@/domain/candle';
import type { PositionFillKind, ReviewPosition } from './position-review-types';

export const FILL_KIND_LABEL: Record<PositionFillKind, string> = {
  open: '开',
  scaleIn: '加',
  reduce: '减',
  close: '平',
};

export function formatLeverage(leverage: number | null | undefined): string {
  if (leverage == null || Number.isNaN(leverage) || leverage <= 0) return '杠杆未知';
  return `${Math.round(leverage)}x`;
}

export function formatShanghaiTime(timestampMs: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(timestampMs))
    .replace(/\//g, '-');
}

export function formatShanghaiTimeShort(timestampMs: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(timestampMs))
    .replace(/\//g, '-');
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatHoldingDuration(
  entryTimeMs: number,
  exitTimeMs: number | null
): string {
  const endMs = exitTimeMs || Date.now();
  const diffMs = Math.max(0, endMs - entryTimeMs);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return '< 1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

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

export function formatRoi(roi: number | null | undefined): string {
  if (roi == null || Number.isNaN(roi)) return '—';
  const prefix = roi > 0 ? '+' : '';
  return `${prefix}${roi.toFixed(2)}%`;
}

export function mergeCandles(
  current: Candlestick[],
  incoming: Candlestick[]
): Candlestick[] {
  if (!incoming.length) return current;
  if (!current.length) return incoming;
  const merged = new Map(current.map((candle) => [candle.timestampMs, candle]));
  for (const candle of incoming) {
    merged.set(candle.timestampMs, candle);
  }
  return [...merged.values()].sort(
    (left, right) => left.timestampMs - right.timestampMs
  );
}

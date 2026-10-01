import { formatChartTime } from '@/chart/chart-time';
import type { BitlangTrade } from './bitlang-types';

export function bybitSymbol(instrument: string): string {
  return instrument.replace(/-USDT-SWAP$/i, 'USDT').replace(/-/g, '').toUpperCase();
}

export function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatNumber(value * 100)}%`;
}

export function formatHoldingMinutes(minutes: number): string {
  const roundedMinutes = Math.round(minutes);
  if (roundedMinutes < 1) return '< 1m';
  if (roundedMinutes < 60) return `${roundedMinutes}m`;
  const hours = Math.floor(roundedMinutes / 60);
  const remMinutes = roundedMinutes % 60;
  if (hours < 24) {
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function formatTradeTime(value: string): string {
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs)
    ? formatChartTime(timestampMs).slice(0, 16)
    : '--';
}

export function tradeEntryMs(trade: BitlangTrade): number {
  return Date.parse(trade.entryTime);
}

export function tradeExitMs(trade: BitlangTrade): number {
  return Date.parse(trade.exitTime);
}

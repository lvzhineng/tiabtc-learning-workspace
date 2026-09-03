/**
 * 统一的基础格式化工具模块
 * 提供时间、数字、金额、持仓时长与收益率的标准格式化方法。
 */

export { formatPrice } from '@/chart/chart-price';

/**
 * 格式化北京时间 YYYY-MM-DD HH:mm
 */
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

/**
 * 格式化短北京时间 MM-DD HH:mm
 */
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

/**
 * 格式化北京日期 YYYY-MM-DD
 */
export function formatShanghaiDate(timestampMs: number): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestampMs));
  const y = parts.find((p) => p.type === 'year')?.value || '1970';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

/**
 * 通用千分位浮点数格式化
 */
export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * 格式化杠杆倍数
 */
export function formatLeverage(leverage: number | null | undefined): string {
  if (leverage == null || Number.isNaN(leverage) || leverage <= 0) return '杠杆未知';
  return `${Math.round(leverage)}x`;
}

/**
 * 格式化持仓持续时间
 */
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

/**
 * 格式化收益率百分比
 */
export function formatRoi(roi: number | null | undefined): string {
  if (roi == null || Number.isNaN(roi)) return '—';
  const prefix = roi > 0 ? '+' : '';
  return `${prefix}${roi.toFixed(2)}%`;
}

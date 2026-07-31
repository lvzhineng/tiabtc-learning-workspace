import type { Time, UTCTimestamp } from 'lightweight-charts';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { TIMEFRAME_SECONDS_MAP } from '@/domain/timeframe';

export function timestampMsToUtcTimestamp(timestampMs: number): UTCTimestamp {
  return Math.floor(timestampMs / 1000) as UTCTimestamp;
}

export function utcTimestampToTimestampMs(time: Time): number {
  if (typeof time === 'number') {
    return time * 1000;
  }
  if (typeof time === 'string') {
    return Date.parse(`${time}T00:00:00+08:00`);
  }
  const monthStr = String(time.month).padStart(2, '0');
  const dayStr = String(time.day).padStart(2, '0');
  return Date.parse(`${time.year}-${monthStr}-${dayStr}T00:00:00+08:00`);
}

export function parseVideoPublishedTimeMs(dateStr: string, timeStr?: string): number {
  const cleanDate = dateStr.trim();
  if (!cleanDate) return Date.now();

  const cleanTime = timeStr ? timeStr.trim() : '';

  if (cleanTime) {
    // If timezone offset (e.g. -07:00, +08:00, Z) is included
    if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(cleanTime)) {
      const parsed = Date.parse(`${cleanDate}T${cleanTime}`);
      if (!Number.isNaN(parsed)) return parsed;
    }

    // If no timezone offset, assume Beijing Time (UTC+8)
    const parsedBeijing = Date.parse(`${cleanDate}T${cleanTime}+08:00`);
    if (!Number.isNaN(parsedBeijing)) return parsedBeijing;
  }

  // Fallback: Midnight Beijing Time
  const defaultParsed = Date.parse(`${cleanDate}T00:00:00+08:00`);
  return !Number.isNaN(defaultParsed) ? defaultParsed : Date.now();
}

export function formatChartTime(
  timestampMs: number,
  _timeframe: ReviewTimeframe
): string {
  const date = new Date(timestampMs);
  const parts = shanghaiParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.weekday}`;
}

export function formatChartTickTime(
  timestampMs: number,
  timeframe: ReviewTimeframe
): string {
  const parts = shanghaiParts(new Date(timestampMs));
  if (timeframe === 'D' || timeframe === 'W') {
    return `${parts.year.slice(2)}-${parts.month}-${parts.day}`;
  }
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function timeframeMs(timeframe: ReviewTimeframe): number {
  return (TIMEFRAME_SECONDS_MAP[timeframe] || 300) * 1000;
}

function shanghaiParts(
  date: Date
): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'weekday', string> {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    weekday: get('weekday'),
  };
}

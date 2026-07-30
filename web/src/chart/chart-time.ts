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

export function formatChartTime(timestampMs: number, timeframe: ReviewTimeframe): string {
  const date = new Date(timestampMs);
  const parts = shanghaiParts(date);

  if (timeframe === 'D') {
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  if (timeframe === 'W') {
    return `${parts.year}-${parts.month}-${parts.day} (周)`;
  }

  if (parts.hour === '00' && parts.minute === '00') {
    return `${parts.month}-${parts.day}`;
  }

  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function timeframeMs(timeframe: ReviewTimeframe): number {
  return (TIMEFRAME_SECONDS_MAP[timeframe] || 300) * 1000;
}

function shanghaiParts(date: Date): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

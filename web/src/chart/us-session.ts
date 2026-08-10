/** US equity regular session in America/New_York (handles DST). */
export const US_SESSION_TIME_ZONE = 'America/New_York';
export const US_SESSION_OPEN = { hour: 9, minute: 30 } as const;
export const US_SESSION_CLOSE = { hour: 16, minute: 0 } as const;

export type UsSessionBand = {
  fromMs: number;
  toMs: number;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
};

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getZonedFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = zonedFormatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  zonedFormatterCache.set(timeZone, formatter);
  return formatter;
}

function getZonedParts(timestampMs: number, timeZone: string): ZonedParts {
  const parts = getZonedFormatter(timeZone).formatToParts(
    new Date(timestampMs)
  );

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '0';

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: get('weekday'),
  };
}

/** Convert a wall-clock time in `timeZone` to a UTC epoch ms. */
export function zonedWallTimeToUtcMs(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): number {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i += 1) {
    const parts = getZonedParts(utcMs, timeZone);
    const asIfUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    const diff = desired - asIfUtc;
    if (diff === 0) break;
    utcMs += diff;
  }
  return utcMs;
}

function isWeekendWeekday(weekday: string): boolean {
  return weekday === 'Sat' || weekday === 'Sun';
}

type UsCalendarDay = {
  openMs: number;
  closeMs: number | null;
};

const usCalendarDayCache = new Map<number, UsCalendarDay>();

function getUsCalendarDay(
  year: number,
  month: number,
  day: number
): UsCalendarDay {
  const cacheKey = year * 10000 + month * 100 + day;
  const cached = usCalendarDayCache.get(cacheKey);
  if (cached) return cached;

  const openMs = zonedWallTimeToUtcMs(
    US_SESSION_TIME_ZONE,
    year,
    month,
    day,
    US_SESSION_OPEN.hour,
    US_SESSION_OPEN.minute
  );
  const weekday = getZonedParts(openMs, US_SESSION_TIME_ZONE).weekday;
  const calendarDay = {
    openMs,
    closeMs: isWeekendWeekday(weekday)
      ? null
      : zonedWallTimeToUtcMs(
          US_SESSION_TIME_ZONE,
          year,
          month,
          day,
          US_SESSION_CLOSE.hour,
          US_SESSION_CLOSE.minute
        ),
  };
  usCalendarDayCache.set(cacheKey, calendarDay);
  return calendarDay;
}

/**
 * List US regular-session bands that overlap `[rangeFromMs, rangeToMs]`.
 * Weekends are skipped; exchange holidays are still marked for this preview.
 */
export function listUsRegularSessions(
  rangeFromMs: number,
  rangeToMs: number
): UsSessionBand[] {
  if (!(rangeToMs > rangeFromMs)) return [];

  const startParts = getZonedParts(rangeFromMs - 36 * 60 * 60 * 1000, US_SESSION_TIME_ZONE);
  let year = startParts.year;
  let month = startParts.month;
  let day = startParts.day;

  const bands: UsSessionBand[] = [];
  const hardStop = rangeToMs + 36 * 60 * 60 * 1000;

  for (let guard = 0; guard < 4000; guard += 1) {
    const { openMs, closeMs } = getUsCalendarDay(year, month, day);
    if (openMs > hardStop) break;

    if (closeMs !== null) {
      if (closeMs >= rangeFromMs && openMs <= rangeToMs) {
        bands.push({
          fromMs: Math.max(openMs, rangeFromMs),
          toMs: Math.min(closeMs, rangeToMs),
        });
      }
    }

    const next = new Date(Date.UTC(year, month - 1, day + 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }

  return bands;
}

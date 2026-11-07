import {
  US_SESSION_CLOSE,
  US_SESSION_OPEN,
  US_SESSION_TIME_ZONE,
  zonedWallTimeToUtcMs,
} from '../../chart/us-session';

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

const MIN_SUPPORTED_YEAR = 2012;
const SPECIAL_MARKET_CLOSURES = new Set([
  '2012-10-29', // Hurricane Sandy
  '2012-10-30', // Hurricane Sandy
  '2018-12-05', // President George H. W. Bush national day of mourning
  '2025-01-09', // President Jimmy Carter national day of mourning
]);

function dateKey(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(
    date.day
  ).padStart(2, '0')}`;
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function weekday(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function isWeekday(date: CalendarDate): boolean {
  const day = weekday(date);
  return day >= 1 && day <= 5;
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekdayNumber: number,
  occurrence: number
): CalendarDate {
  const first = { year, month, day: 1 };
  const offset = (weekdayNumber - weekday(first) + 7) % 7;
  return { year, month, day: 1 + offset + (occurrence - 1) * 7 };
}

function lastWeekdayOfMonth(
  year: number,
  month: number,
  weekdayNumber: number
): CalendarDate {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = { year, month, day: lastDay };
  const offset = (weekday(last) - weekdayNumber + 7) % 7;
  return { year, month, day: lastDay - offset };
}

function observedFixedHoliday(
  year: number,
  month: number,
  day: number
): CalendarDate {
  const date = { year, month, day };
  const dayOfWeek = weekday(date);
  if (dayOfWeek === 6) return addDays(date, -1);
  if (dayOfWeek === 0) return addDays(date, 1);
  return date;
}

/** NYSE/Nasdaq do not observe New Year's Day on the preceding Friday when it falls on Saturday. */
function observedNewYear(year: number): CalendarDate | null {
  const newYear = { year, month: 1, day: 1 };
  const dayOfWeek = weekday(newYear);
  if (dayOfWeek === 6) return null;
  if (dayOfWeek === 0) return addDays(newYear, 1);
  return newYear;
}

function easterSunday(year: number): CalendarDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const value = h + l - 7 * m + 114;
  return {
    year,
    month: Math.floor(value / 31),
    day: (value % 31) + 1,
  };
}

function getHolidayDates(year: number): Set<string> {
  const holidays = new Set<string>();
  const add = (date: CalendarDate | null) => {
    if (date) holidays.add(dateKey(date));
  };

  add(observedNewYear(year));
  add(nthWeekdayOfMonth(year, 1, 1, 3)); // Martin Luther King Jr. Day
  add(nthWeekdayOfMonth(year, 2, 1, 3)); // Washington's Birthday
  add(addDays(easterSunday(year), -2)); // Good Friday
  add(lastWeekdayOfMonth(year, 5, 1)); // Memorial Day
  if (year >= 2022) add(observedFixedHoliday(year, 6, 19)); // Juneteenth
  add(observedFixedHoliday(year, 7, 4)); // Independence Day
  add(nthWeekdayOfMonth(year, 9, 1, 1)); // Labor Day
  add(nthWeekdayOfMonth(year, 11, 4, 4)); // Thanksgiving
  add(observedFixedHoliday(year, 12, 25)); // Christmas Day

  for (const closure of SPECIAL_MARKET_CLOSURES) {
    if (closure.startsWith(`${year}-`)) holidays.add(closure);
  }

  return holidays;
}

function parseCalendarDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < MIN_SUPPORTED_YEAR ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function getEarlyCloseDates(year: number, holidays: Set<string>): Set<string> {
  const earlyCloseDates = new Set<string>();
  const postThanksgiving = addDays(
    nthWeekdayOfMonth(year, 11, 4, 4),
    1
  );
  if (isWeekday(postThanksgiving) && !holidays.has(dateKey(postThanksgiving))) {
    earlyCloseDates.add(dateKey(postThanksgiving));
  }

  const christmasEve = { year, month: 12, day: 24 };
  if (isWeekday(christmasEve) && !holidays.has(dateKey(christmasEve))) {
    earlyCloseDates.add(dateKey(christmasEve));
  }

  // NYSE designates July 3 itself; do not shift the early close when it is a weekend.
  const independenceDayEve = { year, month: 7, day: 3 };
  if (
    isWeekday(independenceDayEve) &&
    !holidays.has(dateKey(independenceDayEve))
  ) {
    earlyCloseDates.add(dateKey(independenceDayEve));
  }
  return earlyCloseDates;
}

/**
 * Return the regular US equity session for a complete trading day.
 * Dates before 2012, weekends, exchange holidays, and known special closures return null.
 */
export function getFullUsEquitySession(
  date: string
): { fromMs: number; toMs: number } | null {
  const session = getUsEquitySession(date);
  return session && session.toMs - session.fromMs === 390 * 60_000 ? session : null;
}

/** Regular-session history also includes the preceding day's shortened session. */
export function getUsEquitySession(
  date: string
): { fromMs: number; toMs: number } | null {
  const calendarDate = parseCalendarDate(date);
  if (!calendarDate || !isWeekday(calendarDate)) return null;

  const holidays = getHolidayDates(calendarDate.year);
  const key = dateKey(calendarDate);
  if (holidays.has(key)) return null;

  const earlyCloseDates = getEarlyCloseDates(calendarDate.year, holidays);
  const closeHour = earlyCloseDates.has(key) ? 13 : US_SESSION_CLOSE.hour;

  return {
    fromMs: zonedWallTimeToUtcMs(
      US_SESSION_TIME_ZONE,
      calendarDate.year,
      calendarDate.month,
      calendarDate.day,
      US_SESSION_OPEN.hour,
      US_SESSION_OPEN.minute
    ),
    toMs: zonedWallTimeToUtcMs(
      US_SESSION_TIME_ZONE,
      calendarDate.year,
      calendarDate.month,
      calendarDate.day,
      closeHour,
      US_SESSION_CLOSE.minute
    ),
  };
}

/** Calendar lookup only; never probes Gate or substitutes an older day for missing data. */
export function getPreviousUsEquitySession(date: string): { date: string; fromMs: number; toMs: number } | null {
  const current = parseCalendarDate(date);
  if (!current) return null;
  for (let offset = 1; offset <= 14; offset += 1) {
    const previous = dateKey(addDays(current, -offset));
    const session = getUsEquitySession(previous);
    if (session) return { date: previous, ...session };
  }
  return null;
}

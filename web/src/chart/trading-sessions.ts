import { listUsRegularSessions, zonedWallTimeToUtcMs, type UsSessionBand } from './us-session';

export type TradingSession = 'asia' | 'europe' | 'america';
export const TRADING_SESSIONS: readonly TradingSession[] = ['asia', 'europe', 'america'];
export const SESSION_DETAILS = {
  asia: { name: '亚盘', city: '东京', zone: 'Asia/Tokyo', color: '#2dd4bf', hours: '08:00–10:30 / 11:30–14:30' },
  europe: { name: '欧盘', city: '伦敦', zone: 'Europe/London', color: '#a78bfa', hours: '夏 15:00–23:30 / 冬 16:00–次日00:30' },
  america: { name: '美盘', city: '纽约', zone: 'America/New_York', color: '#60a5fa', hours: '夏 21:30–次日04:00 / 冬 22:30–次日05:00' },
} as const;

/** Migrate the previous US-only preference, including safe handling of invalid storage. */
export function storedTradingSessions(stored: Record<string, unknown>): TradingSession[] {
  if (Array.isArray(stored.sessionBands)) {
    return TRADING_SESSIONS.filter((session) => (stored.sessionBands as unknown[]).includes(session));
  }
  return stored.showUsSessionBands === true ? ['america'] : [];
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const days = new Map<string, UsSessionBand[]>();

/** Weekday reference sessions; holidays/early closes are not an exchange calendar. */
export function listTradingSessions(session: TradingSession, fromMs: number, toMs: number): UsSessionBand[] {
  if (!(toMs > fromMs)) return [];
  if (session === 'america') return listUsRegularSessions(fromMs, toMs);
  const zone = SESSION_DETAILS[session].zone;
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(zone, formatter);
  }
  const parts = formatter.formatToParts(new Date(fromMs - 36 * 3_600_000));
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  let date = new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
  const bands: UsSessionBand[] = [];
  for (let guard = 0; guard < 4000 && date.getTime() <= toMs + 36 * 3_600_000; guard += 1) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      const key = `${session}:${date.getTime()}`;
      let dayBands = days.get(key);
      if (!dayBands) {
        const at = (hour: number, minute: number) => zonedWallTimeToUtcMs(zone, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute);
        // Tokyo's afternoon close extended from 15:00 to 15:30 on 2024-11-05.
        dayBands = session === 'asia'
          ? [{ fromMs: at(9, 0), toMs: at(11, 30) }, { fromMs: at(12, 30), toMs: at(15, date.getTime() >= Date.UTC(2024, 10, 5) ? 30 : 0) }]
          : [{ fromMs: at(8, 0), toMs: at(16, 30) }];
        days.set(key, dayBands);
        if (days.size > 6000) days.delete(days.keys().next().value!);
      }
      for (const band of dayBands) {
        if (band.toMs > fromMs && band.fromMs < toMs) bands.push({ fromMs: Math.max(fromMs, band.fromMs), toMs: Math.min(toMs, band.toMs) });
      }
    }
    date = new Date(date.getTime() + 86_400_000);
  }
  return bands;
}

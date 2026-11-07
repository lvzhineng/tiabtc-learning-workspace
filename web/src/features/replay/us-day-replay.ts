import * as cfdApi from '@/api/cfd-api';
import { fetchChartConfig } from '@/api/market-api';
import { isCompleteMinuteSession, type Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { timeframeMs } from '@/chart/chart-time';
import { getFullUsEquitySession } from './us-equity-session';

export type UsDayReplay = { date: string; fromMs: number; toMs: number };
export type UsDayLookback = '1' | '3' | 'all';
export const US_DAY_TIMEFRAMES: readonly ReviewTimeframe[] = ['1', '5', '15'];
export const supportsUsDayReplay = (symbol: string) => symbol === 'NAS100' || symbol === 'US500';
const candidateCache = new Map<string, UsDayReplay[]>();
const incompleteDays = new Map<string, number>();
// Match the workspace's minimum supported replay timestamp. This is a date
// sampling bound, not a claim about Gate's actual historical coverage.
const EARLIEST_REPLAY_TIMESTAMP_MS = 1_500_000_000_000;

/** Session buckets start at 09:30; inputs contain only the selected day's minutes. */
export function aggregateUsSession(candles: Candlestick[], timeframe: ReviewTimeframe): Candlestick[] {
  if (!US_DAY_TIMEFRAMES.includes(timeframe)) return [];
  const size = timeframeMs(timeframe) / 60_000;
  const result: Candlestick[] = [];
  for (let index = 0; index + size <= candles.length; index += size) {
    const rows = candles.slice(index, index + size);
    result.push({ ...rows[0], interval: timeframe,
      high: Math.max(...rows.map((bar) => bar.high)),
      low: Math.min(...rows.map((bar) => bar.low)),
      close: rows[rows.length - 1].close, volume: 0 });
  }
  return result;
}

export async function pickRandomUsDay(
  symbol: string, signal: AbortSignal, lookback: UsDayLookback = '1',
  onProgress: (message: string) => void = () => {}, attemptLimit = 10
): Promise<UsDayReplay> {
  if (!supportsUsDayReplay(symbol)) throw new Error('美股单日复盘仅支持纳斯达克100和标普500');
  const config = await fetchChartConfig();
  signal.throwIfAborted();
  if (config.offlineMode) throw new Error('请恢复在线模式后抽取美股交易日');
  const dayMs = 86_400_000;
  const now = Date.now();
  const cacheKey = `${symbol}:${lookback}:${Math.floor(now / dayMs)}`;
  let available = candidateCache.get(cacheKey);
  if (!available) {
    const from = new Date(now);
    if (lookback !== 'all') from.setUTCFullYear(from.getUTCFullYear() - Number(lookback));
    const earliest = lookback === 'all' ? EARLIEST_REPLAY_TIMESTAMP_MS : from.getTime();
    // All ranges sample calendar dates locally. Only the selected day's
    // minutes are requested; source boundaries are never scanned first.
    available = [];
    for (let stamp = Math.floor(earliest / dayMs) * dayMs; stamp < now; stamp += dayMs) {
      const date = new Date(stamp).toISOString().slice(0, 10);
      const session = getFullUsEquitySession(date);
      if (session && session.toMs <= now) available.push({ date, ...session });
    }
    if (candidateCache.size >= 12) candidateCache.delete(candidateCache.keys().next().value!);
    candidateCache.set(cacheKey, available);
  }
  const candidates = available.filter((session) =>
    (incompleteDays.get(`${symbol}:${session.date}`) ?? 0) < now);
  let attempts = 0;
  while (candidates.length && attempts < attemptLimit) {
    signal.throwIfAborted();
    const [session] = candidates.splice(Math.floor(Math.random() * candidates.length), 1);
    onProgress(`正在校验 ${session.date}（第${++attempts}个交易日）…`);
    const batch = await cfdApi.fetchUsSessionCandles(symbol, session.fromMs, session.toMs, signal);
    signal.throwIfAborted();
    if (batch.warning) throw new Error(`无法校验交易日行情：${batch.warning}`);
    if (isCompleteMinuteSession(batch.candles, session)) return session;
    // Missing source history is common; do not keep requesting the same empty
    // minute windows on every draw. Retry later in case the source repairs them.
    incompleteDays.set(`${symbol}:${session.date}`, Date.now() + 10 * 60_000);
    if (incompleteDays.size > 3000) incompleteDays.delete(incompleteDays.keys().next().value!);
  }
  throw new Error(`已尝试${attempts}个交易日，暂未取得完整分钟行情；请缩小范围或重试`);
}

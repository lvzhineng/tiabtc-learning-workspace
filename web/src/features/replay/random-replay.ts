import * as marketApi from '@/api/market-api';
import * as cfdApi from '@/api/cfd-api';
import type { Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { timeframeMs } from '@/chart/chart-time';

const DAY_MS = 86_400_000;
const EARLIEST_REPLAY_MS = 1_500_000_000_000;
const MAX_DAY_ATTEMPTS = 10;

// Sample dates locally, then inspect only that day's closed bars. A bounded
// retry handles weekends and missing source history without discovering it all.
export async function pickRandomReplayTime(
  market: 'perpetual' | 'cfd',
  symbol: string,
  timeframe: ReviewTimeframe,
  signal: AbortSignal
): Promise<{ cursorTimeMs: number }> {
  signal.throwIfAborted();
  const config = await marketApi.fetchChartConfig();
  signal.throwIfAborted();
  if (config.offlineMode) {
    throw new Error('当前为仅本地模式，请恢复在线模式后随机复盘');
  }
  const api = market === 'cfd' ? cfdApi : marketApi;
  const now = Date.now();
  const dailyBefore = Math.floor(now / DAY_MS) * DAY_MS;
  const stepMs = timeframeMs(timeframe);

  const readRange = async (interval: ReviewTimeframe, from: number, before: number) => {
    const rows = new Map<number, Candlestick>();
    const intervalMs = timeframeMs(interval);
    while (before > from) {
      signal.throwIfAborted();
      const count = Math.min(1000, Math.max(100, Math.ceil((before - from) / intervalMs)));
      const batch = await api.fetchEarlierCandles(symbol, interval, before, count, signal);
      signal.throwIfAborted();
      if (batch.warning) throw new Error(`无法读取所抽日期的行情，请重试：${batch.warning}`);
      const past = batch.candles.filter((bar) => bar.timestampMs < before);
      if (past.length === 0) break;
      for (const bar of past) {
        if (bar.timestampMs >= from) rows.set(bar.timestampMs, bar);
      }
      before = Math.min(...past.map((bar) => bar.timestampMs));
    }
    return [...rows.values()].sort((a, b) => a.timestampMs - b.timestampMs);
  };

  const candidates: number[] = [];
  for (let day = Math.ceil(EARLIEST_REPLAY_MS / DAY_MS) * DAY_MS; day < dailyBefore; day += DAY_MS) {
    candidates.push(day);
  }
  let attempts = 0;
  while (candidates.length > 0 && attempts++ < MAX_DAY_ATTEMPTS) {
    signal.throwIfAborted();
    const index = Math.floor(Math.random() * candidates.length);
    const [day] = candidates.splice(index, 1);
    const start = Math.max(EARLIEST_REPLAY_MS, day - (stepMs > DAY_MS ? stepMs : 0));
    const bars = await readRange(timeframe, start, day + DAY_MS);
    const eligible = bars.filter((bar) =>
      bar.timestampMs >= start && bar.timestampMs + stepMs <= now
    );
    if (eligible.length > 0) {
      const bar = stepMs > DAY_MS
        ? eligible[eligible.length - 1]
        : eligible[Math.floor(Math.random() * eligible.length)];
      return { cursorTimeMs: bar.timestampMs + stepMs };
    }
  }
  throw new Error('已尝试10个日期，暂未取得可用行情；请重试或切换品种、周期');
}

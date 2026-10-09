import * as marketApi from '@/api/market-api';
import * as cfdApi from '@/api/cfd-api';
import type { Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { timeframeMs } from '@/chart/chart-time';

const DAY_MS = 86_400_000;
// Lower bound accepted by the existing earlier-candle API, not a lookback
// preference. Scan until the source returns no earlier history.
const EARLIER_API_MIN_TIME_MS = 1_000_000_000_000;

// Discover actual trading days first, then select a bar in that day. This
// avoids sampling weekends or dates before a contract was listed, without
// downloading years of minute bars. Daily discovery has no lookback or page
// count cap; each request respects the API's 100–1000 bar limit.
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
    throw new Error('当前为仅本地模式，无法确认该品种的全部历史，请恢复在线模式后随机复盘');
  }
  const api = market === 'cfd' ? cfdApi : marketApi;
  const now = Date.now();
  // Closed daily windows use a stable key so another random draw can reuse
  // the existing request cache rather than download/parse the same history.
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
      // A failed or incomplete scan must not silently turn "all history" into
      // a random draw from just the latest cached pages.
      if (batch.warning) throw new Error(`无法确认完整历史行情，请重试：${batch.warning}`);
      const past = batch.candles.filter((bar) => bar.timestampMs < before);
      if (past.length === 0) break;
      for (const bar of past) {
        if (bar.timestampMs >= from) rows.set(bar.timestampMs, bar);
      }
      before = Math.min(...past.map((bar) => bar.timestampMs));
    }
    return [...rows.values()].sort((a, b) => a.timestampMs - b.timestampMs);
  };

  const daily = await readRange('D', EARLIER_API_MIN_TIME_MS, dailyBefore);
  const fromMs = daily[0]?.timestampMs ?? dailyBefore;
  const candidates = daily.filter((bar) => bar.timestampMs + DAY_MS <= now);
  // An incomplete lower-timeframe history may differ from daily history.
  // Sample without replacement until a real bar is found, including history
  // beyond any former 90-day / one-year / three-year window.
  while (candidates.length > 0) {
    const index = Math.floor(Math.random() * candidates.length);
    const [day] = candidates.splice(index, 1);
    if (timeframe === 'D') {
      return { cursorTimeMs: day.timestampMs + stepMs };
    }
    const start = Math.max(fromMs, day.timestampMs - (stepMs > DAY_MS ? stepMs : 0));
    const bars = await readRange(timeframe, start, day.timestampMs + DAY_MS);
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
  throw new Error('该品种当前周期没有可用于随机复盘的历史 K 线，请切换周期后重试');
}

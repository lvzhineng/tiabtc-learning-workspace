import { useEffect, useRef, useState } from 'react';
import * as marketApi from '@/api/market-api';
import * as cfdApi from '@/api/cfd-api';
import type { Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { timeframeMs } from '@/chart/chart-time';
import {
  aggregateReplayCandle,
  replayCandleSegments,
} from '@/features/replay/replay-partial-candle';

type PartialResult = {
  key: string;
  candle: Candlestick | null;
  warning: string | null;
};

export function useReplayPartialCandle(
  symbol: string,
  timeframe: ReviewTimeframe,
  market: 'perpetual' | 'cfd',
  cursorMs: number | null,
  candles: Candlestick[],
  loading: boolean
) {
  const [result, setResult] = useState<PartialResult | null>(null);
  // Each entry contains at most a handful of coarse bars, not a week of 1m bars.
  const cacheRef = useRef(new Map<string, Candlestick[]>());
  const step = timeframeMs(timeframe);
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (cursorMs !== null && candles[middle].timestampMs <= cursorMs) low = middle + 1;
    else high = middle;
  }
  const candidate = low > 0 ? candles[low - 1] : null;
  // Replay feeds omit bars that have not closed in wall-clock time. Derive
  // that bucket from an actual source bar (also preserving weekly alignment).
  const bucketMs = cursorMs !== null && candidate
    ? candidate.timestampMs + Math.floor((cursorMs - candidate.timestampMs) / step) * step
    : null;
  const startMs = !loading && cursorMs !== null && candidate &&
    candidate.symbol === symbol && candidate.interval === timeframe &&
    bucketMs !== null && bucketMs < cursorMs
    ? bucketMs : null;
  const key = startMs !== null && cursorMs !== null
    ? `${market}:${symbol}:${timeframe}:${startMs}:${cursorMs}` : '';

  useEffect(() => {
    if (startMs === null || cursorMs === null) return;
    const controller = new AbortController();
    const fetchLater = market === 'cfd' ? cfdApi.fetchLaterCandles : marketApi.fetchLaterCandles;
    const segments = replayCandleSegments(startMs, cursorMs, timeframe);
    void (async () => {
      const rows: Candlestick[] = [];
      for (const segment of segments) {
        const cacheKey = `${market}:${symbol}:${segment.interval}:${segment.fromMs}:${segment.toMs}`;
        let bars = cacheRef.current.get(cacheKey);
        if (!bars) {
          // Bybit's cutoff is an inclusive opening timestamp; CFD's cutoff
          // is a completion timestamp. Keep both requests inside elapsed time.
          const cutoffMs = market === 'cfd'
            ? segment.toMs : segment.toMs - timeframeMs(segment.interval);
          const batch = await fetchLater(
            symbol, segment.interval, segment.fromMs - 1, 100,
            cutoffMs, controller.signal
          );
          if (controller.signal.aborted) return;
          if (batch.warning) throw new Error(batch.warning);
          bars = batch.candles.filter((bar) => bar.timestampMs >= segment.fromMs &&
            bar.timestampMs + timeframeMs(segment.interval) <= segment.toMs);
          // Crypto gaps must not be silently presented as a complete aggregation.
          // CFD sessions legitimately contain breaks and empty ranges.
          if (market !== 'cfd') {
            const stepMs = timeframeMs(segment.interval);
            const expected = (segment.toMs - segment.fromMs) / stepMs;
            if (bars.length !== expected || bars.some((bar, index) =>
              bar.timestampMs !== segment.fromMs + index * stepMs)) {
              throw new Error('小周期行情不完整，请稍后重试');
            }
          }
          cacheRef.current.set(cacheKey, bars);
          while (cacheRef.current.size > 64) {
            cacheRef.current.delete(cacheRef.current.keys().next().value!);
          }
        }
        rows.push(...bars);
      }
      if (!controller.signal.aborted) {
        setResult({
          key,
          candle: aggregateReplayCandle(rows, symbol, timeframe, startMs, cursorMs),
          warning: cursorMs % 60_000 !== 0
            ? '未收盘 K 线按已完成的分钟行情展示，暂不模拟分钟内波动。' : null,
        });
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({
        key, candle: null,
        warning: `未收盘 K 线暂不可用：${error instanceof Error ? error.message : '小周期行情加载失败'}`,
      });
    });
    return () => controller.abort();
  }, [cursorMs, key, market, startMs, symbol, timeframe]);

  return {
    candle: key && result?.key === key ? result.candle : null,
    warning: key && result?.key === key ? result.warning : null,
    loading: Boolean(key && result?.key !== key),
  };
}

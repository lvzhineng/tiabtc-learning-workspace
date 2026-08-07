import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchChartCandles,
  fetchEarlierCandles,
  fetchLaterCandles,
  fetchReplayCandles,
} from '@/api/market-api';
import {
  TIMEFRAME_DISPLAY_MAP,
  TIMEFRAME_SECONDS_MAP,
  type ReviewTimeframe,
} from '@/domain/timeframe';
import type { Candlestick } from '@/domain/candle';
import type { ReplayState } from '@/features/replay/replay-state';

type CandleWorkspaceData = {
  candles: Candlestick[];
  loading: boolean;
  isLoadingEarlier: boolean;
  offlineWarning: string | null;
  error: string | null;
  loadEarlier: () => void;
  prefetchFuture: () => Promise<number>;
};

function mergeCandles(
  current: Candlestick[],
  incoming: Candlestick[],
  direction: 'before' | 'after'
): Candlestick[] {
  if (incoming.length === 0) return current;
  const existingTimestamps = new Set(
    current.map((candle) => candle.timestampMs)
  );
  const fresh = incoming.filter(
    (candle) => !existingTimestamps.has(candle.timestampMs)
  );
  if (fresh.length === 0) return current;
  return direction === 'before'
    ? [...fresh, ...current]
    : [...current, ...fresh];
}

export function useCandleWorkspaceData(
  symbol: string,
  timeframe: ReviewTimeframe,
  replayState: ReplayState,
  idleAnchorTimeMs: number | null = null
): CandleWorkspaceData {
  const [candles, setCandles] = useState<Candlestick[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
  const [offlineWarning, setOfflineWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mainRequestRef = useRef<AbortController | null>(null);
  const earlierRequestRef = useRef<AbortController | null>(null);
  const futureRequestControllerRef = useRef<AbortController | null>(null);
  const futurePrefetchRef = useRef<Promise<number> | null>(null);
  const contextKeyRef = useRef('');
  const contextRevisionRef = useRef(0);

  const replayMode =
    replayState.status === 'idle' ? 'live' : replayState.context.mode;
  const replayAnchorTimeMs =
    replayState.status === 'idle' ? 0 : replayState.startTimeMs;
  const chartAnchorTimeMs =
    replayState.status === 'idle' ? idleAnchorTimeMs : null;
  // Idle switch anchors are one-shot fetch hints and must not stay in the
  // context key, otherwise live mode remains pinned to a historical window.
  const contextKey = useMemo(
    () => `${symbol}:${timeframe}:${replayMode}:${replayAnchorTimeMs}`,
    [replayAnchorTimeMs, replayMode, symbol, timeframe]
  );

  useEffect(() => {
    mainRequestRef.current?.abort();
    earlierRequestRef.current?.abort();
    futureRequestControllerRef.current?.abort();
    earlierRequestRef.current = null;
    futureRequestControllerRef.current = null;
    futurePrefetchRef.current = null;

    const contextRevision = ++contextRevisionRef.current;
    const controller = new AbortController();
    mainRequestRef.current = controller;
    contextKeyRef.current = contextKey;
    // Do not briefly render the previous interval's candles under the new
    // interval. That would make the chart retain an unrelated logical range.
    setCandles([]);
    setLoading(true);
    setIsLoadingEarlier(false);
    setError(null);
    setOfflineWarning(null);

    const request =
      replayState.status === 'idle'
        ? fetchChartCandles(
            symbol,
            timeframe,
            chartAnchorTimeMs ?? Math.floor(Date.now() / 60_000) * 60_000,
            controller.signal
          )
        : fetchReplayCandles(
            symbol,
            timeframe,
            replayState.startTimeMs,
            500,
            controller.signal
          );

    void request
      .then((data) => {
        if (
          controller.signal.aborted ||
          contextRevisionRef.current !== contextRevision
        ) {
          return;
        }
        setCandles(data);
        if (data.length === 0) {
          setOfflineWarning(
            `符号 ${symbol} (${TIMEFRAME_DISPLAY_MAP[timeframe]}) 暂无本地缓存数据。`
          );
        }
      })
      .catch((requestError) => {
        if (
          controller.signal.aborted ||
          contextRevisionRef.current !== contextRevision
        ) {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : '加载 K 线数据失败'
        );
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          contextRevisionRef.current === contextRevision
        ) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
      earlierRequestRef.current?.abort();
      futureRequestControllerRef.current?.abort();
    };
  }, [contextKey]);

  const loadEarlier = useCallback(() => {
    if (
      loading ||
      isLoadingEarlier ||
      candles.length === 0 ||
      earlierRequestRef.current
    ) {
      return;
    }

    const controller = new AbortController();
    const requestContextKey = contextKeyRef.current;
    const requestContextRevision = contextRevisionRef.current;
    const earliestTimestamp = candles[0].timestampMs;
    earlierRequestRef.current = controller;
    setIsLoadingEarlier(true);

    void fetchEarlierCandles(
      symbol,
      timeframe,
      earliestTimestamp,
      1000,
      controller.signal
    )
      .then((earlierCandles) => {
        if (
          controller.signal.aborted ||
          contextKeyRef.current !== requestContextKey ||
          contextRevisionRef.current !== requestContextRevision
        ) {
          return;
        }
        setCandles((current) =>
          mergeCandles(current, earlierCandles, 'before')
        );
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          console.warn('扩展加载更早 K 线失败:', requestError);
        }
      })
      .finally(() => {
        if (earlierRequestRef.current === controller) {
          earlierRequestRef.current = null;
          setIsLoadingEarlier(false);
        }
      });
  }, [candles, isLoadingEarlier, loading, symbol, timeframe]);

  const prefetchFuture = useCallback((): Promise<number> => {
    if (candles.length === 0) return Promise.resolve(0);
    if (futurePrefetchRef.current) return futurePrefetchRef.current;

    const latestTimestamp = candles[candles.length - 1].timestampMs;
    const requestContextKey = contextKeyRef.current;
    const requestContextRevision = contextRevisionRef.current;
    const controller = new AbortController();
    futureRequestControllerRef.current = controller;
    const request = fetchLaterCandles(
      symbol,
      timeframe,
      latestTimestamp,
      1000,
      undefined,
      controller.signal
    )
      .then((laterCandles) => {
        if (
          controller.signal.aborted ||
          contextKeyRef.current !== requestContextKey ||
          contextRevisionRef.current !== requestContextRevision
        ) {
          return -1;
        }
        const firstLaterCandle = laterCandles[0];
        const maxAllowedGapMs = TIMEFRAME_SECONDS_MAP[timeframe] * 8_000;
        if (
          firstLaterCandle &&
          firstLaterCandle.timestampMs - latestTimestamp > maxAllowedGapMs
        ) {
          console.warn(
            '拒绝合并与当前回放不连续的后续 K 线:',
            latestTimestamp,
            firstLaterCandle.timestampMs
          );
          return -2;
        }
        setCandles((current) =>
          mergeCandles(current, laterCandles, 'after')
        );
        return laterCandles.length;
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return -1;
        console.warn('预取未来数据失败:', requestError);
        return -2;
      })
      .finally(() => {
        if (futurePrefetchRef.current === request) {
          futurePrefetchRef.current = null;
          futureRequestControllerRef.current = null;
        }
      });

    futurePrefetchRef.current = request;
    return request;
  }, [candles, symbol, timeframe]);

  return {
    candles,
    loading,
    isLoadingEarlier,
    offlineWarning,
    error,
    loadEarlier,
    prefetchFuture,
  };
}

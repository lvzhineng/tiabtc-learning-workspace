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
import {
  createCandleEdgeLoadGuard,
  recordEarlierCandleLoad,
  recordLaterCandleLoad,
  resetCandleEdgeLoadGuard,
  shouldAttemptEarlierCandleLoad,
  shouldAttemptLaterCandleLoad,
} from '@/chart/candle-edge-load-guard';

type CandleWorkspaceData = {
  candles: Candlestick[];
  loading: boolean;
  isLoadingEarlier: boolean;
  isLoadingLater: boolean;
  offlineWarning: string | null;
  error: string | null;
  loadEarlier: () => void;
  loadLater: () => void;
  retryLoad: () => void;
  prefetchFuture: () => Promise<number>;
};

function mergeCandles(
  current: Candlestick[],
  incoming: Candlestick[],
  direction: 'before' | 'after'
): Candlestick[] {
  if (incoming.length === 0) return current;
  if (current.length === 0) return incoming;
  const currentFirst = current[0].timestampMs;
  const currentLast = current[current.length - 1].timestampMs;
  const incomingFirst = incoming[0].timestampMs;
  const incomingLast = incoming[incoming.length - 1].timestampMs;
  if (direction === 'after' && incomingFirst > currentLast) {
    return [...current, ...incoming];
  }
  if (direction === 'before' && incomingLast < currentFirst) {
    return [...incoming, ...current];
  }
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
  const [isLoadingLater, setIsLoadingLater] = useState(false);
  const [offlineWarning, setOfflineWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const failedEdgeRef = useRef<'main' | 'earlier' | 'later' | null>(null);

  const mainRequestRef = useRef<AbortController | null>(null);
  const earlierRequestRef = useRef<AbortController | null>(null);
  const laterRequestRef = useRef<AbortController | null>(null);
  const futureRequestControllerRef = useRef<AbortController | null>(null);
  const futurePrefetchRef = useRef<Promise<number> | null>(null);
  const edgeLoadGuardRef = useRef(createCandleEdgeLoadGuard());
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
    laterRequestRef.current?.abort();
    futureRequestControllerRef.current?.abort();
    earlierRequestRef.current = null;
    laterRequestRef.current = null;
    futureRequestControllerRef.current = null;
    futurePrefetchRef.current = null;
    resetCandleEdgeLoadGuard(edgeLoadGuardRef.current);

    const contextRevision = ++contextRevisionRef.current;
    const controller = new AbortController();
    mainRequestRef.current = controller;
    contextKeyRef.current = contextKey;
    // Do not briefly render the previous interval's candles under the new
    // interval. That would make the chart retain an unrelated logical range.
    setCandles([]);
    setLoading(true);
    setIsLoadingEarlier(false);
    setIsLoadingLater(false);
    setError(null);
    setOfflineWarning(null);
    failedEdgeRef.current = null;

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
            // A symbol/timeframe switch must reload around the current replay
            // position. Reloading around startTimeMs can leave a long-running
            // replay cursor beyond the fixed initial window until playback
            // triggers a later-candle prefetch.
            replayState.cursorTimeMs,
            500,
            controller.signal
          );

    void request
      .then((batch) => {
        if (
          controller.signal.aborted ||
          contextRevisionRef.current !== contextRevision
        ) {
          return;
        }
        setCandles(batch.candles);
        setOfflineWarning(
          batch.warning ||
            (batch.candles.length === 0
              ? `符号 ${symbol} (${TIMEFRAME_DISPLAY_MAP[timeframe]}) 当前时段没有 K 线。已尝试从 Bybit 拉取，可切换到 1h 或拖到更近的时间后重试。`
              : null)
        );
      })
      .catch((requestError) => {
        if (
          controller.signal.aborted ||
          contextRevisionRef.current !== contextRevision
        ) {
          return;
        }
        failedEdgeRef.current = 'main';
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
      laterRequestRef.current?.abort();
      futureRequestControllerRef.current?.abort();
    };
  }, [contextKey, reloadToken]);

  const loadEarlier = useCallback(() => {
    if (
      loading ||
      isLoadingEarlier ||
      candles.length === 0 ||
      earlierRequestRef.current
    ) {
      return;
    }

    const earliestTimestamp = candles[0].timestampMs;
    if (!shouldAttemptEarlierCandleLoad(edgeLoadGuardRef.current, earliestTimestamp)) {
      return;
    }

    const controller = new AbortController();
    const requestContextKey = contextKeyRef.current;
    const requestContextRevision = contextRevisionRef.current;
    earlierRequestRef.current = controller;
    setIsLoadingEarlier(true);
    setError(null);

    void fetchEarlierCandles(
      symbol,
      timeframe,
      earliestTimestamp,
      1000,
      controller.signal
    )
      .then((batch) => {
        if (
          controller.signal.aborted ||
          contextKeyRef.current !== requestContextKey ||
          contextRevisionRef.current !== requestContextRevision
        ) {
          return;
        }
        recordEarlierCandleLoad(
          edgeLoadGuardRef.current,
          earliestTimestamp,
          batch.candles,
          Boolean(batch.warning)
        );
        setCandles((current) => mergeCandles(current, batch.candles, 'before'));
        if (batch.warning) setOfflineWarning(batch.warning);
        setError(null);
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          failedEdgeRef.current = 'earlier';
          setError(
            requestError instanceof Error
              ? requestError.message
              : '加载更早 K 线失败'
          );
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

  const loadLater = useCallback(() => {
    if (
      loading ||
      isLoadingLater ||
      candles.length === 0 ||
      laterRequestRef.current
    ) {
      return;
    }

    const latestTimestamp = candles[candles.length - 1].timestampMs;
    if (!shouldAttemptLaterCandleLoad(edgeLoadGuardRef.current, latestTimestamp)) {
      return;
    }

    const controller = new AbortController();
    const requestContextKey = contextKeyRef.current;
    const requestContextRevision = contextRevisionRef.current;
    laterRequestRef.current = controller;
    setIsLoadingLater(true);
    setError(null);

    void fetchLaterCandles(
      symbol,
      timeframe,
      latestTimestamp,
      1000,
      undefined,
      controller.signal
    )
      .then((batch) => {
        if (
          controller.signal.aborted ||
          contextKeyRef.current !== requestContextKey ||
          contextRevisionRef.current !== requestContextRevision
        ) {
          return;
        }
        recordLaterCandleLoad(
          edgeLoadGuardRef.current,
          latestTimestamp,
          timeframe,
          batch.candles,
          Boolean(batch.warning)
        );
        setCandles((current) => mergeCandles(current, batch.candles, 'after'));
        if (batch.warning) setOfflineWarning(batch.warning);
        setError(null);
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          failedEdgeRef.current = 'later';
          setError(
            requestError instanceof Error
              ? requestError.message
              : '加载更晚 K 线失败'
          );
          console.warn('扩展加载更晚 K 线失败:', requestError);
        }
      })
      .finally(() => {
        if (laterRequestRef.current === controller) {
          laterRequestRef.current = null;
          setIsLoadingLater(false);
        }
      });
  }, [candles, isLoadingLater, loading, symbol, timeframe]);

  const retryLoad = useCallback(() => {
    const kind = failedEdgeRef.current;
    if (kind === 'earlier') {
      loadEarlier();
      return;
    }
    if (kind === 'later') {
      loadLater();
      return;
    }
    setReloadToken((value) => value + 1);
  }, [loadEarlier, loadLater]);

  const prefetchFuture = useCallback((): Promise<number> => {
    if (candles.length === 0) return Promise.resolve(0);
    if (futurePrefetchRef.current) return futurePrefetchRef.current;

    const latestTimestamp = candles[candles.length - 1].timestampMs;
    const requestContextKey = contextKeyRef.current;
    const requestContextRevision = contextRevisionRef.current;
    const controller = new AbortController();
    futureRequestControllerRef.current = controller;
    setError(null);
    const request = fetchLaterCandles(
      symbol,
      timeframe,
      latestTimestamp,
      1000,
      undefined,
      controller.signal
    )
      .then((batch) => {
        if (
          controller.signal.aborted ||
          contextKeyRef.current !== requestContextKey ||
          contextRevisionRef.current !== requestContextRevision
        ) {
          return -1;
        }
        const firstLaterCandle = batch.candles[0];
        const maxAllowedGapMs = TIMEFRAME_SECONDS_MAP[timeframe] * 8_000;
        if (
          firstLaterCandle &&
          firstLaterCandle.timestampMs - latestTimestamp > maxAllowedGapMs
        ) {
          setError(
            '后续 K 线与当前回放不连续，已暂停播放。请点击播放或下一根重试。'
          );
          console.warn(
            '拒绝合并与当前回放不连续的后续 K 线:',
            latestTimestamp,
            firstLaterCandle.timestampMs
          );
          return -2;
        }
        setCandles((current) =>
          mergeCandles(current, batch.candles, 'after')
        );
        if (batch.warning) setOfflineWarning(batch.warning);
        setError(null);
        return batch.candles.length;
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return -1;
        setError(
          `${
            requestError instanceof Error
              ? requestError.message
              : '加载后续 K 线失败'
          }。已暂停播放，请点击播放或下一根重试。`
        );
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
    isLoadingLater,
    offlineWarning,
    error,
    loadEarlier,
    loadLater,
    retryLoad,
    prefetchFuture,
  };
}

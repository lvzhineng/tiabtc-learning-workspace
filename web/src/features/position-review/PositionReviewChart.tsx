import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import {
  fetchPositionEarlierCandles,
  fetchPositionLaterCandles,
  fetchPositionReviewCandles,
} from '@/api/position-review-api';
import { ChartCanvas } from '@/chart/ChartCanvas';
import {
  formatChartTime,
  timestampMsToUtcTimestamp,
  timeframeMs,
} from '@/chart/chart-time';
import type { Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';
import {
  boundedTradeWindowMs,
  candleVenueLabel,
  clipTradeFocusRange,
  sliceCachedCandleWindow,
} from '@/api/candle-window-cache';
import { DraggableDrawingToolbar } from '@/features/drawings/DraggableDrawingToolbar';
import { DrawingObjectTreePanel } from '@/features/drawings/DrawingObjectTreePanel';
import { useDrawingWorkspace } from '@/features/review-workspace/useDrawingWorkspace';
import { FILL_KIND_LABEL, formatNumber, mergeCandles } from './position-review-format';
import { positionPnl, type ReviewPosition } from './position-review-types';

export function PositionReviewChart({
  position,
  timeframe,
  themeMode,
  focusRevision,
  showUsSessionBands,
  showWeekendBands,
}: {
  position: ReviewPosition;
  timeframe: ReviewTimeframe;
  themeMode: 'dark' | 'light';
  focusRevision: number;
  showUsSessionBands: boolean;
  showWeekendBands: boolean;
}) {
  const [hoveredCandle, setHoveredCandle] = useState<Candlestick | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
  const [isLoadingLater, setIsLoadingLater] = useState(false);
  const [loadedContextKey, setLoadedContextKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [candleVenue, setCandleVenue] = useState('bybit');
  const [reloadToken, setReloadToken] = useState(0);
  const failedEdgeRef = useRef<'main' | 'earlier' | 'later' | null>(null);
  const earlierRequestRef = useRef<AbortController | null>(null);
  const laterRequestRef = useRef<AbortController | null>(null);
  const contextKeyRef = useRef('');
  const entryTimeMs = position.entryTimeMs;
  const closedExitTimeMs = position.exitTimeMs;
  const symbol = position.chartSymbol;
  const chartContextKey = `${symbol}:${timeframe}:${entryTimeMs}:${closedExitTimeMs ?? 'open'}:${position.positionId}`;
  const [candles, setCandles] = useState<Candlestick[]>(() => {
    const window = boundedTradeWindowMs(
      entryTimeMs,
      closedExitTimeMs ?? Date.now(),
      timeframe
    );
    const cached = sliceCachedCandleWindow(
      'position',
      symbol,
      timeframe,
      window.fromMs,
      window.toMs
    );
    return cached?.candles ?? [];
  });
  const {
    activeTool,
    setActiveTool,
    magnetEnabled,
    toggleMagnet,
    drawings,
    allDrawings,
    hideAllDrawings,
    toggleHideAllDrawings,
    hiddenDrawingIds,
    toggleHideDrawing,
    deleteDrawingById,
    toggleLockDrawing,
    isObjectTreeOpen,
    toggleObjectTree,
    selectedDrawingId,
    setSelectedDrawingId,
    saveDrawingState,
    deleteSelectedDrawing,
    clearAllDrawings,
    toggleLockSelected,
    undo,
    redo,
  } = useDrawingWorkspace(symbol, timeframe, 'memory');
  const selectedDrawing = drawings.find(
    (drawing) => drawing.id === selectedDrawingId
  );

  useEffect(() => {
    earlierRequestRef.current?.abort();
    laterRequestRef.current?.abort();
    earlierRequestRef.current = null;
    laterRequestRef.current = null;
    const controller = new AbortController();
    contextKeyRef.current = chartContextKey;
    setHoveredCandle(null);
    setIsLoadingEarlier(false);
    setIsLoadingLater(false);
    setError(null);
    setWarning(null);
    failedEdgeRef.current = null;

    const exitForFetch = closedExitTimeMs ?? Date.now();
    const window = boundedTradeWindowMs(entryTimeMs, exitForFetch, timeframe);
    const cached = sliceCachedCandleWindow(
      'position',
      symbol,
      timeframe,
      window.fromMs,
      window.toMs
    );
    if (cached?.candles.length) {
      setCandles(cached.candles);
      setCandleVenue(cached.venue || 'bybit');
      setLoadedContextKey(chartContextKey);
      setLoading(false);
    } else {
      setCandles([]);
      setCandleVenue('bybit');
      setLoadedContextKey('');
      setLoading(true);
    }

    fetchPositionReviewCandles(
      symbol,
      timeframe,
      entryTimeMs,
      exitForFetch,
      controller.signal
    )
      .then((batch) => {
        if (controller.signal.aborted || contextKeyRef.current !== chartContextKey) {
          return;
        }
        setCandles(batch.candles);
        setCandleVenue(batch.candleVenue);
        setWarning(batch.warning);
        setError(!batch.candles.length ? '未返回该时间范围的 K 线' : null);
        setLoadedContextKey(chartContextKey);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          failedEdgeRef.current = 'main';
          setError(cause instanceof Error ? cause.message : '加载 K 线失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      earlierRequestRef.current?.abort();
      laterRequestRef.current?.abort();
    };
  }, [chartContextKey, closedExitTimeMs, entryTimeMs, reloadToken, symbol, timeframe]);

  const loadEarlier = useCallback(() => {
    if (loading || isLoadingEarlier || candles.length === 0 || earlierRequestRef.current) {
      return;
    }
    const controller = new AbortController();
    const requestContextKey = contextKeyRef.current;
    earlierRequestRef.current = controller;
    setIsLoadingEarlier(true);
    void fetchPositionEarlierCandles(
      symbol,
      timeframe,
      candles[0].timestampMs,
      500,
      controller.signal
    )
      .then((batch) => {
        if (!controller.signal.aborted && contextKeyRef.current === requestContextKey) {
          setCandles((current) => mergeCandles(current, batch.candles));
          if (batch.warning) setWarning(batch.warning);
          setError(null);
          failedEdgeRef.current = null;
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          failedEdgeRef.current = 'earlier';
          setError(cause instanceof Error ? cause.message : '加载更早 K 线失败');
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
    if (loading || isLoadingLater || candles.length === 0 || laterRequestRef.current) {
      return;
    }
    const controller = new AbortController();
    const requestContextKey = contextKeyRef.current;
    laterRequestRef.current = controller;
    setIsLoadingLater(true);
    void fetchPositionLaterCandles(
      symbol,
      timeframe,
      candles[candles.length - 1].timestampMs,
      500,
      controller.signal
    )
      .then((batch) => {
        if (!controller.signal.aborted && contextKeyRef.current === requestContextKey) {
          setCandles((current) => mergeCandles(current, batch.candles));
          if (batch.warning) setWarning(batch.warning);
          setError(null);
          failedEdgeRef.current = null;
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          failedEdgeRef.current = 'later';
          setError(cause instanceof Error ? cause.message : '加载更晚 K 线失败');
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

  const markers = useMemo(
    () => buildPositionMarkers(position, timeframe, candles),
    [candles, position, timeframe]
  );
  const focusExitMs =
    closedExitTimeMs ??
    (candles.length ? candles[candles.length - 1].timestampMs : entryTimeMs);

  return (
    <div className="bitlang-chart">
      <DraggableDrawingToolbar
        activeTool={activeTool}
        magnetEnabled={magnetEnabled}
        selectedDrawingId={selectedDrawingId}
        selectedLocked={Boolean(selectedDrawing?.locked)}
        hideAllDrawings={hideAllDrawings}
        isObjectTreeOpen={isObjectTreeOpen}
        onSelectTool={setActiveTool}
        onToggleMagnet={toggleMagnet}
        onToggleHideAllDrawings={toggleHideAllDrawings}
        onToggleObjectTree={toggleObjectTree}
        onUndo={undo}
        onRedo={redo}
        onToggleLock={toggleLockSelected}
        onDeleteSelected={deleteSelectedDrawing}
        onClearAll={clearAllDrawings}
      />
      {isObjectTreeOpen && (
        <DrawingObjectTreePanel
          drawings={allDrawings}
          selectedDrawingId={selectedDrawingId}
          hiddenDrawingIds={hiddenDrawingIds}
          onSelectDrawing={setSelectedDrawingId}
          onToggleHideDrawing={toggleHideDrawing}
          onToggleLockDrawing={toggleLockDrawing}
          onDeleteDrawing={deleteDrawingById}
          onClearAllDrawings={clearAllDrawings}
          onClose={toggleObjectTree}
        />
      )}
      <ChartCanvas
        candles={candles}
        symbol={symbol}
        interval={timeframe}
        themeMode={themeMode}
        systemMarkers={markers}
        focusRangeMs={
          loadedContextKey === chartContextKey && candles.length > 0
            ? clipTradeFocusRange(entryTimeMs, focusExitMs, candles, timeframe)
            : null
        }
        focusRevision={focusRevision}
        onCrosshairMove={setHoveredCandle}
        onLoadEarlier={loadEarlier}
        isLoadingEarlier={isLoadingEarlier}
        onLoadLater={loadLater}
        isLoadingLater={isLoadingLater}
        drawings={drawings}
        activeDrawingTool={activeTool}
        selectedDrawingId={selectedDrawingId}
        magnetEnabled={magnetEnabled}
        drawingVideoId="__global__"
        onSelectDrawing={setSelectedDrawingId}
        onSaveDrawing={saveDrawingState}
        onDeleteDrawing={deleteDrawingById}
        onToggleLockDrawing={toggleLockDrawing}
        onDrawingComplete={() => setActiveTool('select')}
        showVolume
        showUsSessionBands={showUsSessionBands}
        showWeekendBands={showWeekendBands}
      />
      {hoveredCandle && (
        <div className="bitlang-candle-readout">
          <span>{formatChartTime(hoveredCandle.timestampMs, timeframe)}</span>
          <span>开 {formatNumber(hoveredCandle.open, 4)}</span>
          <span>高 {formatNumber(hoveredCandle.high, 4)}</span>
          <span>低 {formatNumber(hoveredCandle.low, 4)}</span>
          <span>收 {formatNumber(hoveredCandle.close, 4)}</span>
          <span>量 {formatNumber(hoveredCandle.volume)}</span>
        </div>
      )}
      {((loading && candles.length === 0) || error) && (
        <div className={`bitlang-chart-status ${error ? 'error' : ''}`}>
          {loading && candles.length === 0 && (
            <RefreshCw size={17} className="spin" />
          )}
          <span>{error || `正在加载 ${symbol} K 线...`}</span>
          {error && (
            <button type="button" onClick={retryLoad}>
              重试
            </button>
          )}
        </div>
      )}
      {warning && !error && (
        <div className="bitlang-chart-status warning">{warning}</div>
      )}
      {loading && candles.length > 0 && (
        <div className="posrev-venue-badge posrev-refreshing">更新中</div>
      )}
      {candles.length > 0 && !(loading && candles.length > 0) && (
        <div
          className={`posrev-venue-badge ${
            candleVenue === 'bitget' ? 'fallback' : ''
          }`}
        >
          {candleVenueLabel(candleVenue)}
        </div>
      )}
    </div>
  );
}

function buildPositionMarkers(
  position: ReviewPosition,
  timeframe: ReviewTimeframe,
  candles: Candlestick[]
): SeriesMarker<UTCTimestamp>[] {
  if (!candles.length) return [];
  const interval = timeframeMs(timeframe);
  const markerTime = (eventTimeMs: number) => {
    const candle =
      candles.find(
        (item) =>
          item.timestampMs <= eventTimeMs && item.timestampMs + interval > eventTimeMs
      ) ||
      candles.reduce((nearest, item) =>
        Math.abs(item.timestampMs - eventTimeMs) <
        Math.abs(nearest.timestampMs - eventTimeMs)
          ? item
          : nearest
      );
    return timestampMsToUtcTimestamp(candle.timestampMs);
  };
  const sideColor = position.side === 'long' ? '#089981' : '#f23645';
  const fills = position.fills ?? [];
  const markers: SeriesMarker<UTCTimestamp>[] = [];
  const pushOpen = (timeMs: number, price: number | null, text: string) => {
    markers.push({
      time: markerTime(timeMs),
      position: 'belowBar',
      color: sideColor,
      shape: 'arrowUp',
      text: `${text} ${formatNumber(price, 4)}`,
    });
  };
  const pushClose = (
    timeMs: number,
    price: number | null,
    text: string,
    pnl: number
  ) => {
    markers.push({
      time: markerTime(timeMs),
      position: 'aboveBar',
      color: pnl >= 0 ? '#089981' : '#f23645',
      shape: 'arrowDown',
      text: `${text} ${formatNumber(price, 4)}`,
    });
  };

  if (fills.length > 0) {
    for (const fill of fills) {
      const label = FILL_KIND_LABEL[fill.kind];
      if (fill.kind === 'open' || fill.kind === 'scaleIn') {
        pushOpen(fill.timeMs, fill.price, label);
      } else {
        pushClose(fill.timeMs, fill.price, label, fill.pnl ?? positionPnl(position));
      }
    }
    if (!fills.some((fill) => fill.kind === 'open')) {
      pushOpen(position.entryTimeMs, position.entryPrice, '开');
    }
    if (position.exitTimeMs && !fills.some((fill) => fill.kind === 'close')) {
      pushClose(position.exitTimeMs, position.exitPrice, '平', positionPnl(position));
    }
  } else {
    pushOpen(position.entryTimeMs, position.entryPrice, '开');
    if (position.exitTimeMs) {
      pushClose(position.exitTimeMs, position.exitPrice, '平', positionPnl(position));
    }
  }
  if (!position.exitTimeMs) {
    markers.push({
      time: timestampMsToUtcTimestamp(candles[candles.length - 1].timestampMs),
      position: 'aboveBar',
      color: '#60a5fa',
      shape: 'circle',
      text: '现在',
    });
  }
  return markers.sort((left, right) => Number(left.time) - Number(right.time));
}

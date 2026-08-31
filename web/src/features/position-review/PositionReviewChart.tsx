import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import {
  fetchPositionEarlierCandles,
  fetchPositionLaterCandles,
  fetchPositionReviewCandles,
} from '@/api/position-review-api';
import { ChartCanvas } from '@/chart/ChartCanvas';
import { captureChartPng } from '@/chart/capture-chart-png';
import { formatPrice, pricePrecision } from '@/chart/chart-price';
import {
  createCandleEdgeLoadGuard,
  recordEarlierCandleLoad,
  recordLaterCandleLoad,
  resetCandleEdgeLoadGuard,
  shouldAttemptEarlierCandleLoad,
  shouldAttemptLaterCandleLoad,
} from '@/chart/candle-edge-load-guard';
import {
  formatChartTime,
  timestampMsToUtcTimestamp,
  timeframeMs,
} from '@/chart/chart-time';
import type { Candlestick } from '@/domain/candle';
import { TIMEFRAME_DISPLAY_MAP, type ReviewTimeframe } from '@/domain/timeframe';
import {
  boundedTradeWindowMs,
  candleVenueLabel,
  clipTradeFocusRange,
  sliceCachedCandleWindow,
} from '@/api/candle-window-cache';
import { DraggableDrawingToolbar } from '@/features/drawings/DraggableDrawingToolbar';
import { DrawingObjectTreePanel } from '@/features/drawings/DrawingObjectTreePanel';
import { useDrawingWorkspace } from '@/features/review-workspace/useDrawingWorkspace';
import { toast } from '@/ui/feedback/toast';
import { FILL_KIND_LABEL, formatNumber, mergeCandles } from './position-review-format';
import type { ReviewPosition } from './position-review-types';

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
  const [copyingChart, setCopyingChart] = useState(false);
  const chartRootRef = useRef<HTMLDivElement | null>(null);
  const failedEdgeRef = useRef<'main' | 'earlier' | 'later' | null>(null);
  const earlierRequestRef = useRef<AbortController | null>(null);
  const laterRequestRef = useRef<AbortController | null>(null);
  const edgeLoadGuardRef = useRef(createCandleEdgeLoadGuard());
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
    ready: drawingReady,
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
  } = useDrawingWorkspace(symbol, timeframe, 'position', {
    venue: position.venue,
    positionId: position.positionId,
  });
  const selectedDrawing = drawings.find(
    (drawing) => drawing.id === selectedDrawingId
  );

  const copyChart = useCallback(async () => {
    if (!chartRootRef.current || copyingChart) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      toast.error('当前浏览器不支持复制图片到剪贴板');
      return;
    }
    setCopyingChart(true);
    try {
      const png = captureChartPng(chartRootRef.current, themeMode, {
        symbol,
        timeframe: TIMEFRAME_DISPLAY_MAP[timeframe],
        source: candleVenue === 'bitget' ? 'Bitget' : 'Bybit',
      });
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': png }),
      ]);
      toast.success('K 线图已复制到剪贴板');
    } catch (cause) {
      toast.error(
        `复制图表失败: ${cause instanceof Error ? cause.message : '浏览器拒绝了剪贴板操作'}`
      );
    } finally {
      setCopyingChart(false);
    }
  }, [candleVenue, copyingChart, symbol, themeMode, timeframe]);

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
    resetCandleEdgeLoadGuard(edgeLoadGuardRef.current);

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
        if (
          !controller.signal.aborted &&
          contextKeyRef.current === chartContextKey
        ) {
          failedEdgeRef.current = 'main';
          setError(cause instanceof Error ? cause.message : '加载 K 线失败');
          setLoadedContextKey(chartContextKey);
        }
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          contextKeyRef.current === chartContextKey
        ) {
          setLoading(false);
        }
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
    const earliestTimestamp = candles[0].timestampMs;
    if (!shouldAttemptEarlierCandleLoad(edgeLoadGuardRef.current, earliestTimestamp)) {
      return;
    }
    const controller = new AbortController();
    const requestContextKey = contextKeyRef.current;
    earlierRequestRef.current = controller;
    setIsLoadingEarlier(true);
    void fetchPositionEarlierCandles(
      symbol,
      timeframe,
      earliestTimestamp,
      500,
      controller.signal
    )
      .then((batch) => {
        if (!controller.signal.aborted && contextKeyRef.current === requestContextKey) {
          recordEarlierCandleLoad(
            edgeLoadGuardRef.current,
            earliestTimestamp,
            batch.candles,
            Boolean(batch.warning)
          );
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
    const latestTimestamp = candles[candles.length - 1].timestampMs;
    if (!shouldAttemptLaterCandleLoad(edgeLoadGuardRef.current, latestTimestamp)) {
      return;
    }
    const controller = new AbortController();
    const requestContextKey = contextKeyRef.current;
    laterRequestRef.current = controller;
    setIsLoadingLater(true);
    void fetchPositionLaterCandles(
      symbol,
      timeframe,
      latestTimestamp,
      500,
      controller.signal
    )
      .then((batch) => {
        if (!controller.signal.aborted && contextKeyRef.current === requestContextKey) {
          recordLaterCandleLoad(
            edgeLoadGuardRef.current,
            latestTimestamp,
            timeframe,
            batch.candles,
            Boolean(batch.warning)
          );
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

  const handleDrawingComplete = useCallback(() => {
    setActiveTool('select');
  }, [setActiveTool]);

  const contextReady = loadedContextKey === chartContextKey;
  const displayedCandles = contextReady ? candles : [];
  const chartLoading = loading || !contextReady;
  const chartError = contextReady ? error : null;
  const chartWarning = contextReady ? warning : null;
  const displayedPricePrecision = useMemo(
    () =>
      pricePrecision([
        ...displayedCandles.flatMap((candle) => [
          candle.open,
          candle.high,
          candle.low,
          candle.close,
        ]),
        position.entryPrice,
        position.exitPrice,
        ...(position.fills ?? []).map((fill) => fill.price),
      ]),
    [displayedCandles, position.entryPrice, position.exitPrice, position.fills]
  );
  const markers = useMemo(
    () =>
      buildPositionMarkers(
        position,
        timeframe,
        displayedCandles,
        displayedPricePrecision
      ),
    [displayedCandles, displayedPricePrecision, position, timeframe]
  );
  const focusExitMs =
    closedExitTimeMs ??
    (displayedCandles.length
      ? displayedCandles[displayedCandles.length - 1].timestampMs
      : entryTimeMs);

  return (
    <div ref={chartRootRef} className="bitlang-chart">
      <DraggableDrawingToolbar
        disabled={!drawingReady}
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
        clearAllTitle="清空当前仓位所有画线"
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
      <button
        type="button"
        className="posrev-copy-chart"
        onClick={copyChart}
        disabled={copyingChart || displayedCandles.length === 0}
        title="复制 K 线图到剪贴板"
      >
        {copyingChart ? <RefreshCw size={14} className="spin" /> : <Copy size={14} />}
        <span>{copyingChart ? '复制中' : '复制图表'}</span>
      </button>
      <ChartCanvas
        candles={displayedCandles}
        symbol={symbol}
        interval={timeframe}
        viewportContextKey={chartContextKey}
        themeMode={themeMode}
        systemMarkers={markers}
        focusRangeMs={
          contextReady && displayedCandles.length > 0
            ? clipTradeFocusRange(
                entryTimeMs,
                focusExitMs,
                displayedCandles,
                timeframe
              )
            : null
        }
        focusRevision={focusRevision}
        onCrosshairMove={setHoveredCandle}
        onLoadEarlier={loadEarlier}
        isLoadingEarlier={isLoadingEarlier}
        onLoadLater={loadLater}
        isLoadingLater={isLoadingLater}
        drawings={drawings}
        activeDrawingTool={drawingReady ? activeTool : 'select'}
        selectedDrawingId={selectedDrawingId}
        magnetEnabled={magnetEnabled}
        drawingVideoId={position.positionId}
        onSelectDrawing={setSelectedDrawingId}
        onSaveDrawing={saveDrawingState}
        onDeleteDrawing={deleteDrawingById}
        onToggleLockDrawing={toggleLockDrawing}
        onDrawingComplete={handleDrawingComplete}
        showVolume
        showUsSessionBands={showUsSessionBands}
        showWeekendBands={showWeekendBands}
      />
      {hoveredCandle && (
        <div className="bitlang-candle-readout">
          <span>{formatChartTime(hoveredCandle.timestampMs, timeframe)}</span>
          <span>开 {formatPrice(hoveredCandle.open, displayedPricePrecision)}</span>
          <span>高 {formatPrice(hoveredCandle.high, displayedPricePrecision)}</span>
          <span>低 {formatPrice(hoveredCandle.low, displayedPricePrecision)}</span>
          <span>收 {formatPrice(hoveredCandle.close, displayedPricePrecision)}</span>
          <span>量 {formatNumber(hoveredCandle.volume)}</span>
        </div>
      )}
      {((chartLoading && displayedCandles.length === 0) || chartError) && (
        <div className={`bitlang-chart-status ${chartError ? 'error' : ''}`}>
          {chartLoading && displayedCandles.length === 0 && (
            <RefreshCw size={17} className="spin" />
          )}
          <span>{chartError || `正在加载 ${symbol} K 线...`}</span>
          {chartError && (
            <button type="button" onClick={retryLoad}>
              重试
            </button>
          )}
        </div>
      )}
      {chartWarning && !chartError && (
        <div className="bitlang-chart-status warning">{chartWarning}</div>
      )}
      {chartLoading && displayedCandles.length > 0 && (
        <div className="posrev-venue-badge posrev-refreshing">更新中</div>
      )}
      {displayedCandles.length > 0 &&
        !(chartLoading && displayedCandles.length > 0) && (
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
  candles: Candlestick[],
  displayedPricePrecision: number
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
  const fills = position.fills ?? [];
  const markers: SeriesMarker<UTCTimestamp>[] = [];
  const pushTradeMarker = (
    timeMs: number,
    price: number | null,
    text: string,
    side: 'buy' | 'sell'
  ) => {
    const isBuy = side === 'buy';
    markers.push({
      time: markerTime(timeMs),
      position: isBuy ? 'belowBar' : 'aboveBar',
      color: isBuy ? '#089981' : '#f23645',
      shape: isBuy ? 'arrowUp' : 'arrowDown',
      text: `${text} ${formatPrice(price, displayedPricePrecision)}`,
    });
  };
  const openSide = position.side === 'long' ? 'buy' : 'sell';
  const closeSide = position.side === 'long' ? 'sell' : 'buy';

  if (fills.length > 0) {
    for (const fill of fills) {
      const label = FILL_KIND_LABEL[fill.kind];
      pushTradeMarker(fill.timeMs, fill.price, label, fill.side);
    }
    if (!fills.some((fill) => fill.kind === 'open')) {
      pushTradeMarker(position.entryTimeMs, position.entryPrice, '开', openSide);
    }
    if (position.exitTimeMs && !fills.some((fill) => fill.kind === 'close')) {
      pushTradeMarker(position.exitTimeMs, position.exitPrice, '平', closeSide);
    }
  } else {
    pushTradeMarker(position.entryTimeMs, position.entryPrice, '开', openSide);
    if (position.exitTimeMs) {
      pushTradeMarker(position.exitTimeMs, position.exitPrice, '平', closeSide);
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

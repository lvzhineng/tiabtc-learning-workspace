import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, GitCommit, RefreshCw } from 'lucide-react';
import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import {
  fetchPositionEarlierCandles,
  fetchPositionLaterCandles,
  fetchPositionReviewCandles,
} from '@/api/position-review-api';
import { ChartCanvas, findNearestCandle } from '@/chart/ChartCanvas';
import type { TradePricePoint } from '@/chart/TradePricePrimitive';
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
  candleVenueLabel,
  clipTradeFocusRange,
  positionCandleCacheVenue,
} from '@/api/candle-window-cache';
import { DraggableDrawingToolbar } from '@/features/drawings/DraggableDrawingToolbar';
import { DrawingObjectTreePanel } from '@/features/drawings/DrawingObjectTreePanel';
import { useDrawingWorkspace } from '@/features/review-workspace/useDrawingWorkspace';
import { toast } from '@/ui/feedback/toast';
import { FILL_KIND_LABEL, formatNumber, mergeCandles } from './position-review-format';
import type { ReviewPosition } from './position-review-types';
import { positionKey, venueLabel } from './position-review-types';

const EMPTY_CANDLES: Candlestick[] = [];

export function PositionReviewChart({
  position,
  positions,
  timeframe,
  themeMode,
  focusRevision,
  showUsSessionBands,
  showWeekendBands,
}: {
  position: ReviewPosition;
  positions: ReviewPosition[];
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
  const [candleVenue, setCandleVenue] = useState(() =>
    positionCandleCacheVenue(position.chartSymbol, position.venue)
  );
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
  const chartContextKey = `${symbol}:${timeframe}:${entryTimeMs}:${closedExitTimeMs ?? 'open'}:${positionKey(position)}`;
  const markerEvents = useMemo(
    () => buildPositionEvents(positions.filter((item) => item.chartSymbol === symbol)),
    [positions, symbol]
  );
  const [candles, setCandles] = useState<Candlestick[]>(EMPTY_CANDLES);
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
        source:
          candleVenue === 'bitget'
            ? 'Bitget'
            : candleVenue === 'gate'
              ? 'Gate'
              : 'Bybit',
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
    // The API owns cache lookup and returns cached windows without a network request.
    setCandles(EMPTY_CANDLES);
    setCandleVenue(positionCandleCacheVenue(symbol, position.venue));
    setLoadedContextKey('');
    setLoading(true);

    fetchPositionReviewCandles(
      symbol,
      timeframe,
      entryTimeMs,
      exitForFetch,
      controller.signal,
      position.venue
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
  }, [
    chartContextKey,
    closedExitTimeMs,
    entryTimeMs,
    position.venue,
    reloadToken,
    symbol,
    timeframe,
  ]);

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
      controller.signal,
      position.venue
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
  }, [candles, isLoadingEarlier, loading, position.venue, symbol, timeframe]);

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
      controller.signal,
      position.venue
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
  }, [candles, isLoadingLater, loading, position.venue, symbol, timeframe]);

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
  const displayedCandles = contextReady ? candles : EMPTY_CANDLES;
  const chartLoading = loading || !contextReady;
  const chartError = contextReady ? error : null;
  const chartWarning = contextReady ? warning : null;
  const displayedPricePrecision = useMemo(() => {
    function* values() {
      for (const candle of displayedCandles) {
        yield candle.open;
        yield candle.high;
        yield candle.low;
        yield candle.close;
      }
      yield position.entryPrice;
      yield position.exitPrice;
      if (position.fills) {
        for (const fill of position.fills) {
          yield fill.price;
        }
      }
    }
    return pricePrecision(values());
  }, [displayedCandles, position.entryPrice, position.exitPrice, position.fills]);
  const { markers, pricePoints } = useMemo(
    () =>
      buildPositionMarkers(markerEvents, positionKey(position), !closedExitTimeMs,
        timeframe, displayedCandles, displayedPricePrecision),
    [displayedCandles, displayedPricePrecision, position.venue, position.positionId,
      closedExitTimeMs, markerEvents, timeframe]
  );
  const [showTrajectory, setShowTrajectory] = useState(false);

  const trajectoryPoints = useMemo(() => {
    if (!showTrajectory || !displayedCandles.length) return null;
    const fills = position.fills || [];
    if (fills.length < 2) return null;

    const sorted = [...fills].sort((a, b) => a.timeMs - b.timeMs);
    const points: { time: UTCTimestamp; value: number }[] = [];
    const seenTimes = new Set<number>();

    for (const fill of sorted) {
      if (fill.price == null) continue;
      const nearest = findNearestCandle(displayedCandles, fill.timeMs);
      if (!nearest) continue;
      const t = Math.floor(nearest.timestampMs / 1000) as UTCTimestamp;
      if (seenTimes.has(t)) {
        points[points.length - 1] = { time: t, value: fill.price };
      } else {
        seenTimes.add(t);
        points.push({ time: t, value: fill.price });
      }
    }
    return points.length >= 2 ? points : null;
  }, [displayedCandles, position.fills, showTrajectory]);

  const focusExitMs =
    closedExitTimeMs ??
    (displayedCandles.length
      ? displayedCandles[displayedCandles.length - 1].timestampMs
      : entryTimeMs);
  const focusRangeMs = useMemo(
    () => contextReady && displayedCandles.length > 0
      ? clipTradeFocusRange(entryTimeMs, focusExitMs, displayedCandles, timeframe)
      : null,
    [contextReady, displayedCandles, entryTimeMs, focusExitMs, timeframe]
  );

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
      {position.fills && position.fills.length >= 2 && (
        <button
          type="button"
          className={`posrev-copy-chart posrev-trajectory-btn ${showTrajectory ? 'active' : ''}`}
          onClick={() => setShowTrajectory((v) => !v)}
          title="显示/隐藏分批调仓折线轨迹"
        >
          <GitCommit size={14} />
          <span>{showTrajectory ? '隐藏轨迹' : '调仓轨迹'}</span>
        </button>
      )}
      <ChartCanvas
        candles={displayedCandles}
        symbol={symbol}
        interval={timeframe}
        viewportContextKey={chartContextKey}
        themeMode={themeMode}
        systemMarkers={markers}
        tradePricePoints={pricePoints}
        trajectoryPoints={trajectoryPoints}
        focusRangeMs={focusRangeMs}
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
            candleVenue === 'bitget' || candleVenue === 'gate' ? 'fallback' : ''
          }`}
        >
          {candleVenueLabel(candleVenue)}
        </div>
        )}
    </div>
  );
}

interface PositionMarkerEvent {
  timeMs: number;
  price: number | null;
  label: string;
  side: 'buy' | 'sell';
  key: string;
}

function buildPositionEvents(positions: ReviewPosition[]): PositionMarkerEvent[] {
  const events: PositionMarkerEvent[] = [];
  for (const position of positions) {
    const key = positionKey(position);
    const prefix = `${venueLabel(position.venue)} ${position.side === 'long' ? '多' : '空'}`;
    const push = (timeMs: number, price: number | null, label: string, side: 'buy' | 'sell') => {
      if (Number.isFinite(timeMs)) events.push({ timeMs, price, label: `${prefix} ${label}`, side, key });
    };
    let hasOpen = false;
    let hasClose = false;
    for (const fill of position.fills ?? []) {
      hasOpen ||= fill.kind === 'open';
      hasClose ||= fill.kind === 'close';
      push(fill.timeMs, fill.price, FILL_KIND_LABEL[fill.kind], fill.side);
    }
    if (!hasOpen) {
      push(position.entryTimeMs, position.entryPrice, '开', position.side === 'long' ? 'buy' : 'sell');
    }
    if (position.exitTimeMs && !hasClose) {
      push(position.exitTimeMs, position.exitPrice, '平', position.side === 'long' ? 'sell' : 'buy');
    }
  }
  return events.sort((left, right) => left.timeMs - right.timeMs);
}

function buildPositionMarkers(
  events: PositionMarkerEvent[],
  selectedKey: string,
  selectedOpen: boolean,
  timeframe: ReviewTimeframe,
  candles: Candlestick[],
  displayedPricePrecision: number
): { markers: SeriesMarker<UTCTimestamp>[]; pricePoints: TradePricePoint[] } {
  if (!candles.length) return { markers: [], pricePoints: [] };
  const interval = timeframeMs(timeframe);
  const markerTime = (eventTimeMs: number) => {
    if (!Number.isFinite(eventTimeMs)) return null;
    // Only attach events to their actual candle; unloaded ranges and gaps stay empty.
    let low = 0;
    let high = candles.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (candles[middle].timestampMs <= eventTimeMs) low = middle + 1;
      else high = middle;
    }
    const candle = candles[low - 1];
    if (!candle || eventTimeMs >= candle.timestampMs + interval) return null;
    return timestampMsToUtcTimestamp(candle.timestampMs);
  };
  const markers: SeriesMarker<UTCTimestamp>[] = [];
  const pricePoints: TradePricePoint[] = [];
  // Search the sorted event index once; only visit events inside the loaded window.
  let low = 0;
  let high = events.length;
  const fromMs = candles[0].timestampMs;
  const toMs = candles[candles.length - 1].timestampMs + interval;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle].timeMs < fromMs) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < events.length && events[index].timeMs < toMs; index += 1) {
    const event = events[index];
    const time = markerTime(event.timeMs);
    if (time == null) continue;
    const selected = event.key === selectedKey;
    const isBuy = event.side === 'buy';
    if (event.price != null && Number.isFinite(event.price) && event.price > 0) {
      pricePoints.push({
        time, price: event.price, selected,
        color: isBuy ? '#089981' : '#f23645',
      });
    }
    markers.push({
      time,
      position: isBuy ? 'belowBar' : 'aboveBar',
      color: isBuy ? '#089981' : '#f23645',
      shape: isBuy ? 'arrowUp' : 'arrowDown',
      size: selected ? 2 : 1,
      text: `${selected ? '【当前】' : ''}${event.label}${selected ? ` ${formatPrice(event.price, displayedPricePrecision)}` : ''}`,
    });
  }
  if (selectedOpen && markerTime(Date.now()) != null) {
    markers.push({
      time: timestampMsToUtcTimestamp(candles[candles.length - 1].timestampMs),
      position: 'aboveBar',
      color: '#60a5fa',
      shape: 'circle',
      text: '现在',
    });
  }
  // Event-to-candle mapping preserves time order; the last-candle marker is appended.
  return { markers, pricePoints };
}

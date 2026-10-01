import type { TradingSession } from '@/chart/trading-sessions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import {
  fetchBitlangEarlierCandles,
  fetchBitlangLaterCandles,
  fetchBitlangTradeCandles,
} from '@/api/market-api';
import {
  boundedTradeWindowMs,
  candleVenueLabel,
  clipTradeFocusRange,
  sliceCachedCandleWindow,
} from '@/api/candle-window-cache';
import { ChartCanvas } from '@/chart/ChartCanvas';
import { useChartExport } from '@/chart/useChartExport';
import { mergeCandleWindow } from '@/chart/candle-retention';
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
import { DraggableDrawingToolbar } from '@/features/drawings/DraggableDrawingToolbar';
import { DrawingObjectTreePanel } from '@/features/drawings/DrawingObjectTreePanel';
import { useDrawingWorkspace } from '@/features/review-workspace/useDrawingWorkspace';
import {
  bybitSymbol,
  formatNumber,
  tradeEntryMs,
  tradeExitMs,
} from './bitlang-format';
import type { AnnotatedBitlangTrade, BitlangTrade } from './bitlang-types';

export function BitlangTradeChart({
  trade,
  timeframe,
  themeMode,
  focusRevision,
  sessionBands,
  showWeekendBands,
  tagNames,
}: {
  trade: AnnotatedBitlangTrade;
  timeframe: ReviewTimeframe;
  themeMode: 'dark' | 'light';
  focusRevision: number;
  sessionBands: TradingSession[];
  showWeekendBands: boolean;
  tagNames: string[];
}) {
  const [hoveredCandle, setHoveredCandle] = useState<Candlestick | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
  const [isLoadingLater, setIsLoadingLater] = useState(false);
  const [loadedContextKey, setLoadedContextKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const chartRootRef = useRef<HTMLDivElement | null>(null);
  const failedEdgeRef = useRef<'main' | 'earlier' | 'later' | null>(null);
  const earlierRequestRef = useRef<AbortController | null>(null);
  const laterRequestRef = useRef<AbortController | null>(null);
  const edgeLoadGuardRef = useRef(createCandleEdgeLoadGuard());
  const contextKeyRef = useRef('');
  const entryTimeMs = tradeEntryMs(trade);
  const exitTimeMs = tradeExitMs(trade);
  const symbol = bybitSymbol(trade.instrument);
  const chartContextKey = `${symbol}:${timeframe}:${entryTimeMs}:${exitTimeMs}:${trade.id}`;
  const [candles, setCandles] = useState<Candlestick[]>(() => {
    const window = boundedTradeWindowMs(entryTimeMs, exitTimeMs, timeframe);
    const cached = sliceCachedCandleWindow(
      'bitlang',
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
  } = useDrawingWorkspace(symbol, timeframe, 'bitlang', {
    tradeId: trade.id,
  });
  const selectedDrawing = drawings.find(
    (drawing) => drawing.id === selectedDrawingId
  );

  const { copyingChart, exportingCard, copyChart, exportCard } = useChartExport(chartRootRef, themeMode, {
    symbol, timeframe: TIMEFRAME_DISPLAY_MAP[timeframe], source: 'Bybit',
  }, {
    title: `bit浪浪 ${symbol} 第 ${trade.sequence} 笔交易复盘`,
    details: [trade.direction, `开仓 ${formatChartTime(entryTimeMs, timeframe)}`, `平仓 ${formatChartTime(exitTimeMs, timeframe)}`],
    note: trade.note, tags: tagNames, sourceNote: trade.sourceNote,
  });

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

    const window = boundedTradeWindowMs(entryTimeMs, exitTimeMs, timeframe);
    const cached = sliceCachedCandleWindow(
      'bitlang',
      symbol,
      timeframe,
      window.fromMs,
      window.toMs
    );
    if (cached?.candles.length) {
      setCandles(cached.candles);
      setLoadedContextKey(chartContextKey);
      setLoading(false);
    } else {
      setCandles([]);
      setLoadedContextKey('');
      setLoading(true);
    }

    fetchBitlangTradeCandles(
      symbol,
      timeframe,
      entryTimeMs,
      exitTimeMs,
      controller.signal
    )
      .then((batch) => {
        if (
          controller.signal.aborted ||
          contextKeyRef.current !== chartContextKey
        ) {
          return;
        }
        setCandles(batch.candles);
        setLoadedContextKey(chartContextKey);
        setWarning(batch.warning);
        setError(!batch.candles.length ? 'Bybit 未返回该时间范围的 K 线' : null);
      })
      .catch((cause) => {
        if (
          !controller.signal.aborted &&
          contextKeyRef.current === chartContextKey
        ) {
          failedEdgeRef.current = 'main';
          setError(cause instanceof Error ? cause.message : 'K 线加载失败');
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
  }, [chartContextKey, entryTimeMs, exitTimeMs, reloadToken, symbol, timeframe]);

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
    earlierRequestRef.current = controller;
    setIsLoadingEarlier(true);
    void fetchBitlangEarlierCandles(
      symbol,
      timeframe,
      earliestTimestamp,
      500,
      controller.signal
    )
      .then((batch) => {
        if (
          !controller.signal.aborted &&
          contextKeyRef.current === requestContextKey
        ) {
          recordEarlierCandleLoad(
            edgeLoadGuardRef.current,
            earliestTimestamp,
            batch.candles,
            Boolean(batch.warning)
          );
          setCandles((current) => mergeCandleWindow(current, batch.candles, 'before'));
          if (batch.warning) setWarning(batch.warning);
          setError(null);
          failedEdgeRef.current = null;
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          failedEdgeRef.current = 'earlier';
          setError(
            cause instanceof Error ? cause.message : '加载更早 K 线失败'
          );
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
    laterRequestRef.current = controller;
    setIsLoadingLater(true);
    void fetchBitlangLaterCandles(
      symbol,
      timeframe,
      latestTimestamp,
      500,
      controller.signal
    )
      .then((batch) => {
        if (
          !controller.signal.aborted &&
          contextKeyRef.current === requestContextKey
        ) {
          recordLaterCandleLoad(
            edgeLoadGuardRef.current,
            latestTimestamp,
            timeframe,
            batch.candles,
            Boolean(batch.warning)
          );
          setCandles((current) => mergeCandleWindow(current, batch.candles, 'after'));
          if (batch.warning) setWarning(batch.warning);
          setError(null);
          failedEdgeRef.current = null;
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          failedEdgeRef.current = 'later';
          setError(
            cause instanceof Error ? cause.message : '加载更晚 K 线失败'
          );
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
  const displayedPricePrecision = useMemo(() => {
    function* values() {
      for (const candle of displayedCandles) {
        yield candle.open;
        yield candle.high;
        yield candle.low;
        yield candle.close;
      }
      yield trade.entryPrice;
      yield trade.exitPrice;
    }
    return pricePrecision(values());
  }, [displayedCandles, trade.entryPrice, trade.exitPrice]);
  const markers = useMemo(
    () =>
      buildTradeMarkers(
        trade,
        timeframe,
        displayedCandles,
        displayedPricePrecision
      ),
    [displayedCandles, displayedPricePrecision, timeframe, trade]
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
        clearAllTitle="清空当前交易所有画线"
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
      <button type="button" className="posrev-copy-chart posrev-export-card" onClick={() => void exportCard()}
        disabled={exportingCard || copyingChart || displayedCandles.length === 0}>
        {exportingCard ? '导出中…' : '导出复盘卡片'}
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
            ? clipTradeFocusRange(entryTimeMs, exitTimeMs, displayedCandles, timeframe)
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
        drawingVideoId={trade.id}
        onSelectDrawing={setSelectedDrawingId}
        onSaveDrawing={saveDrawingState}
        onDeleteDrawing={deleteDrawingById}
        onToggleLockDrawing={toggleLockDrawing}
        onDrawingComplete={handleDrawingComplete}
        showVolume
        sessionBands={sessionBands}
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
        <div className="bitlang-venue-badge bitlang-refreshing">更新中</div>
      )}
      {displayedCandles.length > 0 && !chartLoading && (
        <div className="bitlang-venue-badge">{candleVenueLabel('bybit')}</div>
      )}
    </div>
  );
}

function buildTradeMarkers(
  trade: BitlangTrade,
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
          item.timestampMs <= eventTimeMs &&
          item.timestampMs + interval > eventTimeMs
      ) ||
      candles.reduce((nearest, item) =>
        Math.abs(item.timestampMs - eventTimeMs) <
        Math.abs(nearest.timestampMs - eventTimeMs)
          ? item
          : nearest
      );
    return timestampMsToUtcTimestamp(candle.timestampMs);
  };
  const isLong = trade.direction === '多';
  return [
    {
      time: markerTime(Date.parse(trade.entryTime)),
      position: isLong ? 'belowBar' : 'aboveBar',
      color: isLong ? '#089981' : '#f23645',
      shape: isLong ? 'arrowUp' : 'arrowDown',
      text: `开 ${formatPrice(trade.entryPrice, displayedPricePrecision)}`,
    },
    {
      time: markerTime(Date.parse(trade.exitTime)),
      position: isLong ? 'aboveBar' : 'belowBar',
      color: trade.profit >= 0 ? '#089981' : '#f23645',
      shape: isLong ? 'arrowDown' : 'arrowUp',
      text: `平 ${formatPrice(trade.exitPrice, displayedPricePrecision)}`,
    },
  ];
}

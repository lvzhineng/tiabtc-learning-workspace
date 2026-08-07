import { useEffect, useState, useCallback, useMemo } from 'react';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { TIMEFRAME_DISPLAY_MAP } from '@/domain/timeframe';
import { timeframeMs } from '@/chart/chart-time';
import type { Candlestick } from '@/domain/candle';
import {
  fetchSymbols,
  addCustomSymbol,
} from '@/api/market-api';
import { ChartCanvas } from '@/chart/ChartCanvas';
import { computeReadoutInfo, type ReadoutInfo } from '@/chart/candlestick-readout';
import type { ReplayState } from '@/features/replay/replay-state';
import {
  filterVisibleCandles,
  findCandleCompletingAt,
  getNextCursorTimeMs,
  getPrevCursorTimeMs,
  shouldPrefetchFuture,
} from '@/features/replay/free-replay-logic';
import { FreeReplayPanel } from '@/features/replay/FreeReplayPanel';
import { DraggableDrawingToolbar } from '@/features/drawings/DraggableDrawingToolbar';
import type { VideoReviewContext } from '@/domain/review-context';
import { buildVideoPublishedMarker } from '@/chart/system-marker';
import type { PositionToolParams } from '@/features/paper-trading/paper-trade-types';
import type { PaperTrade } from '@/domain/paper-trade';
import { calculateRR } from '@/features/paper-trading/paper-trade-logic';
import { PaperTradingPanel } from '@/features/paper-trading/PaperTradingPanel';
import { useCandleWorkspaceData } from './useCandleWorkspaceData';
import { useDrawingWorkspace } from './useDrawingWorkspace';
import { usePaperTrading } from './usePaperTrading';
import { ChartReadoutBar } from './ChartReadoutBar';
import {
  AlertCircle,
  Plus,
  RefreshCw,
  Video,
  Target,
} from 'lucide-react';
import '@/styles/review-workspace.css';

const TIMEFRAMES: ReviewTimeframe[] = ['1', '5', '15', '60', '240', 'D', 'W'];

interface ChartWorkspaceProps {
  initialVideoContext?: VideoReviewContext | null;
  themeMode?: 'dark' | 'light';
}

export function ChartWorkspace({
  initialVideoContext,
  themeMode = 'dark',
}: ChartWorkspaceProps) {
  const [symbols, setSymbols] = useState<string[]>(['BTCUSDT']);
  const [activeSymbol, setActiveSymbol] = useState<string>(
    initialVideoContext?.symbol || 'BTCUSDT'
  );
  const [activeTimeframe, setActiveTimeframe] = useState<ReviewTimeframe>('60');
  const [isLogScale, setIsLogScale] = useState<boolean>(false);
  const [chartFocusTimeMs, setChartFocusTimeMs] = useState<number | null>(null);
  const [timeframeSwitchAnchorTimeMs, setTimeframeSwitchAnchorTimeMs] =
    useState<number | null>(null);

  const [hoveredCandle, setHoveredCandle] = useState<Candlestick | null>(null);

  const [newSymbolInput, setNewSymbolInput] = useState<string>('');
  const [showAddSymbol, setShowAddSymbol] = useState<boolean>(false);

  // Paper Trading State
  const [showPaperPanel, setShowPaperPanel] = useState<boolean>(false);
  const [pendingPositionParams, setPendingPositionParams] = useState<PositionToolParams | null>(null);

  // Replay State Machine
  const [replayState, setReplayState] = useState<ReplayState>(() => {
    if (initialVideoContext) {
      return {
        status: 'ready',
        context: initialVideoContext,
        startTimeMs: initialVideoContext.anchorTimeMs,
        progressTimeMs: initialVideoContext.anchorTimeMs,
        cursorTimeMs: initialVideoContext.anchorTimeMs,
        speed: 1,
      };
    }
    return { status: 'idle' };
  });

  const {
    candles,
    loading,
    isLoadingEarlier,
    offlineWarning,
    error,
    loadEarlier: handleLoadEarlier,
    prefetchFuture: prefetchFutureCandles,
  } = useCandleWorkspaceData(
    activeSymbol,
    activeTimeframe,
    replayState,
    timeframeSwitchAnchorTimeMs
  );

  // One-shot anchor for the timeframe switch fetch; clear once data arrives so
  // subsequent live requests are not pinned to a historical window.
  useEffect(() => {
    if (
      loading ||
      candles.length === 0 ||
      timeframeSwitchAnchorTimeMs === null
    ) {
      return;
    }
    setTimeframeSwitchAnchorTimeMs(null);
  }, [candles.length, loading, timeframeSwitchAnchorTimeMs]);

  const {
    activeTool,
    setActiveTool,
    magnetEnabled,
    toggleMagnet,
    drawings,
    selectedDrawingId,
    setSelectedDrawingId,
    saveDrawingState: handleSaveDrawingState,
    deleteSelectedDrawing: handleDeleteSelectedDrawing,
    clearAllDrawings: handleClearAllDrawings,
    toggleLockSelected: handleToggleLockSelected,
    undo: handleUndo,
    redo: handleRedo,
  } = useDrawingWorkspace(activeSymbol, activeTimeframe);
  const {
    trades: paperTrades,
    createTrade: createPaperTrade,
    closeTrade: handleClosePaperTrade,
    removeTrade: handleDeletePaperTrade,
    checkTriggers: checkOpenTradesTriggers,
  } = usePaperTrading(activeSymbol, activeTimeframe, replayState);
  const replayDataContextKey =
    replayState.status === 'idle'
      ? 'live'
      : `${replayState.context.mode}:${replayState.startTimeMs}`;

  const handleTimeframeChange = useCallback(
    (nextTimeframe: ReviewTimeframe) => {
      if (nextTimeframe === activeTimeframe) return;
      const selectedDrawing = drawings.find(
        (drawing) => drawing.id === selectedDrawingId
      );
      const drawingAnchorTimeMs =
        selectedDrawing?.points[selectedDrawing.points.length - 1]
          ?.timestampMs ?? null;
      const replayAnchorTimeMs =
        replayState.status === 'idle' ? null : replayState.cursorTimeMs;
      // Keep an explicit review anchor (drawing / replay / double-click focus).
      // Do not use hoveredCandle: crosshair hover would pin mid-history bars to
      // the right edge and shove the live tip off-screen after a timeframe switch.
      const anchorTimeMs =
        drawingAnchorTimeMs ?? replayAnchorTimeMs ?? chartFocusTimeMs ?? null;
      setTimeframeSwitchAnchorTimeMs(anchorTimeMs);
      setChartFocusTimeMs(anchorTimeMs);
      setActiveTimeframe(nextTimeframe);
    },
    [
      activeTimeframe,
      chartFocusTimeMs,
      drawings,
      replayState,
      selectedDrawingId,
    ]
  );

  const handleSymbolChange = useCallback(
    (nextSymbol: string) => {
      if (nextSymbol === activeSymbol) return;
      setTimeframeSwitchAnchorTimeMs(null);
      setChartFocusTimeMs(null);
      setActiveSymbol(nextSymbol);
    },
    [activeSymbol]
  );

  // Sync initialVideoContext if passed from parent
  useEffect(() => {
    if (initialVideoContext) {
      setActiveSymbol(initialVideoContext.symbol || 'BTCUSDT');
      setReplayState({
        status: 'ready',
        context: initialVideoContext,
        startTimeMs: initialVideoContext.anchorTimeMs,
        progressTimeMs: initialVideoContext.anchorTimeMs,
        cursorTimeMs: initialVideoContext.anchorTimeMs,
        speed: 1,
      });
    }
  }, [initialVideoContext]);

  // Load symbol list on mount
  useEffect(() => {
    fetchSymbols()
      .then((list) => {
        if (list && list.length > 0) {
          setSymbols(list);
          if (!list.includes(activeSymbol)) {
            setActiveSymbol(list[0]);
          }
        }
      })
      .catch((err) => {
        console.warn('拉取 Symbol 列表失败:', err);
      });
  }, []);

  useEffect(() => {
    setHoveredCandle(null);
  }, [activeSymbol, activeTimeframe, replayDataContextKey]);

  // Paper Trade CRUD Actions
  const handleCreatePaperTrade = useCallback(
    async (
      tradeDraft: Omit<
        PaperTrade,
        'id' | 'createdAt' | 'closedAt'
      >
    ) => {
      if (await createPaperTrade(tradeDraft)) {
        setPendingPositionParams(null);
      }
    },
    [createPaperTrade]
  );

  const handleCreateTradeFromPosition = useCallback((params: PositionToolParams) => {
    setPendingPositionParams(params);
    setShowPaperPanel(true);
  }, []);
  const togglePaperPanel = useCallback(() => {
    setShowPaperPanel((visible) => !visible);
  }, []);
  const closePaperPanel = useCallback(() => {
    setShowPaperPanel(false);
  }, []);

  // Replay Actions
  const handleStartReplay = (symbol: string, startTimeMs: number) => {
    setActiveSymbol(symbol);
    setChartFocusTimeMs(startTimeMs);
    setReplayState({
      status: 'ready',
      context: {
        mode: 'free',
        symbol,
        anchorTimeMs: startTimeMs,
      },
      startTimeMs,
      progressTimeMs: startTimeMs,
      cursorTimeMs: startTimeMs,
      speed: 1,
    });
  };

  const handleStopReplay = () => {
    setChartFocusTimeMs(null);
    setReplayState({ status: 'idle' });
  };

  const handleDoubleClickTime = useCallback(
    (timestampMs: number) => {
      const intervalMs = timeframeMs(activeTimeframe);
      // The right-side padding may extend beyond the current time.  Replay
      // cannot start in the future, so keep that edge on the latest valid
      // instant while preserving the exact clicked period for past data.
      const cutInTimeMs = Math.min(timestampMs + intervalMs, Date.now());
      setChartFocusTimeMs(cutInTimeMs - intervalMs);
      setReplayState({
        status: 'ready',
        context: {
          mode: 'free',
          symbol: activeSymbol,
          anchorTimeMs: cutInTimeMs,
        },
        startTimeMs: cutInTimeMs,
        progressTimeMs: cutInTimeMs,
        cursorTimeMs: cutInTimeMs,
        speed: 1,
      });
    },
    [activeSymbol, activeTimeframe]
  );

  const handleNextBar = useCallback(() => {
    if (replayState.status === 'idle') return;
    const nextCursorMs = getNextCursorTimeMs(
      candles,
      replayState.cursorTimeMs,
      activeTimeframe
    );
    if (nextCursorMs === replayState.cursorTimeMs) {
      const resumePlayback = replayState.status === 'playing';
      setReplayState((prev) =>
        prev.status === 'idle' ? prev : { ...prev, status: 'paused' }
      );
      void prefetchFutureCandles().then((addedCount) => {
        if (addedCount < 0) return;
        setReplayState((prev) => {
          if (prev.status === 'idle') return prev;
          return {
            ...prev,
            status:
              addedCount > 0
                ? resumePlayback
                  ? 'playing'
                  : 'paused'
                : 'completed',
          };
        });
      });
      return;
    }

    // Check TP/SL trigger on new candle
    const nextCandle = findCandleCompletingAt(
      candles,
      nextCursorMs,
      activeTimeframe
    );
    if (nextCandle) {
      checkOpenTradesTriggers(nextCandle);
    }

    setReplayState((prev) => {
      if (prev.status === 'idle') return prev;
      return {
        ...prev,
        status: prev.status === 'completed' ? 'paused' : prev.status,
        cursorTimeMs: nextCursorMs,
        progressTimeMs: Math.max(prev.progressTimeMs, nextCursorMs),
      };
    });

    if (shouldPrefetchFuture(candles, nextCursorMs, activeTimeframe)) {
      void prefetchFutureCandles();
    }
  }, [
    activeTimeframe,
    candles,
    replayState,
    prefetchFutureCandles,
    checkOpenTradesTriggers,
  ]);

  const handlePrevBar = useCallback(() => {
    if (replayState.status === 'idle') return;
    const prevCursorMs = getPrevCursorTimeMs(
      candles,
      replayState.cursorTimeMs,
      replayState.startTimeMs,
      activeTimeframe
    );
    setReplayState((prev) => {
      if (prev.status === 'idle') return prev;
      return {
        ...prev,
        cursorTimeMs: prevCursorMs,
      };
    });
  }, [activeTimeframe, candles, replayState]);

  const handleTogglePlay = useCallback(() => {
    setReplayState((prev) => {
      if (prev.status === 'idle') return prev;
      const nextStatus = prev.status === 'playing' ? 'paused' : 'playing';
      return { ...prev, status: nextStatus };
    });
  }, []);

  const handleSetSpeed = useCallback((speed: number) => {
    setReplayState((prev) => {
      if (prev.status === 'idle') return prev;
      return { ...prev, speed };
    });
  }, []);

  // Timer Effect for Playing Replay
  useEffect(() => {
    if (replayState.status !== 'playing') return;

    const speed = replayState.speed;
    const intervalMs = Math.max(100, Math.floor(1000 / speed));
    const timer = setInterval(() => {
      handleNextBar();
    }, intervalMs);

    return () => {
      clearInterval(timer);
    };
  }, [replayState, handleNextBar]);

  const handleAddSymbol = async () => {
    if (!newSymbolInput.trim()) return;
    const clean = newSymbolInput.trim().toUpperCase();
    try {
      const addedSymbol = await addCustomSymbol(clean);
      setSymbols((current) =>
        current.includes(addedSymbol)
          ? current
          : [...current, addedSymbol]
      );
      handleSymbolChange(addedSymbol);
      setNewSymbolInput('');
      setShowAddSymbol(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : '添加 Symbol 失败');
    }
  };

  // Build System Markers for Video Review
  const videoReplayContext =
    replayState.status !== 'idle' &&
    replayState.context.mode === 'video'
      ? replayState.context
      : null;
  const systemMarkers = useMemo(() => {
    if (videoReplayContext) {
      return [
        buildVideoPublishedMarker(
          videoReplayContext.anchorTimeMs,
          videoReplayContext.title,
          candles,
          activeTimeframe
        ),
      ];
    }
    return [];
  }, [activeTimeframe, candles, videoReplayContext]);

  // Determine Visible Candles for Chart Canvas
  const replayCursorTimeMs =
    replayState.status === 'idle' ? null : replayState.cursorTimeMs;
  const visibleCandles = useMemo(
    () =>
      replayCursorTimeMs !== null
        ? filterVisibleCandles(
            candles,
            replayCursorTimeMs,
            activeTimeframe
          )
        : candles,
    [activeTimeframe, candles, replayCursorTimeMs]
  );

  const displayCandle =
    hoveredCandle || (visibleCandles.length > 0 ? visibleCandles[visibleCandles.length - 1] : null);
  const readoutInfo: ReadoutInfo | null = useMemo(
    () => computeReadoutInfo(displayCandle),
    [displayCandle]
  );

  const selectedDrawing = useMemo(
    () => drawings.find((drawing) => drawing.id === selectedDrawingId),
    [drawings, selectedDrawingId]
  );
  const selectedLocked = Boolean(selectedDrawing?.locked);

  // Extract selected position parameters if user selected a long/short position drawing
  const selectedPositionInfo: PositionToolParams | null = useMemo(() => {
    if (!selectedDrawing) return null;
    const type = selectedDrawing.toolType;
    if (type !== 'long-position' && type !== 'short-position' && type !== 'LongPosition' && type !== 'ShortPosition') {
      return null;
    }
    const pts = selectedDrawing.points;
    if (pts.length < 2) return null;

    const isLong = type === 'long-position' || type === 'LongPosition';
    const entryPrice = pts[0].price;
    const targetPrice = pts[1].price;
    const stopPrice = pts.length >= 3 ? pts[2].price : pts[0].price * (isLong ? 0.98 : 1.02);

    const rrRatio = calculateRR(isLong ? 'LONG' : 'SHORT', entryPrice, targetPrice, stopPrice);

    return {
      type: isLong ? 'LONG' : 'SHORT',
      entryPrice,
      tpPrice: targetPrice,
      slPrice: stopPrice,
      rrRatio,
    };
  }, [selectedDrawing]);

  const activeVideoTitle = videoReplayContext?.title || null;

  return (
    <div className="review-workspace">
      <DraggableDrawingToolbar
        activeTool={activeTool}
        magnetEnabled={magnetEnabled}
        selectedDrawingId={selectedDrawingId}
        selectedLocked={selectedLocked}
        selectedPositionInfo={selectedPositionInfo}
        onSelectTool={setActiveTool}
        onToggleMagnet={toggleMagnet}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onToggleLock={handleToggleLockSelected}
        onDeleteSelected={handleDeleteSelectedDrawing}
        onClearAll={handleClearAllDrawings}
        onOpenPaperTrading={togglePaperPanel}
        onCreatePaperTradeFromPosition={handleCreateTradeFromPosition}
      />

      {showPaperPanel && (
        <PaperTradingPanel
          symbol={activeSymbol}
          currentPrice={displayCandle?.close || 0}
          trades={paperTrades}
          pendingPositionParams={pendingPositionParams}
          onClosePanel={closePaperPanel}
          onCreateTrade={handleCreatePaperTrade}
          onCloseTrade={handleClosePaperTrade}
          onDeleteTrade={handleDeletePaperTrade}
        />
      )}

      {activeVideoTitle && (
        <div className="review-video-banner">
          <Video size={14} color="var(--accent-blue)" />
          <span>正在复盘视频: {activeVideoTitle}</span>
        </div>
      )}

      <div className="review-toolbar">
        <div className="review-toolbar-left">
          <select
            className="review-symbol-select"
            value={activeSymbol}
            onChange={(e) => handleSymbolChange(e.target.value)}
          >
            {symbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>

          {showAddSymbol ? (
            <div className="review-add-symbol">
              <input
                type="text"
                value={newSymbolInput}
                onChange={(e) => setNewSymbolInput(e.target.value)}
                placeholder="例如: ETHUSDT"
                onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()}
              />
              <button type="button" className="ui-btn ui-btn-primary" onClick={handleAddSymbol}>
                确定
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="ui-btn"
              onClick={() => setShowAddSymbol(true)}
              title="添加自定义 Symbol"
              aria-label="添加自定义 Symbol"
            >
              <Plus size={14} />
            </button>
          )}

          <div className="ui-divider-v" />

          <div className="tf-segment" role="group" aria-label="K线周期">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                className={activeTimeframe === tf ? 'active' : ''}
                onClick={() => handleTimeframeChange(tf)}
              >
                {TIMEFRAME_DISPLAY_MAP[tf]}
              </button>
            ))}
          </div>

          <div className="ui-divider-v" />

          <FreeReplayPanel
            replayState={replayState}
            activeSymbol={activeSymbol}
            activeTimeframe={activeTimeframe}
            onStartReplay={handleStartReplay}
            onStopReplay={handleStopReplay}
            onNextBar={handleNextBar}
            onPrevBar={handlePrevBar}
            onTogglePlay={handleTogglePlay}
            onSetSpeed={handleSetSpeed}
          />
        </div>

        <div className="review-toolbar-right">
          <button
            type="button"
            className={`ui-btn ${showPaperPanel ? 'ui-btn-active' : ''}`}
            onClick={togglePaperPanel}
          >
            <Target size={13} />
            <span>
              模拟交易 {paperTrades.length > 0 && `(${paperTrades.length})`}
            </span>
          </button>

          <button
            type="button"
            className={`ui-btn ${isLogScale ? 'ui-btn-active' : ''}`}
            onClick={() => setIsLogScale(!isLogScale)}
          >
            LOG 对数坐标
          </button>
        </div>
      </div>

      <ChartReadoutBar
        symbol={activeSymbol}
        timeframe={activeTimeframe}
        readout={readoutInfo}
      />

      {offlineWarning && (
        <div className="review-banner-warning">
          <AlertCircle size={14} />
          <span>{offlineWarning}</span>
        </div>
      )}

      {error && (
        <div className="review-banner-error">
          <AlertCircle size={14} />
          <span>加载失败: {error}</span>
        </div>
      )}

      <div className="review-chart-area">
        {loading && candles.length === 0 && (
          <div className="review-chart-loading">
            <RefreshCw size={20} className="spin" color="var(--accent-blue)" />
            <span>加载 K 线数据中...</span>
          </div>
        )}
        {loading && candles.length > 0 && (
          <div className="review-chart-loading-chip">
            <RefreshCw size={14} className="spin" color="var(--accent-blue)" />
            <span>正在切换周期...</span>
          </div>
        )}

        <ChartCanvas
          candles={visibleCandles}
          symbol={activeSymbol}
          interval={activeTimeframe}
          isLogScale={isLogScale}
          themeMode={themeMode}
          focusTimeMs={chartFocusTimeMs}
          systemMarkers={systemMarkers}
          onCrosshairMove={setHoveredCandle}
          onDoubleClickTime={handleDoubleClickTime}
          onLoadEarlier={handleLoadEarlier}
          isLoadingEarlier={isLoadingEarlier}
          drawings={drawings}
          activeDrawingTool={activeTool}
          selectedDrawingId={selectedDrawingId}
          magnetEnabled={magnetEnabled}
          drawingVideoId="__global__"
          onSelectDrawing={setSelectedDrawingId}
          onSaveDrawing={handleSaveDrawingState}
          onDrawingComplete={() => setActiveTool('select')}
          showVolume
        />
      </div>
    </div>
  );
}

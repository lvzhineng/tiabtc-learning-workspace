import { TradingSessionControl } from '@/chart/TradingSessionControl';
import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react';
import type { ReviewSession, ReviewSessionState } from '@/api/review-session-api';
import type { ReviewArchiveSnapshot } from './ReviewSessionWorkspace';
import { serializeDrawing } from '@/features/drawings/drawing-engine';
import {
  REVIEW_TIMEFRAMES,
  TIMEFRAME_DISPLAY_MAP,
  type ReviewTimeframe,
} from '@/domain/timeframe';
import { formatChartTime, timeframeMs } from '@/chart/chart-time';
import type { Candlestick } from '@/domain/candle';
import {
  fetchSymbols,
  addCustomSymbol,
  type PerpetualSymbolSearchItem,
} from '@/api/market-api';
import { ChartCanvas } from '@/chart/ChartCanvas';
import { CFD_SYMBOLS, fetchCfdCatalog, type CfdSymbol } from '@/api/cfd-api';
import { CfdSymbolPicker } from './CfdSymbolPicker';
import { captureChartPng } from '@/chart/capture-chart-png';
import { candlePricePrecision } from '@/chart/chart-price';
import { computeReadoutInfo, type ReadoutInfo } from '@/chart/candlestick-readout';
import type { ReplayState } from '@/features/replay/replay-state';
import {
  filterVisibleCandles,
  findCandleCompletingAt,
  getNextCursorTimeMs,
  shouldPrefetchFuture,
} from '@/features/replay/free-replay-logic';
import { FreeReplayPanel } from '@/features/replay/FreeReplayPanel';
import { RandomReplayControl } from '@/features/replay/RandomReplayControl';
import { US_DAY_TIMEFRAMES, type UsDayReplay } from '@/features/replay/us-day-replay';
import { ReplayBookmarks } from '@/features/replay/ReplayBookmarks';
import { DraggableDrawingToolbar } from '@/features/drawings/DraggableDrawingToolbar';
import { DrawingObjectTreePanel } from '@/features/drawings/DrawingObjectTreePanel';
import type { VideoReviewContext } from '@/domain/review-context';
import { buildVideoPublishedMarker } from '@/chart/system-marker';
import type { PositionToolParams } from '@/features/paper-trading/paper-trade-types';
import type { PaperTrade } from '@/domain/paper-trade';
import { calculateRR } from '@/features/paper-trading/paper-trade-logic';
import { PaperTradingPanel } from '@/features/paper-trading/PaperTradingPanel';
import { useCandleWorkspaceData } from './useCandleWorkspaceData';
import { useReplayPartialCandle } from './useReplayPartialCandle';
import { usePreviousDayCandles } from './usePreviousDayCandles';
import { useDrawingWorkspace } from './useDrawingWorkspace';
import { usePaperTrading } from './usePaperTrading';
import { ChartReadoutBar } from './ChartReadoutBar';
import { PerpetualSymbolSearchDialog } from './PerpetualSymbolSearchDialog';
import {
  readLocalUiState,
  writeLocalUiState,
} from '@/ui/persistence/local-ui-state';
import { toast } from '@/ui/feedback/toast';
import {
  AlertCircle,
  ChevronDown,
  Copy,
  Download,
  RefreshCw,
  Search,
  Video,
  Target,
} from 'lucide-react';
import '@/styles/review-workspace.css';

import {
  REVIEW_UI_STORAGE_KEY, REVIEW_LOCATION_STORAGE_KEY, DEFAULT_REVIEW_VISIBLE_SPAN,
  normalizeReviewVisibleSpan, loadReviewUiPreferences, loadStoredReviewLocation,
  saveStoredReviewLocation, type StoredFreeReplay, type StoredReviewLocation,
} from './review-ui-state';

interface ChartWorkspaceProps {
  initialVideoContext?: VideoReviewContext | null;
  themeMode?: 'dark' | 'light';
  market?: 'perpetual' | 'cfd';
  initialSession?: ReviewSession | null;
  archiveControls?: ReactNode;
  onArchiveSnapshotChange?: (snapshot: ReviewArchiveSnapshot) => void;
  onBeginArchive?: (state: ReviewSessionState) => Promise<void>;
  archiveBusy?: boolean;
}

export function ChartWorkspace({
  initialVideoContext,
  themeMode = 'dark',
  market = 'perpetual',
  initialSession = null,
  archiveControls,
  onArchiveSnapshotChange,
  onBeginArchive,
  archiveBusy = false,
}: ChartWorkspaceProps) {
  const isCfd = market === 'cfd';
  const workspaceRootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    workspaceRootRef.current?.toggleAttribute('inert', archiveBusy);
    if (archiveBusy) setReplayState((current) => current.status === 'playing' ? { ...current, status: 'paused' } : current);
  }, [archiveBusy]);
  const [retiredGc] = useState(() => !isCfd && readLocalUiState(REVIEW_UI_STORAGE_KEY).symbol === 'GC');
  const [initialLocation] = useState<StoredReviewLocation | null>(
    () => initialSession ? {
      timeframe: initialSession.state.timeframe, timestampMs: initialSession.state.timestampMs,
      visibleSpan: initialSession.state.visibleSpan, replay: initialSession.state.replay,
    } : loadStoredReviewLocation(market)
  );
  const [initialUiPreferences] = useState(() => ({ ...loadReviewUiPreferences(market), ...initialSession?.state }));
  useEffect(() => {
    if (retiredGc) writeLocalUiState(REVIEW_LOCATION_STORAGE_KEY, {});
  }, [retiredGc]);
  const restoredTimestampMs = initialSession ? initialSession.state.timestampMs : initialVideoContext
    ? null
    : initialLocation?.timestampMs ?? null;
  const restoredFreeReplay = initialSession ? initialSession.state.replay : initialVideoContext
    ? null
    : initialLocation?.replay ?? null;
  const restoredFocusTimeMs = restoredFreeReplay && initialLocation
    ? restoredFreeReplay.cursorTimeMs - (initialSession ? 1 : timeframeMs(initialLocation.timeframe))
    : restoredTimestampMs;
  const [symbols, setSymbols] = useState<string[]>(isCfd ? CFD_SYMBOLS.map((item) => item.symbol) : ['BTCUSDT']);
  const [cfdSymbols, setCfdSymbols] = useState<CfdSymbol[]>(CFD_SYMBOLS);
  const [catalogLoading, setCatalogLoading] = useState(isCfd);
  const [catalogWarning, setCatalogWarning] = useState<string | null>(null);
  const [catalogTrusted, setCatalogTrusted] = useState(false);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [activeSymbol, setActiveSymbol] = useState<string>(
    initialVideoContext?.symbol || initialUiPreferences.symbol
  );
  const [activeTimeframe, setActiveTimeframe] = useState<ReviewTimeframe>(
    initialLocation?.timeframe || '60'
  );
  const [isLogScale, setIsLogScale] = useState<boolean>(
    initialUiPreferences.isLogScale
  );
  const [sessionBands, setSessionBands] = useState(
    initialUiPreferences.sessionBands
  );
  const [showWeekendBands, setShowWeekendBands] = useState(
    initialUiPreferences.showWeekendBands
  );
  const [showBarCount, setShowBarCount] = useState(initialUiPreferences.showBarCount);
  const [chartFocusTimeMs, setChartFocusTimeMs] = useState<number | null>(
    restoredFocusTimeMs
  );
  const [timeframeSwitchAnchorTimeMs, setTimeframeSwitchAnchorTimeMs] =
    useState<number | null>(restoredFocusTimeMs);
  const lastPositionTimeMsRef = useRef<number | null>(
    restoredTimestampMs
  );
  const lastVisibleSpanRef = useRef(
    initialLocation?.visibleSpan ?? DEFAULT_REVIEW_VISIBLE_SPAN
  );
  const pendingLocationRef = useRef<StoredReviewLocation | null>(null);
  const persistLocationTimerRef = useRef<number | null>(null);
  const replayMemoryRef = useRef<StoredFreeReplay | null>(restoredFreeReplay);
  const [archiveViewport, setArchiveViewport] = useState(() => ({
    timestampMs: restoredTimestampMs ?? Date.now(),
    visibleSpan: initialLocation?.visibleSpan ?? DEFAULT_REVIEW_VISIBLE_SPAN,
  }));

  const flushStoredReviewLocation = useCallback(() => {
    if (persistLocationTimerRef.current !== null) {
      window.clearTimeout(persistLocationTimerRef.current);
      persistLocationTimerRef.current = null;
    }
    if (pendingLocationRef.current) {
      saveStoredReviewLocation(pendingLocationRef.current, market);
      pendingLocationRef.current = null;
    }
  }, [market]);

  const scheduleStoredReviewLocation = useCallback(
    (
      timeframe: ReviewTimeframe,
      timestampMs: number,
      visibleSpan = lastVisibleSpanRef.current,
      replay = replayMemoryRef.current
    ) => {
      if (!Number.isFinite(timestampMs) || timestampMs <= 0) return;
      const normalizedVisibleSpan = normalizeReviewVisibleSpan(visibleSpan);
      lastVisibleSpanRef.current = normalizedVisibleSpan;
      pendingLocationRef.current = {
        timeframe,
        timestampMs: Math.round(timestampMs),
        visibleSpan: normalizedVisibleSpan,
        replay,
      };
      if (persistLocationTimerRef.current !== null) return;
      persistLocationTimerRef.current = window.setTimeout(
        flushStoredReviewLocation,
        250
      );
    },
    [flushStoredReviewLocation]
  );

  useEffect(() => {
    window.addEventListener('pagehide', flushStoredReviewLocation);
    return () => {
      window.removeEventListener('pagehide', flushStoredReviewLocation);
      flushStoredReviewLocation();
    };
  }, [flushStoredReviewLocation]);

  useEffect(() => {
    writeLocalUiState(isCfd ? 'tiabtc-cfd-ui-v1' : REVIEW_UI_STORAGE_KEY, {
      symbol: initialVideoContext ? initialUiPreferences.symbol : activeSymbol,
      isLogScale,
      sessionBands,
      showWeekendBands,
      showEma20: initialUiPreferences.showEma20,
      showBarCount,
    });
  }, [
    activeSymbol,
    initialUiPreferences.symbol,
    initialUiPreferences.showEma20,
    initialVideoContext,
    isLogScale,
    sessionBands,
    showWeekendBands,
    showBarCount,
    isCfd,
  ]);

  const [hoveredCandle, setHoveredCandle] = useState<Candlestick | null>(null);
  const [copyingChart, setCopyingChart] = useState(false);
  const [exportingChart, setExportingChart] = useState(false);
  const chartAreaRef = useRef<HTMLDivElement | null>(null);

  const [showSymbolSearch, setShowSymbolSearch] = useState<boolean>(false);

  // Paper Trading State
  const [showPaperPanel, setShowPaperPanel] = useState<boolean>(false);
  const [pendingPositionParams, setPendingPositionParams] = useState<PositionToolParams | null>(null);

  // Replay State Machine
  const [replayState, setReplayState] = useState<ReplayState>(() => {
    if (initialVideoContext && !initialSession) {
      return {
        status: 'ready',
        context: initialVideoContext,
        startTimeMs: initialVideoContext.anchorTimeMs,
        progressTimeMs: initialVideoContext.anchorTimeMs,
        cursorTimeMs: initialVideoContext.anchorTimeMs,
        speed: 1,
      };
    }
    if (restoredFreeReplay) {
      return {
        status: restoredFreeReplay.daySession && restoredFreeReplay.cursorTimeMs >= restoredFreeReplay.daySession.toMs ? 'completed' : 'paused',
        context: initialSession?.state.videoContext ?? {
          mode: 'free',
          symbol: activeSymbol,
          anchorTimeMs: restoredFreeReplay.startTimeMs,
        },
        startTimeMs: restoredFreeReplay.startTimeMs,
        progressTimeMs: restoredFreeReplay.cursorTimeMs,
        cursorTimeMs: restoredFreeReplay.cursorTimeMs,
        speed: restoredFreeReplay.speed,
        ...(isCfd && restoredFreeReplay.daySession ? { daySession: restoredFreeReplay.daySession } : {}),
      };
    }
    return { status: 'idle' };
  });
  const daySession = isCfd && replayState.status !== 'idle' ? replayState.daySession : undefined;

  useEffect(() => {
    if (replayState.status === 'idle') return;
    replayMemoryRef.current =
      replayState.context.mode === 'free'
        ? {
            startTimeMs: replayState.startTimeMs,
            cursorTimeMs: replayState.cursorTimeMs,
            speed: replayState.speed,
            ...(replayState.daySession ? { daySession: replayState.daySession } : {}),
          }
        : null;
    lastPositionTimeMsRef.current = replayState.cursorTimeMs;
    scheduleStoredReviewLocation(activeTimeframe, replayState.cursorTimeMs);
  }, [activeTimeframe, replayState, scheduleStoredReviewLocation]);

  const handleViewportAnchorChange = useCallback(
    (timestampMs: number, visibleSpan: number) => {
      lastPositionTimeMsRef.current = timestampMs;
      setArchiveViewport({ timestampMs, visibleSpan: normalizeReviewVisibleSpan(visibleSpan) });
      scheduleStoredReviewLocation(
        activeTimeframe,
        timestampMs,
        visibleSpan
      );
    },
    [activeTimeframe, scheduleStoredReviewLocation]
  );

  const {
    candles,
    loading,
    isLoadingEarlier,
    isLoadingLater,
    offlineWarning,
    error,
    loadEarlier: handleLoadEarlier,
    loadLater: handleLoadLater,
    retryLoad: handleRetryLoad,
    prefetchFuture: prefetchFutureCandles,
    previousReplayCursor,
  } = useCandleWorkspaceData(
    activeSymbol,
    activeTimeframe,
    replayState,
    timeframeSwitchAnchorTimeMs,
    market
  );
  // Gate serializes public requests; give today's candles priority.
  const previousDay = usePreviousDayCandles(activeSymbol, activeTimeframe, daySession?.date ?? null,
    !loading);

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

  // A newly listed symbol can inherit a historical cursor from the previous
  // chart. If the loaded bars all start after that cursor, drop the stale
  // focus so the live tip is visible.
  useEffect(() => {
    if (replayState.status !== 'idle' || loading || candles.length === 0 || chartFocusTimeMs === null) {
      return;
    }
    if (chartFocusTimeMs >= candles[0].timestampMs) {
      return;
    }
    const latestTimeMs = candles[candles.length - 1].timestampMs;
    setChartFocusTimeMs(null);
    setTimeframeSwitchAnchorTimeMs(null);
    lastPositionTimeMsRef.current = latestTimeMs;
    scheduleStoredReviewLocation(activeTimeframe, latestTimeMs);
  }, [
    activeTimeframe,
    candles,
    chartFocusTimeMs,
    loading,
    scheduleStoredReviewLocation,
    replayState.status,
  ]);

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
    saveDrawingState: handleSaveDrawingState,
    deleteSelectedDrawing: handleDeleteSelectedDrawing,
    clearAllDrawings: handleClearAllDrawings,
    toggleLockSelected: handleToggleLockSelected,
    undo: handleUndo,
    redo: handleRedo,
    flushDrawingSaves,
    savingDrawings,
  } = useDrawingWorkspace(activeSymbol, activeTimeframe,
    initialSession ? 'session' : isCfd ? 'cfd' : 'server',
    initialSession ? { reviewSessionId: initialSession.id } : undefined,
    archiveBusy
  );
  const archiveState = useMemo<ReviewSessionState>(() => ({
    symbol: activeSymbol, timeframe: activeTimeframe,
    timestampMs: Math.min(Date.now(), replayState.status === 'idle'
      ? archiveViewport.timestampMs : replayState.cursorTimeMs),
    visibleSpan: archiveViewport.visibleSpan,
    replay: replayState.status === 'idle' ? null : {
      startTimeMs: replayState.startTimeMs, cursorTimeMs: replayState.cursorTimeMs, speed: replayState.speed,
      ...(replayState.daySession ? { daySession: replayState.daySession } : {}),
    },
    isLogScale, sessionBands, showWeekendBands,
    videoContext: replayState.status !== 'idle' && replayState.context.mode === 'video' ? replayState.context : null,
  }), [activeSymbol, activeTimeframe, archiveViewport, replayState, isLogScale, sessionBands, showWeekendBands]);
  useEffect(() => {
    onArchiveSnapshotChange?.({
      state: archiveState, drawings: allDrawings.map(serializeDrawing),
      ready: drawingReady && !loading, flushDrawings: flushDrawingSaves, savingDrawings,
    });
  }, [archiveState, allDrawings, drawingReady, loading, flushDrawingSaves, savingDrawings, onArchiveSnapshotChange]);
  const handleDrawingComplete = useCallback(() => {
    setActiveTool('select');
  }, [setActiveTool]);
  const {
    trades: paperTrades,
    createTrade: createPaperTrade,
    closeTrade: handleClosePaperTrade,
    removeTrade: handleDeletePaperTrade,
    checkTriggers: checkOpenTradesTriggers,
  } = usePaperTrading(activeSymbol, activeTimeframe, replayState, !isCfd);
  const replayDataContextKey =
    replayState.status === 'idle'
      ? 'live'
      : `${replayState.context.mode}:${replayState.startTimeMs}`;

  const handleTimeframeChange = useCallback(
    (nextTimeframe: ReviewTimeframe) => {
      if (daySession && !US_DAY_TIMEFRAMES.includes(nextTimeframe)) return;
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
        drawingAnchorTimeMs ??
        replayAnchorTimeMs ??
        lastPositionTimeMsRef.current ??
        chartFocusTimeMs ??
        null;
      setTimeframeSwitchAnchorTimeMs(anchorTimeMs);
      setChartFocusTimeMs(anchorTimeMs);
      setActiveTimeframe(nextTimeframe);
      scheduleStoredReviewLocation(nextTimeframe, anchorTimeMs ?? Date.now());
    },
    [
      activeTimeframe,
      daySession,
      chartFocusTimeMs,
      drawings,
      replayState,
      scheduleStoredReviewLocation,
      selectedDrawingId,
    ]
  );

  const handleSymbolChange = useCallback(
    (nextSymbol: string, options?: { resetToLatest?: boolean }) => {
      if (nextSymbol === activeSymbol) return;
      if (initialSession && onBeginArchive) {
        void onBeginArchive({
          ...archiveState, symbol: nextSymbol, videoContext: null,
          timestampMs: options?.resetToLatest && replayState.status === 'idle' ? Date.now() : archiveState.timestampMs,
          replay: archiveState.replay ? {
            ...archiveState.replay, startTimeMs: archiveState.replay.cursorTimeMs,
          } : null,
          ...(daySession ? { replay: null } : {}),
        });
        return;
      }
      if (isCfd) {
        if (daySession) replayMemoryRef.current = null;
        setReplayState((current) => current.status === 'idle' || current.daySession ? { status: 'idle' } : {
          ...current,
          status: 'paused',
          context: { mode: 'free', symbol: nextSymbol, anchorTimeMs: current.startTimeMs },
        });
      }
      const resetToLatest =
        options?.resetToLatest === true && replayState.status === 'idle';
      if (resetToLatest) {
        const latestTimeMs = Date.now();
        setTimeframeSwitchAnchorTimeMs(null);
        setChartFocusTimeMs(null);
        lastPositionTimeMsRef.current = latestTimeMs;
        scheduleStoredReviewLocation(activeTimeframe, latestTimeMs);
        setActiveSymbol(nextSymbol);
        return;
      }
      const replayAnchorTimeMs =
        replayState.status === 'idle' ? null : replayState.cursorTimeMs;
      const anchorTimeMs =
        replayAnchorTimeMs ??
        lastPositionTimeMsRef.current ??
        chartFocusTimeMs ??
        null;
      setTimeframeSwitchAnchorTimeMs(anchorTimeMs);
      setChartFocusTimeMs(anchorTimeMs);
      lastPositionTimeMsRef.current = anchorTimeMs;
      if (anchorTimeMs !== null) {
        scheduleStoredReviewLocation(activeTimeframe, anchorTimeMs);
      }
      setActiveSymbol(nextSymbol);
    },
    [
      activeSymbol,
      activeTimeframe,
      chartFocusTimeMs,
      replayState,
      scheduleStoredReviewLocation,
      isCfd,
      initialSession,
      onBeginArchive,
      archiveState,
      daySession,
    ]
  );

  // Sync initialVideoContext if passed from parent
  useEffect(() => {
    if (initialVideoContext && !initialSession) {
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
  }, [initialVideoContext, initialSession]);

  // Load symbol list on mount
  useEffect(() => {
    let cancelled = false;
    if (isCfd) {
      setCatalogLoading(true);
      void fetchCfdCatalog(catalogRefresh > 0).then((catalog) => {
        if (cancelled) return;
        setCfdSymbols(catalog.symbols);
        setSymbols(catalog.symbols.map((item) => item.symbol));
        setCatalogWarning(catalog.warning);
        setCatalogTrusted(!catalog.stale && !catalog.warning);
      }).catch((cause: unknown) => {
        if (!cancelled) {
          setCatalogTrusted(false);
          setCatalogWarning(cause instanceof Error ? cause.message : '品种目录加载失败，使用已有目录');
        }
      }).finally(() => { if (!cancelled) setCatalogLoading(false); });
      return () => { cancelled = true; };
    }
    void fetchSymbols()
      .then((list) => {
        if (cancelled) return;
        if (list && list.length > 0) {
          setSymbols(list);
          setActiveSymbol((current) =>
            initialSession || list.includes(current) ? current : list[0]
          );
        }
      })
      .catch((err) => {
        console.warn('拉取 Symbol 列表失败:', err);
      });
    return () => { cancelled = true; };
  }, [isCfd, initialSession?.id, catalogRefresh]);

  useEffect(() => {
    // The server includes known historical scopes. A symbol absent from a
    // successful fresh directory and local history is an orphaned preference.
    // Offline/stale directories and archived sessions must retain their scope.
    if (!isCfd || catalogLoading || !catalogTrusted || initialSession ||
      cfdSymbols.some((item) => item.symbol === activeSymbol)) return;
    const fallback = cfdSymbols.find((item) => item.symbol === 'XAUUSD') ?? cfdSymbols[0];
    if (!fallback) return;
    const now = Date.now();
    replayMemoryRef.current = null;
    setReplayState({ status: 'idle' });
    setTimeframeSwitchAnchorTimeMs(null);
    setChartFocusTimeMs(null);
    lastPositionTimeMsRef.current = now;
    setActiveSymbol(fallback.symbol);
    scheduleStoredReviewLocation(activeTimeframe, now);
    toast.warning(`上次选择的品种已失效，已切换到 ${fallback.name}。`);
  }, [activeSymbol, activeTimeframe, catalogLoading, catalogTrusted, cfdSymbols, initialSession, isCfd, scheduleStoredReviewLocation]);

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
  const handleStartReplay = (symbol: string, startTimeMs: number, timeframe = activeTimeframe, session?: UsDayReplay) => {
    if (onBeginArchive) {
      void onBeginArchive({
        ...archiveState, symbol, timeframe, timestampMs: startTimeMs, videoContext: null,
        replay: { startTimeMs, cursorTimeMs: startTimeMs, speed: 1, ...(session ? { daySession: session } : {}) },
      });
      return;
    }
    setActiveSymbol(symbol);
    setActiveTimeframe(timeframe);
    setTimeframeSwitchAnchorTimeMs(null);
    lastPositionTimeMsRef.current = startTimeMs;
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
      ...(session ? { daySession: session } : {}),
    });
  };

  const handleStartReplayFromCurrentPosition = useCallback(() => {
    if (archiveBusy || loading || candles.length === 0) return;

    const firstCandleTimeMs = candles[0].timestampMs;
    const lastCandleTimeMs = candles[candles.length - 1].timestampMs;
    const requestedAnchorTimeMs =
      lastPositionTimeMsRef.current ?? chartFocusTimeMs ?? lastCandleTimeMs;
    const anchorTimeMs = Math.min(
      Date.now(), lastCandleTimeMs,
      Math.max(firstCandleTimeMs, requestedAnchorTimeMs)
    );
    const nextCursorTimeMs = Math.min(Date.now(), getNextCursorTimeMs(
      candles,
      anchorTimeMs,
      activeTimeframe
    ));

    if (onBeginArchive) {
      void onBeginArchive({
        ...archiveState, timestampMs: nextCursorTimeMs, videoContext: null,
        replay: { startTimeMs: anchorTimeMs, cursorTimeMs: nextCursorTimeMs, speed: 1 },
      });
      return;
    }

    setChartFocusTimeMs(anchorTimeMs);
    setReplayState({
      status: 'paused',
      context: {
        mode: 'free',
        symbol: activeSymbol,
        anchorTimeMs,
      },
      startTimeMs: anchorTimeMs,
      progressTimeMs: nextCursorTimeMs,
      cursorTimeMs: nextCursorTimeMs,
      speed: 1,
    });
  }, [activeSymbol, activeTimeframe, candles, chartFocusTimeMs, loading, archiveState, onBeginArchive, archiveBusy]);

  const handleStopReplay = () => {
    const lastReplayTimeMs =
      replayState.status === 'idle'
        ? lastPositionTimeMsRef.current
        : replayState.cursorTimeMs;
    replayMemoryRef.current = null;
    if (lastReplayTimeMs !== null) {
      scheduleStoredReviewLocation(
        activeTimeframe,
        lastReplayTimeMs,
        lastVisibleSpanRef.current,
        null
      );
    }
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
      if (daySession) {
        const cursor = Math.max(daySession.fromMs, Math.min(daySession.toMs, cutInTimeMs));
        setChartFocusTimeMs(cursor - intervalMs);
        setReplayState((current) => current.status === 'idle' ? current : {
          ...current, status: cursor === daySession.toMs ? 'completed' : 'paused',
          cursorTimeMs: cursor, progressTimeMs: Math.max(current.progressTimeMs, cursor),
        });
        return;
      }
      if (onBeginArchive) {
        void onBeginArchive({
          ...archiveState, timestampMs: cutInTimeMs, videoContext: null,
          replay: { startTimeMs: cutInTimeMs, cursorTimeMs: cutInTimeMs, speed: 1 },
        });
        return;
      }
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
    [activeSymbol, activeTimeframe, archiveState, onBeginArchive, daySession]
  );

  const handleNextBar = useCallback(() => {
    if (replayState.status === 'idle' || archiveBusy || loading) return;
    if (daySession && replayState.cursorTimeMs >= daySession.toMs) return;
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

    if (!isCfd && nextCursorMs - replayState.cursorTimeMs > timeframeMs(activeTimeframe)) {
      setReplayState((prev) => prev.status === 'idle' ? prev : { ...prev, status: 'paused' });
      toast.warning('当前复盘时间附近存在 K 线缺口，已暂停推进，请重试加载。');
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
        status: daySession && nextCursorMs >= daySession.toMs ? 'completed' : prev.status === 'completed' ? 'paused' : prev.status,
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
    isCfd,
    replayState,
    prefetchFutureCandles,
    checkOpenTradesTriggers,
    archiveBusy,
    loading,
    daySession,
  ]);

  const handlePrevBar = useCallback(() => {
    if (replayState.status === 'idle' || archiveBusy) return;
    const cursor = replayState.cursorTimeMs;
    const start = replayState.startTimeMs;
    setReplayState((prev) => prev.status === 'idle' ? prev : { ...prev, status: 'paused' });
    void previousReplayCursor().then((previous) => {
      if (previous === null) return;
      setReplayState((prev) => prev.status === 'idle' || prev.cursorTimeMs !== cursor || prev.startTimeMs !== start
        ? prev : { ...prev, status: 'paused', cursorTimeMs: previous });
    });
  }, [previousReplayCursor, replayState, archiveBusy]);

  const handleTogglePlay = useCallback(() => {
    if (archiveBusy) return;
    setReplayState((prev) => {
      if (prev.status === 'idle') return prev;
      if (prev.daySession && prev.cursorTimeMs >= prev.daySession.toMs) return prev;
      const nextStatus = prev.status === 'playing' ? 'paused' : 'playing';
      return { ...prev, status: nextStatus };
    });
  }, [archiveBusy]);

  const handleSetSpeed = useCallback((speed: number) => {
    setReplayState((prev) => {
      if (prev.status === 'idle') return prev;
      return { ...prev, speed };
    });
  }, []);

  const handleNextBarRef = useRef(handleNextBar);
  useEffect(() => {
    handleNextBarRef.current = handleNextBar;
  }, [handleNextBar]);
  const replaySpeed =
    replayState.status === 'idle' ? 1 : replayState.speed;

  // Keep one stable timer per speed instead of recreating it for every cursor
  // update during high-speed replay.
  useEffect(() => {
    if (replayState.status !== 'playing') return;

    const intervalMs = Math.max(100, Math.floor(1000 / replaySpeed));
    const timer = setInterval(() => {
      handleNextBarRef.current();
    }, intervalMs);

    return () => {
      clearInterval(timer);
    };
  }, [replaySpeed, replayState.status]);

  const handleSelectSymbol = useCallback(
    async (item: PerpetualSymbolSearchItem) => {
      const alreadyAdded = item.added || symbols.includes(item.symbol);
      const selectedSymbol = alreadyAdded
        ? item.symbol
        : await addCustomSymbol(item.symbol);
      setSymbols((current) =>
        current.includes(selectedSymbol)
          ? current
          : [...current, selectedSymbol]
      );
      handleSymbolChange(selectedSymbol, { resetToLatest: !alreadyAdded });
    },
    [handleSymbolChange, symbols]
  );

  useEffect(() => {
    const handleOpenSearchShortcut = (event: KeyboardEvent) => {
      if (
        isCfd ||
        event.defaultPrevented ||
        document.querySelector('[aria-modal="true"]')
      ) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowSymbolSearch(true);
      }
    };
    window.addEventListener('keydown', handleOpenSearchShortcut);
    return () => window.removeEventListener('keydown', handleOpenSearchShortcut);
  }, [isCfd]);

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
  const partialReplay = useReplayPartialCandle(
    activeSymbol, activeTimeframe, market, daySession ? null : replayCursorTimeMs, candles, loading
  );
  const revealedCandles = useMemo(
    () => {
      if (replayCursorTimeMs === null) return candles;
      const closed = filterVisibleCandles(candles, replayCursorTimeMs, activeTimeframe);
      if (daySession) return closed.filter((bar) => bar.interval === activeTimeframe &&
        bar.timestampMs >= daySession.fromMs && bar.timestampMs + timeframeMs(activeTimeframe) <= daySession.toMs);
      return partialReplay.candle ? [...closed, partialReplay.candle] : closed;
    },
    [activeTimeframe, candles, replayCursorTimeMs, partialReplay.candle, daySession]
  );
  // EMA and candles share this regular-session sequence; no overnight bars or hidden future bars.
  const visibleCandles = useMemo(() => daySession
    ? [...previousDay.candles, ...revealedCandles] : revealedCandles,
    [daySession, previousDay.candles, revealedCandles]);
  const visibleCandleMap = useMemo(
    () => new Map(visibleCandles.map((bar) => [bar.timestampMs, bar])),
    [visibleCandles]
  );
  const dayPriceRange = useMemo(() => {
    if (!daySession) return undefined;
    let minValue = Infinity;
    let maxValue = -Infinity;
    for (const bar of revealedCandles) {
      if (bar.interval !== activeTimeframe || bar.timestampMs < daySession.fromMs ||
          bar.timestampMs + timeframeMs(activeTimeframe) > daySession.toMs) continue;
      minValue = Math.min(minValue, bar.low);
      maxValue = Math.max(maxValue, bar.high);
    }
    for (const bar of previousDay.candles) {
      minValue = Math.min(minValue, bar.low);
      maxValue = Math.max(maxValue, bar.high);
    }
    return Number.isFinite(minValue) && Number.isFinite(maxValue) ? { minValue, maxValue } : undefined;
  }, [revealedCandles, activeTimeframe, daySession, previousDay.candles]);
  const displayCandle =
    (hoveredCandle ? visibleCandleMap.get(hoveredCandle.timestampMs) : null) ||
    (visibleCandles.length > 0 ? visibleCandles[visibleCandles.length - 1] : null);
  const candleCountdownMs = replayCursorTimeMs !== null && partialReplay.candle
    ? partialReplay.candle.timestampMs + timeframeMs(activeTimeframe) - replayCursorTimeMs
    : null;
  const copyChart = useCallback(async () => {
    if (!chartAreaRef.current || copyingChart) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      toast.error('当前浏览器不支持复制图片到剪贴板');
      return;
    }
    const chartTimeMs =
      hoveredCandle?.timestampMs ??
      lastPositionTimeMsRef.current ??
      visibleCandles[visibleCandles.length - 1]?.timestampMs;
    setCopyingChart(true);
    try {
      const png = captureChartPng(chartAreaRef.current, themeMode, {
        symbol: activeSymbol,
        time: chartTimeMs === undefined ? undefined : `北京时间 ${formatChartTime(chartTimeMs, activeTimeframe)}`,
        timeframe: TIMEFRAME_DISPLAY_MAP[activeTimeframe],
        source: isCfd ? 'Gate CFD' : 'Bybit',
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast.success('K 线图已复制到剪贴板');
    } catch (cause) {
      toast.error(
        `复制图表失败: ${cause instanceof Error ? cause.message : '浏览器拒绝了剪贴板操作'}`
      );
    } finally {
      setCopyingChart(false);
    }
  }, [activeSymbol, activeTimeframe, copyingChart, hoveredCandle, themeMode, visibleCandles, isCfd]);
  const exportChart = useCallback(async () => {
    if (!chartAreaRef.current || exportingChart) return;
    const chartTimeMs = hoveredCandle?.timestampMs ?? lastPositionTimeMsRef.current ??
      visibleCandles[visibleCandles.length - 1]?.timestampMs;
    setExportingChart(true);
    try {
      const png = await captureChartPng(chartAreaRef.current, themeMode, {
        symbol: activeSymbol,
        time: chartTimeMs === undefined ? undefined : `北京时间 ${formatChartTime(chartTimeMs, activeTimeframe)}`,
        timeframe: TIMEFRAME_DISPLAY_MAP[activeTimeframe],
        source: 'Gate CFD',
      });
      const url = URL.createObjectURL(png);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Gate-CFD-${activeSymbol}-${TIMEFRAME_DISPLAY_MAP[activeTimeframe]}-${Date.now()}.png`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('图表图片已导出');
    } catch (cause) {
      toast.error(`导出图片失败: ${cause instanceof Error ? cause.message : '图片生成失败'}`);
    } finally {
      setExportingChart(false);
    }
  }, [activeSymbol, activeTimeframe, exportingChart, hoveredCandle, themeMode, visibleCandles]);
  const cfdPricePrecision = isCfd ? cfdSymbols.find((item) => item.symbol === activeSymbol)?.pricePrecision : undefined;
  const pickerSymbols = useMemo(() => cfdSymbols.some((item) => item.symbol === activeSymbol)
    ? cfdSymbols : [...cfdSymbols, { symbol: activeSymbol, name: activeSymbol, categoryId: -1,
      categoryName: '历史品种', status: 'unavailable', isBase: true }], [activeSymbol, cfdSymbols]);
  const displayedPricePrecision = useMemo(
    () => cfdPricePrecision ?? candlePricePrecision(visibleCandles),
    [visibleCandles, cfdPricePrecision]
  );
  const readoutInfo: ReadoutInfo | null = useMemo(() => {
    if (!displayCandle) return null;
    return computeReadoutInfo(displayCandle, displayedPricePrecision);
  }, [displayCandle, displayedPricePrecision]);

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

  const drawingToolbar = <DraggableDrawingToolbar
        storageKey={isCfd ? 'tiabtc-cfd-drawing-toolbar-pos-v1' : undefined}
        disabled={!drawingReady}
        activeTool={activeTool}
        magnetEnabled={magnetEnabled}
        selectedDrawingId={selectedDrawingId}
        selectedLocked={selectedLocked}
        selectedPositionInfo={selectedPositionInfo}
        hideAllDrawings={hideAllDrawings}
        isObjectTreeOpen={isObjectTreeOpen}
        onSelectTool={setActiveTool}
        onToggleMagnet={toggleMagnet}
        onToggleHideAllDrawings={toggleHideAllDrawings}
        onToggleObjectTree={toggleObjectTree}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onToggleLock={handleToggleLockSelected}
        onDeleteSelected={handleDeleteSelectedDrawing}
        onClearAll={handleClearAllDrawings}
        onOpenPaperTrading={isCfd ? undefined : togglePaperPanel}
        onCreatePaperTradeFromPosition={isCfd ? undefined : handleCreateTradeFromPosition}
      />;

  return (
    <div ref={workspaceRootRef} aria-busy={archiveBusy} className={`review-workspace${isCfd ? ' review-workspace-cfd' : ''}`}>
      {!isCfd && showSymbolSearch && (
        <PerpetualSymbolSearchDialog
          activeSymbol={activeSymbol}
          savedSymbols={symbols}
          onClose={() => setShowSymbolSearch(false)}
          onSelectSymbol={handleSelectSymbol}
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
          {isCfd ? (
            <CfdSymbolPicker
              symbols={pickerSymbols}
              value={activeSymbol}
              onChange={handleSymbolChange}
              loading={catalogLoading}
              warning={catalogWarning}
              onRefresh={() => setCatalogRefresh((value) => value + 1)}
            />
          ) : <button
            type="button"
            className="review-symbol-trigger"
            onClick={() => setShowSymbolSearch(true)}
            aria-haspopup="dialog"
            aria-expanded={showSymbolSearch}
            title="搜索永续合约 (Ctrl+K)"
          >
            <Search size={14} />
            <span>{activeSymbol}</span>
            <ChevronDown size={13} />
          </button>}

          <div className="ui-divider-v" />

          <div className="tf-segment" role="group" aria-label="K线周期">
            {REVIEW_TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                className={activeTimeframe === tf ? 'active' : ''}
                disabled={Boolean(daySession && !US_DAY_TIMEFRAMES.includes(tf))}
                title={daySession && !US_DAY_TIMEFRAMES.includes(tf) ? '美股单日复盘支持1m、5m、15m；退出回放后可使用全部周期' : undefined}
                onClick={() => handleTimeframeChange(tf)}
              >
                {TIMEFRAME_DISPLAY_MAP[tf]}
              </button>
            ))}
          </div>

          <div className="ui-divider-v" />

          <RandomReplayControl
            key={`${market}:${activeSymbol}:${activeTimeframe}:${replayDataContextKey}`}
            market={market}
            symbol={activeSymbol}
            timeframe={activeTimeframe}
            disabled={loading}
            prefetchEnabled={!loading && !archiveBusy && !previousDay.loading}
            onBegin={() => setReplayState((current) => current.status === 'idle' ? current : { ...current, status: 'paused' })}
            onStart={handleStartReplay}
            onStartDay={(symbol, session) => handleStartReplay(symbol, session.fromMs,
              US_DAY_TIMEFRAMES.includes(activeTimeframe) ? activeTimeframe : '1', session)}
          />
          <FreeReplayPanel
            replayState={replayState}
            activeSymbol={activeSymbol}
            activeTimeframe={activeTimeframe}
            onStartReplay={handleStartReplay}
            onStartFromCurrentPosition={handleStartReplayFromCurrentPosition}
            onStopReplay={handleStopReplay}
            onNextBar={handleNextBar}
            onPrevBar={handlePrevBar}
            onTogglePlay={handleTogglePlay}
            onSetSpeed={handleSetSpeed}
          />
        </div>

        <div className="review-toolbar-right">
          {archiveControls}
          {!isCfd && <button
            type="button"
            className={`ui-btn ${showPaperPanel ? 'ui-btn-active' : ''}`}
            onClick={togglePaperPanel}
          >
            <Target size={13} />
            <span>
              模拟交易 {paperTrades.length > 0 && `(${paperTrades.length})`}
            </span>
          </button>}

          <details className="review-toolbar-more" onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              event.currentTarget.open = false;
              event.currentTarget.querySelector('summary')?.focus();
            }
          }}>
            <summary className="ui-btn" title="时间书签、交易时段和图表显示选项">
              更多 <ChevronDown size={13} />
            </summary>
            <div className="review-toolbar-options">
              <ReplayBookmarks market={market} symbol={activeSymbol} timeframe={activeTimeframe}
                timestampMs={loading ? null : replayState.status === 'idle'
                  ? hoveredCandle?.timestampMs ?? lastPositionTimeMsRef.current ?? candles[candles.length - 1]?.timestampMs ?? null
                  : replayState.cursorTimeMs}
                onJump={(bookmark) => {
                  setActiveTimeframe(bookmark.timeframe);
                  handleStartReplay(bookmark.symbol, bookmark.timestampMs, bookmark.timeframe);
                }} />
              <div className="review-toolbar-display-options">
                {isCfd && <button type="button" className={`ui-btn ${showBarCount ? 'ui-btn-active' : ''}`}
                  aria-pressed={showBarCount} disabled={!daySession}
                  onClick={() => setShowBarCount((shown) => !shown)}
                  title="美股单日复盘：纽约09:30起编号，显示2、4、6、8…；切周期后重新计数">
                  Bar count · 偶数
                </button>}
                {!daySession && <>
                <TradingSessionControl value={sessionBands} onChange={setSessionBands} />

                <button
                  type="button"
                  className={`ui-btn ${showWeekendBands ? 'ui-btn-active' : ''}`}
                  onClick={() => setShowWeekendBands((enabled) => !enabled)}
                  title="标注美盘周末（纽约周六 00:00–周一 00:00，自动适配夏令时）"
                  aria-pressed={showWeekendBands}
                >
                  周末时段
                </button>
                </>}

                <button
                  type="button"
                  className={`ui-btn ${isLogScale ? 'ui-btn-active' : ''}`}
                  onClick={() => setIsLogScale(!isLogScale)}
                  aria-pressed={isLogScale}
                >
                  LOG 对数坐标
                </button>
              </div>
            </div>
          </details>
        </div>
      </div>

      <ChartReadoutBar
        symbol={activeSymbol}
        timeframe={activeTimeframe}
        readout={readoutInfo}
        showVolume={!isCfd}
      />

      {offlineWarning && (
        <div className="review-banner-warning">
          <AlertCircle size={14} />
          <span>{offlineWarning}</span>
          <button
            type="button"
            className="review-retry-btn"
            onClick={handleRetryLoad}
            disabled={loading}
          >
            重试
          </button>
        </div>
      )}

      {error && (
        <div className="review-banner-error">
          <AlertCircle size={14} />
          <span>加载失败: {error}</span>
          <button type="button" className="review-retry-btn" onClick={handleRetryLoad}>
            重试
          </button>
        </div>
      )}

      <div ref={chartAreaRef} className="review-chart-area">
        {drawingToolbar}
        {isObjectTreeOpen && (
          <DrawingObjectTreePanel
            drawings={allDrawings}
            selectedDrawingId={selectedDrawingId}
            hiddenDrawingIds={hiddenDrawingIds}
            onSelectDrawing={setSelectedDrawingId}
            onToggleHideDrawing={toggleHideDrawing}
            onToggleLockDrawing={toggleLockDrawing}
            onDeleteDrawing={deleteDrawingById}
            onClearAllDrawings={handleClearAllDrawings}
            onClose={toggleObjectTree}
          />
        )}
        {!isCfd && showPaperPanel && (
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
        <button
          type="button"
          className="ui-btn review-copy-chart"
          onClick={copyChart}
          disabled={copyingChart || loading || visibleCandles.length === 0}
          title="复制当前 K 线图到剪贴板"
        >
          {copyingChart ? <RefreshCw size={13} className="spin" /> : <Copy size={13} />}
          <span>{copyingChart ? '复制中' : '复制图表'}</span>
        </button>
        {isCfd && <button
          type="button"
          className="ui-btn review-copy-chart review-export-chart"
          onClick={exportChart}
          disabled={exportingChart || loading || visibleCandles.length === 0}
          title="下载当前 K 线图为 PNG 图片"
        >
          {exportingChart ? <RefreshCw size={13} className="spin" /> : <Download size={13} />}
          <span>{exportingChart ? '导出中' : '导出图片'}</span>
        </button>}
        {loading && candles.length === 0 && (
          <div className="review-chart-loading">
            <RefreshCw size={20} className="spin" color="var(--accent-blue)" />
            <span>加载 K 线数据中...</span>
          </div>
        )}
        {daySession && !loading && !error && revealedCandles.length === 0 && (
          <div className="review-chart-loading-chip" role="status">
            纽约 {daySession.date} 09:30 开盘 · 按右方向键或播放，揭示第一根已收盘 K 线
          </div>
        )}
        {daySession && (previousDay.loading || previousDay.warning || previousDay.emaLoading || previousDay.emaWarning) && (
          <div className="review-chart-loading-chip" role="status" style={{ top: 58 }}>
            <span>{previousDay.loading ? '正在加载前一交易日K线与高低点…' : previousDay.warning ||
              (previousDay.emaLoading ? '正在预热 EMA 20 / 60 / 120…' : previousDay.emaWarning)}</span>
            {(previousDay.warning || previousDay.emaWarning) && <button type="button" className="ui-btn" onClick={previousDay.retry}>重试</button>}
          </div>
        )}
        {loading && candles.length > 0 && (
          <div className="review-chart-loading-chip">
            <RefreshCw size={14} className="spin" color="var(--accent-blue)" />
            <span>正在切换周期...</span>
          </div>
        )}
        {!loading && (partialReplay.loading || partialReplay.warning) && (
          <div className="review-chart-loading-chip" role="status">
            {partialReplay.loading && <RefreshCw size={14} className="spin" />}
            <span>{partialReplay.loading ? '正在还原未收盘 K 线...' : partialReplay.warning}</span>
          </div>
        )}

        <ChartCanvas
          candles={visibleCandles}
          pricePrecision={cfdPricePrecision}
          candleCountdownMs={candleCountdownMs}
          symbol={activeSymbol}
          interval={activeTimeframe}
          isLogScale={isLogScale}
          themeMode={themeMode}
          focusTimeMs={chartFocusTimeMs}
          focusAnchorRatio={daySession ? 0.15 : undefined}
          indicatorScope={market}
          emaReady={!daySession || (!previousDay.loading && !previousDay.warning && !previousDay.emaLoading && previousDay.candles.length > 0)}
          emaLoading={Boolean(daySession && previousDay.emaLoading)}
          emaWarning={daySession ? previousDay.warning || previousDay.emaWarning : null}
          emaWarmupCandles={daySession ? previousDay.emaCandles : undefined}
          previousDayCandles={daySession ? previousDay.candles : undefined}
          barCountSession={showBarCount ? daySession : undefined}
          fixedPriceRange={dayPriceRange}
          initialVisibleSpan={
            initialLocation?.visibleSpan ?? DEFAULT_REVIEW_VISIBLE_SPAN
          }
          systemMarkers={systemMarkers}
          onCrosshairMove={setHoveredCandle}
          onDoubleClickTime={handleDoubleClickTime}
          onViewportAnchorChange={handleViewportAnchorChange}
          onLoadEarlier={daySession ? undefined : handleLoadEarlier}
          isLoadingEarlier={isLoadingEarlier}
          onLoadLater={replayState.status === 'idle' ? handleLoadLater : undefined}
          isLoadingLater={isLoadingLater}
          drawings={drawings}
          activeDrawingTool={drawingReady ? activeTool : 'select'}
          selectedDrawingId={selectedDrawingId}
          magnetEnabled={magnetEnabled}
          drawingVideoId="__global__"
          onSelectDrawing={setSelectedDrawingId}
          onSaveDrawing={handleSaveDrawingState}
          onDeleteDrawing={deleteDrawingById}
          onToggleLockDrawing={toggleLockDrawing}
          onDrawingComplete={handleDrawingComplete}
          showVolume={!isCfd}
          sessionBands={daySession ? [] : sessionBands}
          showWeekendBands={!daySession && showWeekendBands}
        />
      </div>
    </div>
  );
}

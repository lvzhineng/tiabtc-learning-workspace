import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { TIMEFRAME_DISPLAY_MAP } from '@/domain/timeframe';
import { timeframeMs } from '@/chart/chart-time';
import type { Candlestick } from '@/domain/candle';
import {
  fetchSymbols,
  addCustomSymbol,
  type PerpetualSymbolSearchItem,
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
import { DrawingObjectTreePanel } from '@/features/drawings/DrawingObjectTreePanel';
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
import { PerpetualSymbolSearchDialog } from './PerpetualSymbolSearchDialog';
import {
  readLocalUiState,
  storedBoolean,
  storedString,
  writeLocalUiState,
} from '@/ui/persistence/local-ui-state';
import {
  AlertCircle,
  ChevronDown,
  RefreshCw,
  Search,
  Video,
  Target,
} from 'lucide-react';
import '@/styles/review-workspace.css';

const TIMEFRAMES: ReviewTimeframe[] = ['1', '5', '15', '60', '240', 'D', 'W'];
const REVIEW_LOCATION_STORAGE_KEY = 'tiabtc-review-location-v1';
const REVIEW_UI_STORAGE_KEY = 'tiabtc-review-ui-v1';
const MIN_REVIEW_TIMESTAMP_MS = 1_500_000_000_000;
const DEFAULT_REVIEW_VISIBLE_SPAN = 120;
const MIN_REVIEW_VISIBLE_SPAN = 30;
const MAX_REVIEW_VISIBLE_SPAN = 200;

type ReviewUiPreferences = {
  symbol: string;
  isLogScale: boolean;
  showUsSessionBands: boolean;
  showWeekendBands: boolean;
};

function loadReviewUiPreferences(): ReviewUiPreferences {
  const stored = readLocalUiState(REVIEW_UI_STORAGE_KEY);
  const symbol = storedString(stored.symbol, 'BTCUSDT', undefined, 32).toUpperCase();
  return {
    symbol: /^[A-Z0-9]{1,24}USDT$/.test(symbol) ? symbol : 'BTCUSDT',
    isLogScale: storedBoolean(stored.isLogScale, false),
    showUsSessionBands: storedBoolean(stored.showUsSessionBands, false),
    showWeekendBands: storedBoolean(stored.showWeekendBands, false),
  };
}

type StoredReviewLocation = {
  timeframe: ReviewTimeframe;
  timestampMs: number;
  visibleSpan: number;
  replay: StoredFreeReplay | null;
};

type StoredFreeReplay = {
  startTimeMs: number;
  cursorTimeMs: number;
  speed: number;
};

function normalizeReviewVisibleSpan(value: unknown): number {
  const visibleSpan = Number(value);
  if (!Number.isFinite(visibleSpan)) return DEFAULT_REVIEW_VISIBLE_SPAN;
  return Math.min(
    MAX_REVIEW_VISIBLE_SPAN,
    Math.max(MIN_REVIEW_VISIBLE_SPAN, visibleSpan)
  );
}

function normalizeStoredFreeReplay(value: unknown): StoredFreeReplay | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<StoredFreeReplay>;
  const startTimeMs = Number(raw.startTimeMs);
  const cursorTimeMs = Number(raw.cursorTimeMs);
  const speed = Number(raw.speed);
  if (
    !Number.isFinite(startTimeMs) ||
    !Number.isFinite(cursorTimeMs) ||
    startTimeMs < MIN_REVIEW_TIMESTAMP_MS ||
    cursorTimeMs < startTimeMs ||
    cursorTimeMs > Date.now()
  ) {
    return null;
  }
  return {
    startTimeMs: Math.round(startTimeMs),
    cursorTimeMs: Math.round(cursorTimeMs),
    speed: [1, 2, 5, 10].includes(speed) ? speed : 1,
  };
}

function loadStoredReviewLocation(): StoredReviewLocation | null {
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(REVIEW_LOCATION_STORAGE_KEY) || 'null'
    ) as Partial<StoredReviewLocation> | null;
    const timeframe = raw?.timeframe;
    const timestampMs = Number(raw?.timestampMs);
    if (
      !TIMEFRAMES.includes(timeframe as ReviewTimeframe) ||
      !Number.isFinite(timestampMs) ||
      timestampMs < MIN_REVIEW_TIMESTAMP_MS ||
      timestampMs > Date.now()
    ) {
      return null;
    }
    return {
      timeframe: timeframe as ReviewTimeframe,
      timestampMs: Math.round(timestampMs),
      visibleSpan: normalizeReviewVisibleSpan(raw?.visibleSpan),
      replay: normalizeStoredFreeReplay(raw?.replay),
    };
  } catch {
    return null;
  }
}

function saveStoredReviewLocation(location: StoredReviewLocation): void {
  try {
    window.localStorage.setItem(
      REVIEW_LOCATION_STORAGE_KEY,
      JSON.stringify(location)
    );
  } catch {
    // Review still works when browser storage is unavailable.
  }
}

interface ChartWorkspaceProps {
  initialVideoContext?: VideoReviewContext | null;
  themeMode?: 'dark' | 'light';
}

export function ChartWorkspace({
  initialVideoContext,
  themeMode = 'dark',
}: ChartWorkspaceProps) {
  const [initialLocation] = useState<StoredReviewLocation | null>(
    loadStoredReviewLocation
  );
  const [initialUiPreferences] = useState(loadReviewUiPreferences);
  const restoredTimestampMs = initialVideoContext
    ? null
    : initialLocation?.timestampMs ?? null;
  const restoredFreeReplay = initialVideoContext
    ? null
    : initialLocation?.replay ?? null;
  const restoredFocusTimeMs = restoredFreeReplay && initialLocation
    ? restoredFreeReplay.cursorTimeMs - timeframeMs(initialLocation.timeframe)
    : restoredTimestampMs;
  const [symbols, setSymbols] = useState<string[]>(['BTCUSDT']);
  const [activeSymbol, setActiveSymbol] = useState<string>(
    initialVideoContext?.symbol || initialUiPreferences.symbol
  );
  const [activeTimeframe, setActiveTimeframe] = useState<ReviewTimeframe>(
    initialLocation?.timeframe || '60'
  );
  const [isLogScale, setIsLogScale] = useState<boolean>(
    initialUiPreferences.isLogScale
  );
  const [showUsSessionBands, setShowUsSessionBands] = useState(
    initialUiPreferences.showUsSessionBands
  );
  const [showWeekendBands, setShowWeekendBands] = useState(
    initialUiPreferences.showWeekendBands
  );
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

  const flushStoredReviewLocation = useCallback(() => {
    if (persistLocationTimerRef.current !== null) {
      window.clearTimeout(persistLocationTimerRef.current);
      persistLocationTimerRef.current = null;
    }
    if (pendingLocationRef.current) {
      saveStoredReviewLocation(pendingLocationRef.current);
      pendingLocationRef.current = null;
    }
  }, []);

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
    writeLocalUiState(REVIEW_UI_STORAGE_KEY, {
      symbol: initialVideoContext ? initialUiPreferences.symbol : activeSymbol,
      isLogScale,
      showUsSessionBands,
      showWeekendBands,
    });
  }, [
    activeSymbol,
    initialUiPreferences.symbol,
    initialVideoContext,
    isLogScale,
    showUsSessionBands,
    showWeekendBands,
  ]);

  const [hoveredCandle, setHoveredCandle] = useState<Candlestick | null>(null);

  const [showSymbolSearch, setShowSymbolSearch] = useState<boolean>(false);

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
    if (restoredFreeReplay) {
      return {
        status: 'paused',
        context: {
          mode: 'free',
          symbol: activeSymbol,
          anchorTimeMs: restoredFreeReplay.startTimeMs,
        },
        startTimeMs: restoredFreeReplay.startTimeMs,
        progressTimeMs: restoredFreeReplay.cursorTimeMs,
        cursorTimeMs: restoredFreeReplay.cursorTimeMs,
        speed: restoredFreeReplay.speed,
      };
    }
    return { status: 'idle' };
  });

  useEffect(() => {
    if (replayState.status === 'idle') return;
    replayMemoryRef.current =
      replayState.context.mode === 'free'
        ? {
            startTimeMs: replayState.startTimeMs,
            cursorTimeMs: replayState.cursorTimeMs,
            speed: replayState.speed,
          }
        : null;
    lastPositionTimeMsRef.current = replayState.cursorTimeMs;
    scheduleStoredReviewLocation(activeTimeframe, replayState.cursorTimeMs);
  }, [activeTimeframe, replayState, scheduleStoredReviewLocation]);

  const handleViewportAnchorChange = useCallback(
    (timestampMs: number, visibleSpan: number) => {
      lastPositionTimeMsRef.current = timestampMs;
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

  // A newly listed symbol can inherit a historical cursor from the previous
  // chart. If the loaded bars all start after that cursor, drop the stale
  // focus so the live tip is visible.
  useEffect(() => {
    if (loading || candles.length === 0 || chartFocusTimeMs === null) {
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
  } = useDrawingWorkspace(activeSymbol, activeTimeframe);
  const handleDrawingComplete = useCallback(() => {
    setActiveTool('select');
  }, [setActiveTool]);
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
    ]
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
          setActiveSymbol((current) =>
            list.includes(current) ? current : list[0]
          );
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

  const handleStartReplayFromCurrentPosition = useCallback(() => {
    if (loading || candles.length === 0) return;

    const firstCandleTimeMs = candles[0].timestampMs;
    const lastCandleTimeMs = candles[candles.length - 1].timestampMs;
    const requestedAnchorTimeMs =
      lastPositionTimeMsRef.current ?? chartFocusTimeMs ?? lastCandleTimeMs;
    const anchorTimeMs = Math.min(
      lastCandleTimeMs,
      Math.max(firstCandleTimeMs, requestedAnchorTimeMs)
    );
    const nextCursorTimeMs = getNextCursorTimeMs(
      candles,
      anchorTimeMs,
      activeTimeframe
    );

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
  }, [activeSymbol, activeTimeframe, candles, chartFocusTimeMs, loading]);

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
        status: prev.status === 'completed' ? 'paused' : prev.status,
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
  }, []);

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
  const readoutInfo: ReadoutInfo | null = useMemo(() => {
    if (!displayCandle) return null;
    return computeReadoutInfo(displayCandle);
  }, [displayCandle]);

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
      {showSymbolSearch && (
        <PerpetualSymbolSearchDialog
          activeSymbol={activeSymbol}
          savedSymbols={symbols}
          onClose={() => setShowSymbolSearch(false)}
          onSelectSymbol={handleSelectSymbol}
        />
      )}

      <DraggableDrawingToolbar
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
        onOpenPaperTrading={togglePaperPanel}
        onCreatePaperTradeFromPosition={handleCreateTradeFromPosition}
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
          onClearAllDrawings={handleClearAllDrawings}
          onClose={toggleObjectTree}
        />
      )}

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
          <button
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
          </button>

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
            onStartFromCurrentPosition={handleStartReplayFromCurrentPosition}
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
            className={`ui-btn ${showUsSessionBands ? 'ui-btn-active' : ''}`}
            onClick={() => setShowUsSessionBands((enabled) => !enabled)}
            title="标注美股常规交易时段（纽约 09:30–16:00）"
            aria-pressed={showUsSessionBands}
          >
            美盘时段
          </button>

          <button
            type="button"
            className={`ui-btn ${showWeekendBands ? 'ui-btn-active' : ''}`}
            onClick={() => setShowWeekendBands((enabled) => !enabled)}
            title="标注美盘周末（纽约周六 00:00–周一 00:00，自动适配夏令时）"
            aria-pressed={showWeekendBands}
          >
            周末时段
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
          <button type="button" className="review-retry-btn" onClick={handleRetryLoad}>
            重试
          </button>
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
          initialVisibleSpan={
            initialLocation?.visibleSpan ?? DEFAULT_REVIEW_VISIBLE_SPAN
          }
          systemMarkers={systemMarkers}
          onCrosshairMove={setHoveredCandle}
          onDoubleClickTime={handleDoubleClickTime}
          onViewportAnchorChange={handleViewportAnchorChange}
          onLoadEarlier={handleLoadEarlier}
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
          showVolume
          showUsSessionBands={showUsSessionBands}
          showWeekendBands={showWeekendBands}
        />
      </div>
    </div>
  );
}

import { useEffect, useState, useRef, useCallback } from 'react';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { TIMEFRAME_DISPLAY_MAP } from '@/domain/timeframe';
import type { Candlestick } from '@/domain/candle';
import {
  fetchSymbols,
  addCustomSymbol,
  fetchChartCandles,
  fetchEarlierCandles,
  fetchLaterCandles,
} from '@/api/market-api';
import {
  fetchDrawings,
  saveDrawing,
  deleteDrawing,
  clearAllDrawingsForSymbol,
} from '@/api/drawing-api';
import { ChartCanvas } from '@/chart/ChartCanvas';
import { computeReadoutInfo, type ReadoutInfo } from '@/chart/candlestick-readout';
import { formatChartTime } from '@/chart/chart-time';
import type { ReplayState } from '@/features/replay/replay-state';
import {
  filterVisibleCandles,
  getNextCursorTimeMs,
  getPrevCursorTimeMs,
  shouldPrefetchFuture,
} from '@/features/replay/free-replay-logic';
import { FreeReplayPanel } from '@/features/replay/FreeReplayPanel';
import type { ActiveToolType, DrawingToolState } from '@/features/drawings/drawing-types';
import { deserializeDrawing, serializeDrawing } from '@/features/drawings/drawing-engine';
import { DraggableDrawingToolbar } from '@/features/drawings/DraggableDrawingToolbar';
import {
  AlertCircle,
  Plus,
  BarChart2,
  RefreshCw,
} from 'lucide-react';

const TIMEFRAMES: ReviewTimeframe[] = ['5', '15', '60', '240', 'D', 'W'];

export function ChartWorkspace() {
  const [symbols, setSymbols] = useState<string[]>(['BTCUSDT']);
  const [activeSymbol, setActiveSymbol] = useState<string>('BTCUSDT');
  const [activeTimeframe, setActiveTimeframe] = useState<ReviewTimeframe>('60');
  const [isLogScale, setIsLogScale] = useState<boolean>(false);

  const [candles, setCandles] = useState<Candlestick[]>([]);
  const [hoveredCandle, setHoveredCandle] = useState<Candlestick | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState<boolean>(false);
  const [offlineWarning, setOfflineWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newSymbolInput, setNewSymbolInput] = useState<string>('');
  const [showAddSymbol, setShowAddSymbol] = useState<boolean>(false);

  // Drawing State
  const [activeTool, setActiveTool] = useState<ActiveToolType>('select');
  const [magnetEnabled, setMagnetEnabled] = useState<boolean>(false);
  const [drawings, setDrawings] = useState<DrawingToolState[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<DrawingToolState[][]>([]);
  const [redoStack, setRedoStack] = useState<DrawingToolState[][]>([]);

  // Replay State Machine
  const [replayState, setReplayState] = useState<ReplayState>({ status: 'idle' });

  const activeReqControllerRef = useRef<AbortController | null>(null);

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

  // Main Candle Loading Effect
  useEffect(() => {
    if (activeReqControllerRef.current) {
      activeReqControllerRef.current.abort();
    }

    const controller = new AbortController();
    activeReqControllerRef.current = controller;

    setLoading(true);
    setError(null);
    setOfflineWarning(null);
    setCandles([]);
    setHoveredCandle(null);

    const initialAnchor = replayState.status !== 'idle' ? replayState.startTimeMs : 0;

    fetchChartCandles(activeSymbol, activeTimeframe, initialAnchor, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setCandles(data);
        if (data.length === 0) {
          setOfflineWarning(`符号 ${activeSymbol} (${TIMEFRAME_DISPLAY_MAP[activeTimeframe]}) 暂无本地缓存数据。`);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : '加载 K 线数据失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [activeSymbol, activeTimeframe]);

  // Load Persisted Drawings from Server
  useEffect(() => {
    fetchDrawings('', activeSymbol)
      .then((list) => {
        const deserialized = list.map(deserializeDrawing);
        setDrawings(deserialized);
        setSelectedDrawingId(null);
        setUndoStack([]);
        setRedoStack([]);
      })
      .catch((err) => {
        console.warn('拉取画图持久化记录失败:', err);
      });
  }, [activeSymbol]);

  // Handle auto-load earlier candles when scrolling left
  const handleLoadEarlier = useCallback(() => {
    if (isLoadingEarlier || loading || candles.length === 0) return;

    const earliestTs = Math.min(...candles.map((c) => c.timestampMs));
    setIsLoadingEarlier(true);

    fetchEarlierCandles(activeSymbol, activeTimeframe, earliestTs, 1000)
      .then((newEarlierCandles) => {
        if (newEarlierCandles.length > 0) {
          setCandles((prev) => {
            const existingTs = new Set(prev.map((c) => c.timestampMs));
            const fresh = newEarlierCandles.filter((c) => !existingTs.has(c.timestampMs));
            return [...fresh, ...prev];
          });
        }
      })
      .catch((err) => {
        console.warn('扩展加载更早 K 线失败:', err);
      })
      .finally(() => {
        setIsLoadingEarlier(false);
      });
  }, [activeSymbol, activeTimeframe, candles, isLoadingEarlier, loading]);

  // Handle prefetching future candles for replay in background
  const prefetchFutureCandles = useCallback(() => {
    if (candles.length === 0) return;
    const latestTs = Math.max(...candles.map((c) => c.timestampMs));
    fetchLaterCandles(activeSymbol, activeTimeframe, latestTs, 1000)
      .then((laterCandles) => {
        if (laterCandles.length > 0) {
          setCandles((prev) => {
            const existingTs = new Set(prev.map((c) => c.timestampMs));
            const fresh = laterCandles.filter((c) => !existingTs.has(c.timestampMs));
            return [...prev, ...fresh];
          });
        }
      })
      .catch((err) => {
        console.warn('预取未来数据失败:', err);
      });
  }, [activeSymbol, activeTimeframe, candles]);

  // Drawing Actions & Persistence Sync
  const persistStateChange = (newDrawings: DrawingToolState[]) => {
    setUndoStack((prev) => [...prev, drawings]);
    setRedoStack([]);
    setDrawings(newDrawings);
  };

  const handleSaveDrawingState = async (toolState: DrawingToolState) => {
    try {
      const persistedPayload = serializeDrawing(toolState);
      const saved = await saveDrawing(persistedPayload);
      const deserializedSaved = deserializeDrawing(saved);

      const exists = drawings.some((d) => d.id === toolState.id);
      const next = exists
        ? drawings.map((d) => (d.id === toolState.id ? deserializedSaved : d))
        : [...drawings, deserializedSaved];

      persistStateChange(next);
    } catch (err) {
      alert(`保存画图记录失败: ${err instanceof Error ? err.message : '网络或数据库异常'}`);
    }
  };

  const handleDeleteSelectedDrawing = async () => {
    if (!selectedDrawingId) return;
    const target = drawings.find((d) => d.id === selectedDrawingId);
    if (!target) return;

    try {
      await deleteDrawing(selectedDrawingId, '', activeSymbol);
      const next = drawings.filter((d) => d.id !== selectedDrawingId);
      persistStateChange(next);
      setSelectedDrawingId(null);
    } catch (err) {
      alert(`删除画图记录失败: ${err instanceof Error ? err.message : '网络异常'}`);
    }
  };

  const handleClearAllDrawings = async () => {
    if (drawings.length === 0) return;
    const confirmClear = window.confirm(`确认要清空当前 Symbol (${activeSymbol}) 的所有画图记录吗？此操作无法撤销。`);
    if (!confirmClear) return;

    try {
      await clearAllDrawingsForSymbol(activeSymbol);
      persistStateChange([]);
      setSelectedDrawingId(null);
    } catch (err) {
      alert(`清空画图失败: ${err instanceof Error ? err.message : '网络异常'}`);
    }
  };

  const handleToggleLockSelected = async () => {
    if (!selectedDrawingId) return;
    const target = drawings.find((d) => d.id === selectedDrawingId);
    if (!target) return;

    const updated = { ...target, locked: !target.locked };
    await handleSaveDrawingState(updated);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, drawings]);
    setUndoStack((u) => u.slice(0, -1));
    setDrawings(prev);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, drawings]);
    setRedoStack((r) => r.slice(0, -1));
    setDrawings(next);
  };

  // Replay Actions
  const handleStartReplay = (symbol: string, startTimeMs: number) => {
    setActiveSymbol(symbol);
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
    setReplayState({ status: 'idle' });
  };

  const handleNextBar = useCallback(() => {
    if (replayState.status === 'idle') return;
    const nextCursorMs = getNextCursorTimeMs(candles, replayState.cursorTimeMs);
    if (nextCursorMs === replayState.cursorTimeMs) {
      prefetchFutureCandles();
      return;
    }

    setReplayState((prev) => {
      if (prev.status === 'idle') return prev;
      return {
        ...prev,
        cursorTimeMs: nextCursorMs,
        progressTimeMs: Math.max(prev.progressTimeMs, nextCursorMs),
      };
    });

    if (shouldPrefetchFuture(candles, nextCursorMs)) {
      prefetchFutureCandles();
    }
  }, [candles, replayState, prefetchFutureCandles]);

  const handlePrevBar = useCallback(() => {
    if (replayState.status === 'idle') return;
    const prevCursorMs = getPrevCursorTimeMs(candles, replayState.cursorTimeMs, replayState.startTimeMs);
    setReplayState((prev) => {
      if (prev.status === 'idle') return prev;
      return {
        ...prev,
        cursorTimeMs: prevCursorMs,
      };
    });
  }, [candles, replayState]);

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
      const updated = await addCustomSymbol(clean);
      setSymbols(updated);
      setActiveSymbol(clean);
      setNewSymbolInput('');
      setShowAddSymbol(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : '添加 Symbol 失败');
    }
  };

  // Determine Visible Candles for Chart Canvas
  const visibleCandles =
    replayState.status !== 'idle'
      ? filterVisibleCandles(candles, replayState.cursorTimeMs)
      : candles;

  const displayCandle =
    hoveredCandle || (visibleCandles.length > 0 ? visibleCandles[visibleCandles.length - 1] : null);
  const readoutInfo: ReadoutInfo | null = computeReadoutInfo(displayCandle);

  const selectedDrawing = drawings.find((d) => d.id === selectedDrawingId);
  const selectedLocked = Boolean(selectedDrawing?.locked);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-dark-900)', position: 'relative' }}>
      {/* Draggable Drawing Toolbar Overlay */}
      <DraggableDrawingToolbar
        activeTool={activeTool}
        magnetEnabled={magnetEnabled}
        selectedDrawingId={selectedDrawingId}
        selectedLocked={selectedLocked}
        onSelectTool={setActiveTool}
        onToggleMagnet={() => setMagnetEnabled(!magnetEnabled)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onToggleLock={handleToggleLockSelected}
        onDeleteSelected={handleDeleteSelectedDrawing}
        onClearAll={handleClearAllDrawings}
      />

      {/* Top Controls Bar */}
      <div
        style={{
          height: '42px',
          background: 'var(--bg-dark-800)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          gap: '12px',
        }}
      >
        {/* Left: Symbol, Timeframe & Free Replay Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Symbol Select */}
          <select
            value={activeSymbol}
            onChange={(e) => setActiveSymbol(e.target.value)}
            style={{
              background: 'var(--bg-dark-700)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 8px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {symbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>

          {/* Add Symbol Toggle */}
          {showAddSymbol ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="text"
                value={newSymbolInput}
                onChange={(e) => setNewSymbolInput(e.target.value)}
                placeholder="例如: ETHUSDT"
                style={{
                  width: '90px',
                  background: 'var(--bg-dark-700)',
                  color: '#fff',
                  border: '1px solid var(--accent-blue)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '3px 6px',
                  fontSize: '12px',
                  outline: 'none',
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()}
              />
              <button
                onClick={handleAddSymbol}
                style={{
                  background: 'var(--accent-blue)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '3px 8px',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                确定
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAddSymbol(true)}
              title="添加自定义 Symbol"
              style={{
                background: 'var(--bg-dark-700)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Plus size={14} />
            </button>
          )}

          <div style={{ width: '1px', height: '16px', background: 'var(--border-color)', margin: '0 4px' }} />

          {/* Timeframe Selector Buttons */}
          <div style={{ display: 'flex', gap: '2px', background: 'var(--bg-dark-700)', padding: '2px', borderRadius: 'var(--radius-sm)' }}>
            {TIMEFRAMES.map((tf) => {
              const active = activeTimeframe === tf;
              return (
                <button
                  key={tf}
                  onClick={() => setActiveTimeframe(tf)}
                  style={{
                    background: active ? 'var(--bg-dark-600)' : 'transparent',
                    color: active ? '#fff' : 'var(--text-secondary)',
                    fontWeight: active ? 600 : 400,
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    padding: '3px 8px',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  {TIMEFRAME_DISPLAY_MAP[tf]}
                </button>
              );
            })}
          </div>

          <div style={{ width: '1px', height: '16px', background: 'var(--border-color)', margin: '0 4px' }} />

          {/* Free Replay Panel Integration */}
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

        {/* Right: Log Scale Toggle & Active Drawings Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {drawings.length > 0 && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              画图: {drawings.length} 条
            </span>
          )}
          <button
            onClick={() => setIsLogScale(!isLogScale)}
            style={{
              background: isLogScale ? 'var(--accent-blue)' : 'var(--bg-dark-700)',
              color: isLogScale ? '#fff' : 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 8px',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            LOG 对数坐标
          </button>
        </div>
      </div>

      {/* OHLC Readout Bar */}
      <div
        style={{
          height: '32px',
          background: 'var(--bg-dark-800)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          fontSize: '12px',
          gap: '16px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-secondary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)', fontWeight: 600 }}>
          <BarChart2 size={14} color="var(--accent-blue)" />
          <span>{activeSymbol}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({TIMEFRAME_DISPLAY_MAP[activeTimeframe]})</span>
        </div>

        {readoutInfo ? (
          <>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>时间: </span>
              <span>{formatChartTime(readoutInfo.candle!.timestampMs, activeTimeframe)}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>O: </span>
              <span>{readoutInfo.formattedOpen}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>H: </span>
              <span>{readoutInfo.formattedHigh}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>L: </span>
              <span>{readoutInfo.formattedLow}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>C: </span>
              <span style={{ color: readoutInfo.isUp ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {readoutInfo.formattedClose}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>幅: </span>
              <span style={{ color: readoutInfo.isUp ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {readoutInfo.formattedChange}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Vol: </span>
              <span>{readoutInfo.formattedVolume}</span>
            </div>
          </>
        ) : (
          <div style={{ color: 'var(--text-muted)' }}>暂无 Candlestick 数据</div>
        )}
      </div>

      {/* Warnings & Loading Overlay */}
      {offlineWarning && (
        <div
          style={{
            background: 'rgba(255, 152, 0, 0.15)',
            borderBottom: '1px solid var(--accent-orange)',
            color: 'var(--accent-orange)',
            padding: '6px 16px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertCircle size={14} />
          <span>{offlineWarning}</span>
        </div>
      )}

      {error && (
        <div
          style={{
            background: 'rgba(242, 54, 69, 0.15)',
            borderBottom: '1px solid var(--accent-red)',
            color: 'var(--accent-red)',
            padding: '6px 16px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertCircle size={14} />
          <span>加载失败: {error}</span>
        </div>
      )}

      {/* Main Chart Canvas Area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(15, 18, 24, 0.7)',
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              color: 'var(--text-primary)',
            }}
          >
            <RefreshCw size={20} className="spin" color="var(--accent-blue)" />
            <span>加载 K 线数据中...</span>
          </div>
        )}

        <ChartCanvas
          candles={visibleCandles}
          symbol={activeSymbol}
          interval={activeTimeframe}
          isLogScale={isLogScale}
          onCrosshairMove={setHoveredCandle}
          onLoadEarlier={handleLoadEarlier}
          isLoadingEarlier={isLoadingEarlier}
        />
      </div>
    </div>
  );
}

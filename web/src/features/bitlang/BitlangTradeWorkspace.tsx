import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import {
  fetchBitlangEarlierCandles,
  fetchBitlangLaterCandles,
  fetchBitlangTradeCandles,
} from '@/api/market-api';
import { ChartCanvas } from '@/chart/ChartCanvas';
import {
  formatChartTime,
  timestampMsToUtcTimestamp,
  timeframeMs,
} from '@/chart/chart-time';
import type { Candlestick } from '@/domain/candle';
import {
  TIMEFRAME_DISPLAY_MAP,
  type ReviewTimeframe,
} from '@/domain/timeframe';
import { DraggableDrawingToolbar } from '@/features/drawings/DraggableDrawingToolbar';
import { useDrawingWorkspace } from '@/features/review-workspace/useDrawingWorkspace';
import type {
  BitlangDirection,
  BitlangTrade,
  BitlangTradeSnapshot,
} from './bitlang-types';
import '@/styles/bitlang.css';

const PAGE_SIZE = 100;
const TIMEFRAMES: ReviewTimeframe[] = ['1', '5', '15', '60', '240', 'D', 'W'];
let bitlangSnapshotRequest: Promise<BitlangTradeSnapshot> | null = null;

function loadBitlangSnapshot(): Promise<BitlangTradeSnapshot> {
  if (!bitlangSnapshotRequest) {
    bitlangSnapshotRequest = fetch('/bitlang-trades.json')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<BitlangTradeSnapshot>;
      })
      .catch((error) => {
        bitlangSnapshotRequest = null;
        throw error;
      });
  }
  return bitlangSnapshotRequest;
}

type ResultFilter = 'all' | 'profit' | 'loss';
type SortField = 'entryTime' | 'profit' | 'returnRate' | 'holdingMinutes';

interface BitlangTradeWorkspaceProps {
  themeMode?: 'dark' | 'light';
}

function formatTime(value: string): string {
  return value.slice(0, 16).replace('T', ' ');
}

function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatNumber(value * 100)}%`;
}

function timeframeLabel(timeframe: ReviewTimeframe): string {
  return TIMEFRAME_DISPLAY_MAP[timeframe];
}

function bybitSymbol(instrument: string): string {
  return instrument.replace(/-USDT-SWAP$/i, 'USDT').replace(/-/g, '').toUpperCase();
}

function mergeCandles(
  current: Candlestick[],
  incoming: Candlestick[]
): Candlestick[] {
  if (!incoming.length) return current;
  const merged = new Map(
    current.map((candle) => [candle.timestampMs, candle])
  );
  let changed = false;
  for (const candle of incoming) {
    if (!merged.has(candle.timestampMs)) changed = true;
    merged.set(candle.timestampMs, candle);
  }
  if (!changed) return current;
  return Array.from(merged.values()).sort(
    (left, right) => left.timestampMs - right.timestampMs
  );
}

export function BitlangTradeWorkspace({
  themeMode = 'dark',
}: BitlangTradeWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<BitlangTradeSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [focusRevision, setFocusRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [instrument, setInstrument] = useState('all');
  const [direction, setDirection] = useState<'all' | BitlangDirection>('all');
  const [result, setResult] = useState<ResultFilter>('all');
  const [minimumHoldingMinutes, setMinimumHoldingMinutes] = useState('');
  const [sortField, setSortField] = useState<SortField>('entryTime');
  const [descending, setDescending] = useState(false);
  const [timeframe, setTimeframe] = useState<ReviewTimeframe>('60');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    let active = true;
    void loadBitlangSnapshot()
      .then((data) => {
        if (!active) return;
        setSnapshot(data);
        setSelectedId(data.trades[0]?.id || '');
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : '交割单读取失败');
      });
    return () => {
      active = false;
    };
  }, []);

  const instruments = useMemo(
    () =>
      Array.from(
        new Set(snapshot?.trades.map((trade) => trade.instrument) || [])
      ).sort(),
    [snapshot]
  );

  const filteredTrades = useMemo(() => {
    const keyword = deferredSearch.trim().toLowerCase();
    const holdingMinutesThreshold = Number(minimumHoldingMinutes);
    const hasHoldingMinutesThreshold =
      minimumHoldingMinutes !== '' &&
      Number.isFinite(holdingMinutesThreshold) &&
      holdingMinutesThreshold > 0;
    return (snapshot?.trades || [])
      .filter((trade) => {
        if (instrument !== 'all' && trade.instrument !== instrument) return false;
        if (direction !== 'all' && trade.direction !== direction) return false;
        if (result === 'profit' && trade.profit <= 0) return false;
        if (result === 'loss' && trade.profit >= 0) return false;
        if (
          hasHoldingMinutesThreshold &&
          trade.holdingMinutes <= holdingMinutesThreshold
        ) {
          return false;
        }
        return (
          !keyword ||
          `${trade.sequence} ${trade.instrument} ${trade.sourceNote}`
            .toLowerCase()
            .includes(keyword)
        );
      })
      .sort((left, right) => {
        const leftValue = left[sortField];
        const rightValue = right[sortField];
        const comparison =
          typeof leftValue === 'string'
            ? leftValue.localeCompare(String(rightValue))
            : Number(leftValue) - Number(rightValue);
        return descending ? -comparison : comparison;
      });
  }, [
    descending,
    direction,
    instrument,
    minimumHoldingMinutes,
    result,
    deferredSearch,
    snapshot,
    sortField,
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    instrument,
    direction,
    result,
    minimumHoldingMinutes,
    sortField,
    descending,
  ]);

  const stats = useMemo(() => {
    const winning = filteredTrades.filter((trade) => trade.profit > 0).length;
    return {
      count: filteredTrades.length,
      profit: filteredTrades.reduce((sum, trade) => sum + trade.profit, 0),
      winRate: filteredTrades.length ? winning / filteredTrades.length : 0,
    };
  }, [filteredTrades]);

  const pageCount = Math.max(1, Math.ceil(filteredTrades.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageTrades = filteredTrades.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );
  const selectedTrade =
    pageTrades.find((trade) => trade.id === selectedId) ||
    pageTrades[0] ||
    null;

  useEffect(() => {
    if (selectedTrade && selectedTrade.id !== selectedId) {
      setSelectedId(selectedTrade.id);
    }
  }, [selectedId, selectedTrade]);

  if (error) {
    return <div className="bitlang-state">交割单加载失败：{error}</div>;
  }
  if (!snapshot) {
    return (
      <div className="bitlang-state">
        <RefreshCw size={20} className="spin" />
        正在读取 bit浪浪交割单...
      </div>
    );
  }

  return (
    <div className="bitlang-review-shell">
      <aside className="bitlang-sidebar">
        <div className="bitlang-sidebar-title">
          <div>
            <strong>bit浪浪实盘分析</strong>
            <span>Trade Review · {snapshot.trades.length} 笔</span>
          </div>
        </div>

        <div className="bitlang-sidebar-filters">
          <label className="bitlang-search">
            <Search size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索交易对、序号或备注"
            />
          </label>
          <select value={instrument} onChange={(event) => setInstrument(event.target.value)}>
            <option value="all">全部交易对</option>
            {instruments.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <div className="bitlang-filter-row">
            <select
              value={direction}
              onChange={(event) =>
                setDirection(event.target.value as 'all' | BitlangDirection)
              }
            >
              <option value="all">全部方向</option>
              <option value="多">多</option>
              <option value="空">空</option>
            </select>
            <select
              value={result}
              onChange={(event) => setResult(event.target.value as ResultFilter)}
            >
              <option value="all">全部盈亏</option>
              <option value="profit">盈利</option>
              <option value="loss">亏损</option>
            </select>
          </div>
          <label className="bitlang-duration-filter">
            <span>持仓时间</span>
            <strong>大于</strong>
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={minimumHoldingMinutes}
              onChange={(event) => {
                const value = event.target.value;
                setMinimumHoldingMinutes(
                  value === '' ? '' : String(Math.max(0, Number(value)))
                );
              }}
              placeholder="0"
              aria-label="最小持仓时间"
            />
            <span>分钟</span>
          </label>
          <div className="bitlang-filter-row">
            <select
              value={sortField}
              onChange={(event) => setSortField(event.target.value as SortField)}
            >
              <option value="entryTime">开仓时间</option>
              <option value="profit">收益额</option>
              <option value="returnRate">收益率</option>
              <option value="holdingMinutes">持仓时间</option>
            </select>
            <button type="button" onClick={() => setDescending((value) => !value)}>
              {descending ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
              {descending ? '降序' : '升序'}
            </button>
          </div>
        </div>

        <div className="bitlang-progress">
          <span>{stats.count} 笔</span>
          <strong className={stats.profit >= 0 ? 'profit' : 'loss'}>
            {formatNumber(stats.profit)} USDT
          </strong>
          <span>胜率 {formatPercent(stats.winRate)}</span>
        </div>

        <div className="bitlang-trade-list">
          {pageTrades.map((trade) => (
            <button
              type="button"
              key={trade.id}
              className={`bitlang-trade-row ${
                trade.id === selectedTrade?.id ? 'active' : ''
              }`}
              onClick={() => {
                setSelectedId(trade.id);
                setFocusRevision((revision) => revision + 1);
              }}
            >
              <span className="bitlang-row-time">{formatTime(trade.entryTime)}</span>
              <span className="bitlang-row-main">
                <strong>{trade.instrument}</strong>
                <em className={trade.direction === '多' ? 'profit' : 'loss'}>
                  {trade.direction}
                </em>
              </span>
              <span className="bitlang-row-meta">
                {formatNumber(trade.leverage, 0)}x · 平仓 {formatTime(trade.exitTime).slice(5)}
              </span>
              <span className={trade.profit >= 0 ? 'profit' : 'loss'}>
                {formatPercent(trade.returnRate)} / {formatNumber(trade.profit)}
              </span>
            </button>
          ))}
        </div>

        <div className="bitlang-pagination">
          <span>{safePage} / {pageCount}</span>
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            disabled={safePage >= pageCount}
            onClick={() => setPage(safePage + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>

      <section className="bitlang-chart-workspace">
        {selectedTrade ? (
          <>
            <header className="bitlang-chart-header">
              <div>
                <h2>{selectedTrade.instrument}</h2>
                <p>
                  {formatTime(selectedTrade.entryTime)} 到{' '}
                  {formatTime(selectedTrade.exitTime)}
                </p>
              </div>
              <div className="bitlang-timeframes">
                {TIMEFRAMES.map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={item === timeframe ? 'active' : ''}
                    onClick={() => {
                      if (item === timeframe) return;
                      setTimeframe(item);
                      setFocusRevision((revision) => revision + 1);
                    }}
                  >
                    {timeframeLabel(item)}
                  </button>
                ))}
              </div>
            </header>

            <BitlangTradeChart
              trade={selectedTrade}
              timeframe={timeframe}
              themeMode={themeMode}
              focusRevision={focusRevision}
            />

            <TradeMetrics trade={selectedTrade} />
          </>
        ) : (
          <div className="bitlang-state">没有符合筛选条件的交易。</div>
        )}
      </section>
    </div>
  );
}

function BitlangTradeChart({
  trade,
  timeframe,
  themeMode,
  focusRevision,
}: {
  trade: BitlangTrade;
  timeframe: ReviewTimeframe;
  themeMode: 'dark' | 'light';
  focusRevision: number;
}) {
  const [candles, setCandles] = useState<Candlestick[]>([]);
  const [hoveredCandle, setHoveredCandle] = useState<Candlestick | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
  const [isLoadingLater, setIsLoadingLater] = useState(false);
  const [loadedContextKey, setLoadedContextKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const earlierRequestRef = useRef<AbortController | null>(null);
  const laterRequestRef = useRef<AbortController | null>(null);
  const contextKeyRef = useRef('');
  const entryTimeMs = Date.parse(trade.entryTime);
  const exitTimeMs = Date.parse(trade.exitTime);
  const symbol = bybitSymbol(trade.instrument);
  const chartContextKey = `${symbol}:${timeframe}:${entryTimeMs}:${exitTimeMs}`;
  const {
    activeTool,
    setActiveTool,
    magnetEnabled,
    toggleMagnet,
    drawings,
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
    setLoadedContextKey('');
    setHoveredCandle(null);
    setLoading(true);
    setIsLoadingEarlier(false);
    setIsLoadingLater(false);
    setError(null);
    fetchBitlangTradeCandles(
      symbol,
      timeframe,
      entryTimeMs,
      exitTimeMs,
      controller.signal
    )
      .then((nextCandles) => {
        if (
          controller.signal.aborted ||
          contextKeyRef.current !== chartContextKey
        ) {
          return;
        }
        setCandles(nextCandles);
        setLoadedContextKey(chartContextKey);
        if (!nextCandles.length) setError('Bybit 未返回该时间范围的 K 线');
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'K 线加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      earlierRequestRef.current?.abort();
      laterRequestRef.current?.abort();
    };
  }, [chartContextKey, entryTimeMs, exitTimeMs, symbol, timeframe]);

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
    earlierRequestRef.current = controller;
    setIsLoadingEarlier(true);
    void fetchBitlangEarlierCandles(
      symbol,
      timeframe,
      candles[0].timestampMs,
      500,
      controller.signal
    )
      .then((incoming) => {
        if (
          !controller.signal.aborted &&
          contextKeyRef.current === requestContextKey
        ) {
          setCandles((current) => mergeCandles(current, incoming));
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          console.warn('Bit浪浪更早 K 线加载失败:', cause);
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
    const controller = new AbortController();
    const requestContextKey = contextKeyRef.current;
    laterRequestRef.current = controller;
    setIsLoadingLater(true);
    void fetchBitlangLaterCandles(
      symbol,
      timeframe,
      candles[candles.length - 1].timestampMs,
      500,
      controller.signal
    )
      .then((incoming) => {
        if (
          !controller.signal.aborted &&
          contextKeyRef.current === requestContextKey
        ) {
          setCandles((current) => mergeCandles(current, incoming));
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          console.warn('Bit浪浪更晚 K 线加载失败:', cause);
        }
      })
      .finally(() => {
        if (laterRequestRef.current === controller) {
          laterRequestRef.current = null;
          setIsLoadingLater(false);
        }
      });
  }, [candles, isLoadingLater, loading, symbol, timeframe]);

  const markers = useMemo(
    () => buildTradeMarkers(trade, timeframe, candles),
    [candles, timeframe, trade]
  );

  return (
    <div className="bitlang-chart">
      <DraggableDrawingToolbar
        activeTool={activeTool}
        magnetEnabled={magnetEnabled}
        selectedDrawingId={selectedDrawingId}
        selectedLocked={Boolean(selectedDrawing?.locked)}
        onSelectTool={setActiveTool}
        onToggleMagnet={toggleMagnet}
        onUndo={undo}
        onRedo={redo}
        onToggleLock={toggleLockSelected}
        onDeleteSelected={deleteSelectedDrawing}
        onClearAll={clearAllDrawings}
      />
      <ChartCanvas
        candles={candles}
        symbol={symbol}
        interval={timeframe}
        themeMode={themeMode}
        systemMarkers={markers}
        focusRangeMs={
          loadedContextKey === chartContextKey
            ? { from: entryTimeMs, to: exitTimeMs }
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
        onDrawingComplete={() => setActiveTool('select')}
        showVolume
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
      {(loading || error) && (
        <div className={`bitlang-chart-status ${error ? 'error' : ''}`}>
          {loading && <RefreshCw size={17} className="spin" />}
          {error || `正在通过 CCXT 加载 ${symbol} K 线...`}
        </div>
      )}
    </div>
  );
}

function buildTradeMarkers(
  trade: BitlangTrade,
  timeframe: ReviewTimeframe,
  candles: Candlestick[]
): SeriesMarker<UTCTimestamp>[] {
  if (!candles.length) return [];
  const interval = timeframeMs(timeframe);
  const markerTime = (eventTimeMs: number) => {
    const candle =
      candles.find(
        (item) =>
          item.timestampMs <= eventTimeMs &&
          item.timestampMs + interval > eventTimeMs
      ) || candles.reduce((nearest, item) =>
        Math.abs(item.timestampMs - eventTimeMs) <
        Math.abs(nearest.timestampMs - eventTimeMs)
          ? item
          : nearest
      );
    return timestampMsToUtcTimestamp(candle.timestampMs);
  };
  return [
    {
      time: markerTime(Date.parse(trade.entryTime)),
      position: 'belowBar',
      color: trade.direction === '多' ? '#089981' : '#f23645',
      shape: 'arrowUp',
      text: `开 ${formatNumber(trade.entryPrice, 4)}`,
    },
    {
      time: markerTime(Date.parse(trade.exitTime)),
      position: 'aboveBar',
      color: trade.profit >= 0 ? '#089981' : '#f23645',
      shape: 'arrowDown',
      text: `平 ${formatNumber(trade.exitPrice, 4)}`,
    },
  ];
}

function TradeMetrics({ trade }: { trade: BitlangTrade }) {
  const metrics = [
    ['方向', `${trade.direction} / ${formatNumber(trade.leverage, 0)}x`],
    ['开仓', formatNumber(trade.entryPrice, 4)],
    ['平仓', formatNumber(trade.exitPrice, 4)],
    ['收益率', formatPercent(trade.returnRate)],
    ['收益', `${formatNumber(trade.profit)} USDT`],
    ['持仓', `${trade.holdingMinutes} 分钟`],
  ];
  return (
    <div className="bitlang-review-panel">
      <div className="bitlang-metrics">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong
              className={
                label === '收益' || label === '收益率'
                  ? trade.profit >= 0
                    ? 'profit'
                    : 'loss'
                  : ''
              }
            >
              {value}
            </strong>
          </div>
        ))}
      </div>
      <div className="bitlang-original-note">
        <span>原始备注</span>
        <p>{trade.sourceNote || '无备注'}</p>
      </div>
    </div>
  );
}

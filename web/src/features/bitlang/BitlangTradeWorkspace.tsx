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
import {
  candleVenueLabel,
  clipTradeFocusRange,
  sliceCachedCandleWindow,
  boundedTradeWindowMs,
} from '@/api/candle-window-cache';
import { ChartCanvas } from '@/chart/ChartCanvas';
import {
  formatChartTime,
  timestampMsToUtcTimestamp,
  timeframeMs,
} from '@/chart/chart-time';
import type { Candlestick } from '@/domain/candle';
import {
  TIMEFRAME_DISPLAY_MAP,
  suggestReviewTimeframe,
  type ReviewTimeframe,
} from '@/domain/timeframe';
import { DraggableDrawingToolbar } from '@/features/drawings/DraggableDrawingToolbar';
import { DrawingObjectTreePanel } from '@/features/drawings/DrawingObjectTreePanel';
import { useDrawingWorkspace } from '@/features/review-workspace/useDrawingWorkspace';
import {
  scrollReviewRowIntoView,
  useReviewListKeyboard,
} from '@/features/review-workspace/useReviewListKeyboard';
import type {
  BitlangDirection,
  BitlangTrade,
  BitlangTradeSnapshot,
} from './bitlang-types';
import '@/styles/bitlang.css';

const PAGE_SIZE = 100;
const TIMEFRAMES: ReviewTimeframe[] = ['1', '5', '15', '60', '240', 'D', 'W'];
type DateRangeFilter = 'all' | '1d' | '3d' | '7d' | '30d' | '90d';
const DATE_RANGE_MS_MAP: Record<Exclude<DateRangeFilter, 'all'>, number> = {
  '1d': 1 * 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};
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
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs)
    ? formatChartTime(timestampMs).slice(0, 16)
    : '--';
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

function formatHoldingMinutes(minutes: number): string {
  const roundedMinutes = Math.round(minutes);
  if (roundedMinutes < 1) return '< 1m';
  if (roundedMinutes < 60) return `${roundedMinutes}m`;
  const hours = Math.floor(roundedMinutes / 60);
  const remMinutes = roundedMinutes % 60;
  if (hours < 24) {
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function mergeCandles(
  current: Candlestick[],
  incoming: Candlestick[]
): Candlestick[] {
  if (!incoming.length) return current;
  if (!current.length) return incoming;
  if (
    incoming[incoming.length - 1].timestampMs < current[0].timestampMs
  ) {
    return [...incoming, ...current];
  }
  if (
    incoming[0].timestampMs > current[current.length - 1].timestampMs
  ) {
    return [...current, ...incoming];
  }
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
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all');
  const [minimumHoldingMinutes, setMinimumHoldingMinutes] = useState('');
  const [sortField, setSortField] = useState<SortField>('entryTime');
  const [descending, setDescending] = useState(true);
  const [timeframe, setTimeframe] = useState<ReviewTimeframe>('60');
  const [autoTimeframe, setAutoTimeframe] = useState(true);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showUsSessionBands, setShowUsSessionBands] = useState(false);
  const [showWeekendBands, setShowWeekendBands] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const listRef = useRef<HTMLDivElement | null>(null);

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
    const snapshotEndMs = (snapshot?.trades || []).reduce(
      (latest, trade) => Math.max(latest, Date.parse(trade.entryTime) || 0),
      0
    );
    const cutoffMs =
      dateRange === 'all'
        ? 0
        : snapshotEndMs - DATE_RANGE_MS_MAP[dateRange];
    return (snapshot?.trades || [])
      .filter((trade) => {
        if (instrument !== 'all' && trade.instrument !== instrument) return false;
        if (direction !== 'all' && trade.direction !== direction) return false;
        if (result === 'profit' && trade.profit <= 0) return false;
        if (result === 'loss' && trade.profit >= 0) return false;
        if (cutoffMs > 0 && Date.parse(trade.entryTime) < cutoffMs) return false;
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
    dateRange,
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
    dateRange,
    minimumHoldingMinutes,
    sortField,
    descending,
  ]);

  const stats = useMemo(() => {
    let totalWin = 0;
    let totalLoss = 0;
    let winning = 0;
    let holdingSum = 0;
    for (const trade of filteredTrades) {
      holdingSum += trade.holdingMinutes;
      if (trade.profit > 0) {
        winning += 1;
        totalWin += trade.profit;
      } else if (trade.profit < 0) {
        totalLoss += Math.abs(trade.profit);
      }
    }
    return {
      count: filteredTrades.length,
      profit: filteredTrades.reduce((sum, trade) => sum + trade.profit, 0),
      winRate: filteredTrades.length ? winning / filteredTrades.length : 0,
      profitFactor: totalLoss > 0 ? totalWin / totalLoss : null,
      avgHoldingMinutes:
        filteredTrades.length > 0 ? holdingSum / filteredTrades.length : 0,
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

  const applyManualTimeframe = useCallback((next: ReviewTimeframe) => {
    setAutoTimeframe(false);
    setTimeframe(next);
    setFocusRevision((revision) => revision + 1);
  }, []);

  const selectTrade = useCallback((id: string, pageIndex: number) => {
    setSelectedId(id);
    setFocusRevision((revision) => revision + 1);
    setPage(pageIndex + 1);
  }, []);

  const selectedHoldingMs = selectedTrade
    ? Date.parse(selectedTrade.exitTime) - Date.parse(selectedTrade.entryTime)
    : 0;
  const effectiveTimeframe =
    autoTimeframe && selectedTrade
      ? suggestReviewTimeframe(
          Number.isFinite(selectedHoldingMs)
            ? selectedHoldingMs
            : selectedTrade.holdingMinutes * 60_000
        )
      : timeframe;

  const filteredIds = useMemo(
    () => filteredTrades.map((trade) => trade.id),
    [filteredTrades]
  );

  useReviewListKeyboard({
    enabled: Boolean(snapshot),
    itemIds: filteredIds,
    selectedId: selectedTrade?.id,
    pageSize: PAGE_SIZE,
    onSelect: selectTrade,
    onTimeframe: applyManualTimeframe,
  });

  useEffect(() => {
    scrollReviewRowIntoView(listRef.current, selectedTrade?.id);
  }, [safePage, selectedTrade?.id]);

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
          <div className="review-filter-chips">
            <button
              type="button"
              className={direction === '多' ? 'active' : ''}
              onClick={() =>
                setDirection((value) => (value === '多' ? 'all' : '多'))
              }
            >
              多
            </button>
            <button
              type="button"
              className={direction === '空' ? 'active' : ''}
              onClick={() =>
                setDirection((value) => (value === '空' ? 'all' : '空'))
              }
            >
              空
            </button>
            <button
              type="button"
              className={result === 'profit' ? 'active' : ''}
              onClick={() =>
                setResult((value) => (value === 'profit' ? 'all' : 'profit'))
              }
            >
              盈
            </button>
            <button
              type="button"
              className={result === 'loss' ? 'active' : ''}
              onClick={() =>
                setResult((value) => (value === 'loss' ? 'all' : 'loss'))
              }
            >
              亏
            </button>
          </div>
          <div className="bitlang-filter-row">
            <select
              value={dateRange}
              onChange={(event) =>
                setDateRange(event.target.value as DateRangeFilter)
              }
            >
              <option value="all">全部时间</option>
              <option value="1d">近 1 天</option>
              <option value="3d">近 3 天</option>
              <option value="7d">近 7 天</option>
              <option value="30d">近 30 天</option>
              <option value="90d">近 90 天</option>
            </select>
            <select value={instrument} onChange={(event) => setInstrument(event.target.value)}>
              <option value="all">全部交易对</option>
              {instruments.map((item) => (
                <option key={item} value={item}>{bybitSymbol(item)}</option>
              ))}
            </select>
          </div>
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
          <button
            type="button"
            className="review-more-filters"
            onClick={() => setShowMoreFilters((value) => !value)}
          >
            {showMoreFilters ? '收起筛选' : '更多筛选'}
          </button>
          {showMoreFilters && (
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
          )}
        </div>

        <div className="bitlang-progress bitlang-stats-bar">
          <div className="bitlang-stat-item">
            <span>样本</span>
            <strong>{stats.count} 笔</strong>
          </div>
          <div className="bitlang-stat-item">
            <span>总盈亏</span>
            <strong className={stats.profit >= 0 ? 'profit' : 'loss'}>
              {formatNumber(stats.profit)} USDT
            </strong>
          </div>
          <div className="bitlang-stat-item">
            <span>胜率</span>
            <strong>{formatNumber(stats.winRate * 100, 1)}%</strong>
          </div>
          {stats.profitFactor != null && (
            <div className="bitlang-stat-item" title="盈利总额 / 亏损总额">
              <span>盈亏比</span>
              <strong>{formatNumber(stats.profitFactor, 2)}</strong>
            </div>
          )}
          <div className="bitlang-stat-item">
            <span>均持仓</span>
            <strong>{formatHoldingMinutes(stats.avgHoldingMinutes)}</strong>
          </div>
        </div>

        <div className="bitlang-trade-list" ref={listRef}>
          {pageTrades.map((trade) => (
            <button
              type="button"
              key={trade.id}
              data-review-id={trade.id}
              className={`bitlang-trade-row bitlang-trade-row-compact ${
                trade.id === selectedTrade?.id ? 'active' : ''
              }`}
              onClick={() => {
                setSelectedId(trade.id);
                setFocusRevision((revision) => revision + 1);
              }}
            >
              <div className="bitlang-row-top">
                <span className="bitlang-row-main">
                  <strong>{bybitSymbol(trade.instrument)}</strong>
                  <em className={trade.direction === '多' ? 'profit' : 'loss'}>
                    {trade.direction}
                    {` ${formatNumber(trade.leverage, 0)}x`}
                  </em>
                </span>
                <span className={trade.profit >= 0 ? 'profit' : 'loss'}>
                  {formatNumber(trade.profit)}
                </span>
              </div>
              <div className="bitlang-row-bottom">
                <span className="bitlang-row-time">
                  {formatTime(trade.entryTime).slice(5)} · {formatHoldingMinutes(trade.holdingMinutes)}
                </span>
                <span className={trade.profit >= 0 ? 'profit' : 'loss'}>
                  {formatPercent(trade.returnRate)}
                </span>
              </div>
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
        <div className="bitlang-shortcut-hint">
          <span>⌨️ ↑↓ / j k 切交易 · 1-7 切周期</span>
        </div>
      </aside>

      <section className="bitlang-chart-workspace">
        {selectedTrade ? (
          <>
            <header className="bitlang-chart-header">
              <div>
                <h2>{bybitSymbol(selectedTrade.instrument)}</h2>
                <p>
                  {formatTime(selectedTrade.entryTime)} 到{' '}
                  {formatTime(selectedTrade.exitTime)}
                  {` · 持仓 ${formatHoldingMinutes(selectedTrade.holdingMinutes)}`}
                </p>
              </div>
              <div className="bitlang-timeframes">
                <button
                  type="button"
                  className={autoTimeframe ? 'active' : ''}
                  onClick={() => {
                    setAutoTimeframe(true);
                    setFocusRevision((revision) => revision + 1);
                  }}
                  title="按持仓时长自动选择周期"
                >
                  自动
                </button>
                {TIMEFRAMES.map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={item === effectiveTimeframe ? 'active' : ''}
                    onClick={() => {
                      if (!autoTimeframe && item === timeframe) return;
                      applyManualTimeframe(item);
                    }}
                  >
                    {timeframeLabel(item)}
                  </button>
                ))}
                <button
                  type="button"
                  className={showUsSessionBands ? 'active' : ''}
                  onClick={() => setShowUsSessionBands((value) => !value)}
                  title="美股常规交易时段（纽约 09:30–16:00）"
                >
                  美盘
                </button>
                <button
                  type="button"
                  className={showWeekendBands ? 'active' : ''}
                  onClick={() => setShowWeekendBands((value) => !value)}
                  title="美盘周末"
                >
                  周末
                </button>
              </div>
            </header>

            <BitlangTradeChart
              key={`${bybitSymbol(selectedTrade.instrument)}:${effectiveTimeframe}`}
              trade={selectedTrade}
              timeframe={effectiveTimeframe}
              themeMode={themeMode}
              focusRevision={focusRevision}
              showUsSessionBands={showUsSessionBands}
              showWeekendBands={showWeekendBands}
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
  showUsSessionBands,
  showWeekendBands,
}: {
  trade: BitlangTrade;
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
  const [reloadToken, setReloadToken] = useState(0);
  const failedEdgeRef = useRef<'main' | 'earlier' | 'later' | null>(null);
  const earlierRequestRef = useRef<AbortController | null>(null);
  const laterRequestRef = useRef<AbortController | null>(null);
  const contextKeyRef = useRef('');
  const entryTimeMs = Date.parse(trade.entryTime);
  const exitTimeMs = Date.parse(trade.exitTime);
  const symbol = bybitSymbol(trade.instrument);
  const chartContextKey = `${symbol}:${timeframe}:${entryTimeMs}:${exitTimeMs}`;
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
        if (controller.signal.aborted) return;
        failedEdgeRef.current = 'main';
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
      .then((batch) => {
        if (
          !controller.signal.aborted &&
          contextKeyRef.current === requestContextKey
        ) {
          setCandles((current) => mergeCandles(current, batch.candles));
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
      .then((batch) => {
        if (
          !controller.signal.aborted &&
          contextKeyRef.current === requestContextKey
        ) {
          setCandles((current) => mergeCandles(current, batch.candles));
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
          loadedContextKey === chartContextKey
            ? clipTradeFocusRange(entryTimeMs, exitTimeMs, candles, timeframe)
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
        <div className="bitlang-venue-badge bitlang-refreshing">更新中</div>
      )}
      {candles.length > 0 && !(loading && candles.length > 0) && (
        <div className="bitlang-venue-badge">{candleVenueLabel('bybit')}</div>
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

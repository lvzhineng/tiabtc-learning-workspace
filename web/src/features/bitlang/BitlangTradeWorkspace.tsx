import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BarChart2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LayoutDashboard,
  PanelRightOpen,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type { BitlangTag } from '@/api/bitlang-review-api';
import { fetchBitlangReviewState } from '@/api/bitlang-review-api';
import {
  TIMEFRAME_DISPLAY_MAP,
  suggestReviewTimeframe,
  type ReviewTimeframe,
} from '@/domain/timeframe';
import {
  scrollReviewRowIntoView,
  useReviewListKeyboard,
} from '@/features/review-workspace/useReviewListKeyboard';
import { BitlangDashboardWorkspace } from './BitlangDashboardWorkspace';
import { BitlangTradeChart } from './BitlangTradeChart';
import { BitlangTradePanel } from './BitlangTradePanel';
import {
  readLocalUiState,
  storedBoolean,
  storedInteger,
  storedString,
  writeLocalUiState,
} from '@/ui/persistence/local-ui-state';
import {
  bybitSymbol,
  formatHoldingMinutes,
  formatNumber,
  formatPercent,
  formatTradeTime,
} from './bitlang-format';
import type {
  AnnotatedBitlangTrade,
  BitlangDirection,
  BitlangTrade,
  BitlangTradeSnapshot,
} from './bitlang-types';
import '@/styles/bitlang.css';
import '@/styles/position-review.css';

const PAGE_SIZE = 100;
const BITLANG_UI_STORAGE_KEY = 'tiabtc-bitlang-ui-v1';
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

type BitlangUiState = {
  search: string;
  instrument: string;
  direction: 'all' | BitlangDirection;
  result: ResultFilter;
  dateRange: DateRangeFilter;
  minimumHoldingMinutes: string;
  tagFilter: string;
  noNote: boolean;
  noTag: boolean;
  sortField: SortField;
  descending: boolean;
  timeframe: ReviewTimeframe;
  autoTimeframe: boolean;
  showMoreFilters: boolean;
  showUsSessionBands: boolean;
  showWeekendBands: boolean;
  page: number;
  selectedId: string;
  viewMode: 'chart' | 'dashboard';
};

function loadBitlangUiState(): BitlangUiState {
  const stored = readLocalUiState(BITLANG_UI_STORAGE_KEY);
  const minimumHoldingMinutes = storedString(
    stored.minimumHoldingMinutes,
    '',
    undefined,
    16
  );
  const tagFilter = storedString(stored.tagFilter, 'all', undefined, 32);
  return {
    search: storedString(stored.search, ''),
    instrument: storedString(stored.instrument, 'all', undefined, 40),
    direction: storedString(stored.direction, 'all', [
      'all',
      '多',
      '空',
    ]) as BitlangUiState['direction'],
    result: storedString(stored.result, 'all', [
      'all',
      'profit',
      'loss',
    ]) as ResultFilter,
    dateRange: storedString(stored.dateRange, 'all', [
      'all',
      '1d',
      '3d',
      '7d',
      '30d',
      '90d',
    ]) as DateRangeFilter,
    minimumHoldingMinutes:
      minimumHoldingMinutes === '' ||
      (Number.isFinite(Number(minimumHoldingMinutes)) &&
        Number(minimumHoldingMinutes) >= 0)
        ? minimumHoldingMinutes
        : '',
    tagFilter:
      tagFilter === 'all' || /^\d+$/.test(tagFilter) ? tagFilter : 'all',
    noNote: storedBoolean(stored.noNote, false),
    noTag: storedBoolean(stored.noTag, false),
    sortField: storedString(stored.sortField, 'entryTime', [
      'entryTime',
      'profit',
      'returnRate',
      'holdingMinutes',
    ]) as SortField,
    descending: storedBoolean(stored.descending, true),
    timeframe: storedString(stored.timeframe, '60', TIMEFRAMES) as ReviewTimeframe,
    autoTimeframe: storedBoolean(stored.autoTimeframe, true),
    showMoreFilters: storedBoolean(stored.showMoreFilters, false),
    showUsSessionBands: storedBoolean(stored.showUsSessionBands, false),
    showWeekendBands: storedBoolean(stored.showWeekendBands, false),
    page: storedInteger(stored.page, 1, 1),
    selectedId: storedString(stored.selectedId, '', undefined, 128),
    viewMode: storedString(stored.viewMode, 'chart', [
      'chart',
      'dashboard',
    ]) as BitlangUiState['viewMode'],
  };
}

interface BitlangTradeWorkspaceProps {
  themeMode?: 'dark' | 'light';
}

function timeframeLabel(timeframe: ReviewTimeframe): string {
  return TIMEFRAME_DISPLAY_MAP[timeframe];
}

function annotateTrades(
  trades: BitlangTrade[],
  notes: Record<string, string>,
  tagMap: Record<string, number[]>
): AnnotatedBitlangTrade[] {
  return trades.map((trade) => ({
    ...trade,
    note: notes[trade.id] || '',
    tagIds: tagMap[trade.id] || [],
  }));
}

export function BitlangTradeWorkspace({
  themeMode = 'dark',
}: BitlangTradeWorkspaceProps) {
  const [initialUiState] = useState(loadBitlangUiState);
  const [snapshot, setSnapshot] = useState<BitlangTradeSnapshot | null>(null);
  const [dataReady, setDataReady] = useState(false);
  const [annotatedTrades, setAnnotatedTrades] = useState<AnnotatedBitlangTrade[]>(
    []
  );
  const [tags, setTags] = useState<BitlangTag[]>([]);
  const [selectedId, setSelectedId] = useState(initialUiState.selectedId);
  const [focusRevision, setFocusRevision] = useState(0);
  const [search, setSearch] = useState(initialUiState.search);
  const [instrument, setInstrument] = useState(initialUiState.instrument);
  const [direction, setDirection] = useState<'all' | BitlangDirection>(
    initialUiState.direction
  );
  const [result, setResult] = useState<ResultFilter>(initialUiState.result);
  const [dateRange, setDateRange] = useState<DateRangeFilter>(
    initialUiState.dateRange
  );
  const [minimumHoldingMinutes, setMinimumHoldingMinutes] = useState(
    initialUiState.minimumHoldingMinutes
  );
  const [tagFilter, setTagFilter] = useState(initialUiState.tagFilter);
  const [noNote, setNoNote] = useState(initialUiState.noNote);
  const [noTag, setNoTag] = useState(initialUiState.noTag);
  const [sortField, setSortField] = useState<SortField>(initialUiState.sortField);
  const [descending, setDescending] = useState(initialUiState.descending);
  const [timeframe, setTimeframe] = useState<ReviewTimeframe>(
    initialUiState.timeframe
  );
  const [autoTimeframe, setAutoTimeframe] = useState(initialUiState.autoTimeframe);
  const [showMoreFilters, setShowMoreFilters] = useState(
    initialUiState.showMoreFilters
  );
  const [showUsSessionBands, setShowUsSessionBands] = useState(
    initialUiState.showUsSessionBands
  );
  const [showWeekendBands, setShowWeekendBands] = useState(
    initialUiState.showWeekendBands
  );
  const [showDetails, setShowDetails] = useState(false);
  const [page, setPage] = useState(initialUiState.page);
  const [error, setError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const [viewMode, setViewMode] = useState<'chart' | 'dashboard'>(() => {
    const requestedView = new URLSearchParams(window.location.search).get('view');
    return requestedView === 'dashboard' || requestedView === 'chart'
      ? requestedView
      : initialUiState.viewMode;
  });
  const deferredSearch = useDeferredValue(search);
  const pendingRevealIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const filterSignature = JSON.stringify({
    search,
    instrument,
    direction,
    result,
    dateRange,
    minimumHoldingMinutes,
    sortField,
    descending,
    tagFilter,
    noNote,
    noTag,
  });
  const previousFilterSignatureRef = useRef(filterSignature);

  useEffect(() => {
    let active = true;
    setDataReady(false);
    void loadBitlangSnapshot()
      .then(async (data) => {
        if (!active) return;
        setSnapshot(data);
        setSelectedId((current) =>
          current && data.trades.some((trade) => trade.id === current)
            ? current
            : data.trades[0]?.id || ''
        );
        setError(null);
        try {
          const annotations = await fetchBitlangReviewState();
          if (!active) return;
          setTags(annotations.tags);
          setAnnotatedTrades(
            annotateTrades(data.trades, annotations.notes, annotations.tagMap)
          );
        } catch (cause) {
          if (!active) return;
          setError(
            cause instanceof Error
              ? `复盘注释读取失败：${cause.message}`
              : '复盘注释读取失败'
          );
        }
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : '交割单读取失败');
      })
      .finally(() => {
        if (active) setDataReady(true);
      });
    return () => {
      active = false;
    };
  }, [loadRevision]);

  const instruments = useMemo(
    () =>
      Array.from(
        new Set(annotatedTrades.map((trade) => trade.instrument))
      ).sort(),
    [annotatedTrades]
  );

  useEffect(() => {
    if (!dataReady || !snapshot) return;
    if (instrument !== 'all' && !instruments.includes(instrument)) {
      setInstrument('all');
    }
    if (
      tagFilter !== 'all' &&
      !tags.some((tag) => String(tag.id) === tagFilter)
    ) {
      setTagFilter('all');
    }
  }, [dataReady, instrument, instruments, snapshot, tagFilter, tags]);

  const snapshotEndMs = useMemo(
    () =>
      annotatedTrades.reduce(
        (latest, trade) => Math.max(latest, Date.parse(trade.entryTime) || 0),
        0
      ),
    [annotatedTrades]
  );

  const filteredTrades = useMemo(() => {
    const keyword = deferredSearch.trim().toLowerCase();
    const holdingMinutesThreshold = Number(minimumHoldingMinutes);
    const hasHoldingMinutesThreshold =
      minimumHoldingMinutes !== '' &&
      Number.isFinite(holdingMinutesThreshold) &&
      holdingMinutesThreshold > 0;
    const cutoffMs =
      dateRange === 'all' ? 0 : snapshotEndMs - DATE_RANGE_MS_MAP[dateRange];
    const tagId = tagFilter === 'all' ? null : Number(tagFilter);
    return annotatedTrades
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
        if (tagId != null && !trade.tagIds.includes(tagId)) return false;
        if (noNote && trade.note.trim()) return false;
        if (noTag && trade.tagIds.length > 0) return false;
        if (!keyword) return true;
        const tagNames = trade.tagIds
          .map((id) => tags.find((tag) => tag.id === id)?.name || '')
          .join(' ');
        return `${trade.sequence} ${trade.instrument} ${trade.sourceNote} ${trade.note} ${tagNames}`
          .toLowerCase()
          .includes(keyword);
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
    annotatedTrades,
    dateRange,
    deferredSearch,
    descending,
    direction,
    instrument,
    minimumHoldingMinutes,
    noNote,
    noTag,
    result,
    snapshotEndMs,
    sortField,
    tagFilter,
    tags,
  ]);

  useEffect(() => {
    if (previousFilterSignatureRef.current === filterSignature) return;
    previousFilterSignatureRef.current = filterSignature;
    setPage(1);
  }, [filterSignature]);

  const stats = useMemo(() => {
    let totalWin = 0;
    let totalLoss = 0;
    let winning = 0;
    let holdingSum = 0;
    let totalFee = 0;
    for (const trade of filteredTrades) {
      holdingSum += trade.holdingMinutes;
      totalFee += Math.abs(trade.fee || 0);
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
      totalFee,
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
    if (dataReady && page !== safePage) setPage(safePage);
  }, [dataReady, page, safePage]);

  useEffect(() => {
    writeLocalUiState(BITLANG_UI_STORAGE_KEY, {
      search,
      instrument,
      direction,
      result,
      dateRange,
      minimumHoldingMinutes,
      tagFilter,
      noNote,
      noTag,
      sortField,
      descending,
      timeframe,
      autoTimeframe,
      showMoreFilters,
      showUsSessionBands,
      showWeekendBands,
      page,
      selectedId,
      viewMode,
    });
  }, [
    autoTimeframe,
    dateRange,
    descending,
    direction,
    instrument,
    minimumHoldingMinutes,
    noNote,
    noTag,
    page,
    result,
    search,
    selectedId,
    showMoreFilters,
    showUsSessionBands,
    showWeekendBands,
    sortField,
    tagFilter,
    timeframe,
    viewMode,
  ]);

  useEffect(() => {
    if (pendingRevealIdRef.current) return;
    if (selectedTrade && selectedTrade.id !== selectedId) {
      setSelectedId(selectedTrade.id);
    }
  }, [selectedId, selectedTrade]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (viewMode === 'dashboard') url.searchParams.set('view', 'dashboard');
    else url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
  }, [viewMode]);

  useEffect(() => {
    const revealId = pendingRevealIdRef.current;
    if (!revealId) return;
    const index = filteredTrades.findIndex((trade) => trade.id === revealId);
    if (index < 0) return;
    setPage(Math.floor(index / PAGE_SIZE) + 1);
    setSelectedId(revealId);
    pendingRevealIdRef.current = null;
  }, [filteredTrades]);

  const filteredRef = useRef(filteredTrades);
  filteredRef.current = filteredTrades;

  const openTradeOnChart = useCallback((tradeId: string) => {
    pendingRevealIdRef.current = tradeId;
    const visibleIndex = filteredRef.current.findIndex(
      (trade) => trade.id === tradeId
    );
    if (visibleIndex >= 0) {
      setPage(Math.floor(visibleIndex / PAGE_SIZE) + 1);
      pendingRevealIdRef.current = null;
    } else {
      setSearch('');
      setDateRange('all');
      setInstrument('all');
      setDirection('all');
      setResult('all');
      setTagFilter('all');
      setNoNote(false);
      setNoTag(false);
      setMinimumHoldingMinutes('');
    }
    setSelectedId(tradeId);
    setViewMode('chart');
    setFocusRevision((revision) => revision + 1);
  }, []);

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
    enabled: Boolean(snapshot) && viewMode === 'chart',
    itemIds: filteredIds,
    selectedId: selectedTrade?.id,
    pageSize: PAGE_SIZE,
    onSelect: selectTrade,
    onTimeframe: applyManualTimeframe,
  });

  useEffect(() => {
    scrollReviewRowIntoView(listRef.current, selectedTrade?.id);
  }, [safePage, selectedTrade?.id]);

  const updateSelected = (next: AnnotatedBitlangTrade) => {
    setAnnotatedTrades((current) =>
      current.map((item) => (item.id === next.id ? next : item))
    );
  };

  const handleTagDeleted = (deletedId: number) => {
    setTags((current) => current.filter((tag) => tag.id !== deletedId));
    setAnnotatedTrades((current) =>
      current.map((trade) => ({
        ...trade,
        tagIds: trade.tagIds.filter((id) => id !== deletedId),
      }))
    );
    if (tagFilter === String(deletedId)) setTagFilter('all');
  };

  if (error) {
    return (
      <div className="bitlang-state">
        <span>{error}</span>
        <button
          type="button"
          className="bitlang-state-action"
          onClick={() => {
            setError(null);
            setSnapshot(null);
            setLoadRevision((revision) => revision + 1);
          }}
        >
          重试
        </button>
      </div>
    );
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
          <div className="posrev-view-switch">
            <button
              type="button"
              className={viewMode === 'chart' ? 'active' : ''}
              onClick={() => setViewMode('chart')}
            >
              <BarChart2 size={13} />
              K 线
            </button>
            <button
              type="button"
              className={viewMode === 'dashboard' ? 'active' : ''}
              onClick={() => setViewMode('dashboard')}
            >
              <LayoutDashboard size={13} />
              看板
            </button>
          </div>
        </div>

        <div className="bitlang-sidebar-filters">
          <label className="bitlang-search">
            <Search size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索交易对、序号、备注或标签"
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
            <button
              type="button"
              className={noNote ? 'active' : ''}
              onClick={() => setNoNote((value) => !value)}
            >
              未备注
            </button>
            <button
              type="button"
              className={noTag ? 'active' : ''}
              onClick={() => setNoTag((value) => !value)}
            >
              未打标
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
            <select
              value={instrument}
              onChange={(event) => setInstrument(event.target.value)}
            >
              <option value="all">全部交易对</option>
              {instruments.map((item) => (
                <option key={item} value={item}>
                  {bybitSymbol(item)}
                </option>
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
            <>
              <div className="bitlang-filter-row">
                <select
                  value={tagFilter}
                  onChange={(event) => setTagFilter(event.target.value)}
                >
                  <option value="all">全部标签</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={String(tag.id)}>
                      {tag.name}
                    </option>
                  ))}
                </select>
                <span />
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
            </>
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
          {stats.totalFee > 0 && (
            <div className="bitlang-stat-item" title="交割单手续费合计">
              <span>手续费</span>
              <strong>-{formatNumber(stats.totalFee, 2)}</strong>
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
              className={`bitlang-trade-row posrev-trade-row ${
                trade.id === selectedTrade?.id ? 'active' : ''
              }`}
              onClick={() => {
                setSelectedId(trade.id);
                setFocusRevision((revision) => revision + 1);
              }}
            >
              <div className="posrev-row-top">
                <div className="posrev-row-sym">
                  <strong>{bybitSymbol(trade.instrument)}</strong>
                  <span
                    className={`posrev-side-badge ${
                      trade.direction === '多' ? 'long' : 'short'
                    }`}
                  >
                    {trade.direction}
                    {` ${formatNumber(trade.leverage, 0)}x`}
                  </span>
                </div>
                <span className="posrev-row-time">
                  {formatTradeTime(trade.entryTime).slice(5)}
                </span>
              </div>
              <div className="posrev-row-bottom">
                <div className="posrev-row-meta">
                  <span className="posrev-duration" title="持仓时长">
                    ⏱ {formatHoldingMinutes(trade.holdingMinutes)}
                  </span>
                  {trade.tagIds.length > 0 && (
                    <div className="posrev-tag-pills">
                      {trade.tagIds.slice(0, 2).map((tagId) => {
                        const tag = tags.find((entry) => entry.id === tagId);
                        if (!tag) return null;
                        return (
                          <span
                            key={tag.id}
                            className="posrev-tag-pill"
                            style={{ borderColor: tag.color, color: tag.color }}
                          >
                            {tag.name}
                          </span>
                        );
                      })}
                      {trade.tagIds.length > 2 && (
                        <span className="posrev-tag-pill-more">
                          +{trade.tagIds.length - 2}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="posrev-row-pnl">
                  <strong className={trade.profit >= 0 ? 'profit' : 'loss'}>
                    {trade.profit >= 0 ? '+' : ''}
                    {formatNumber(trade.profit)}
                  </strong>
                  <span
                    className={`posrev-roi ${
                      trade.returnRate >= 0 ? 'profit' : 'loss'
                    }`}
                  >
                    {formatPercent(trade.returnRate)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="bitlang-pagination">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
          >
            <ChevronLeft size={14} />
          </button>
          <span>
            {safePage} / {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount}
            onClick={() => setPage(safePage + 1)}
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="bitlang-shortcut-hint">
          <span>⌨️ ↑↓ / j k 切交易 · 1-7 切周期</span>
        </div>
      </aside>

      {viewMode === 'dashboard' ? (
        <section className="bitlang-chart-workspace posrev-dashboard-pane">
          <BitlangDashboardWorkspace
            themeMode={themeMode}
            trades={annotatedTrades}
            tags={tags}
            snapshotEndMs={snapshotEndMs}
            onNoteUpdated={(tradeId, note) => {
              setAnnotatedTrades((current) =>
                current.map((item) =>
                  item.id === tradeId ? { ...item, note } : item
                )
              );
            }}
            onNavigateToTrade={openTradeOnChart}
          />
        </section>
      ) : (
        <section className="bitlang-chart-workspace posrev-chart-workspace">
          {selectedTrade ? (
            <>
              <header className="bitlang-chart-header">
                <div>
                  <div className="posrev-chart-title">
                    <h2>{bybitSymbol(selectedTrade.instrument)}</h2>
                    <span
                      className={`posrev-side-badge ${
                        selectedTrade.direction === '多' ? 'long' : 'short'
                      }`}
                    >
                      {selectedTrade.direction}
                      {` ${formatNumber(selectedTrade.leverage, 0)}x`}
                    </span>
                    <strong
                      className={`posrev-header-pnl ${
                        selectedTrade.profit >= 0 ? 'profit' : 'loss'
                      }`}
                    >
                      {selectedTrade.profit >= 0 ? '+' : ''}
                      {formatNumber(selectedTrade.profit)} USDT
                    </strong>
                    <button
                      type="button"
                      className={`posrev-detail-toggle ${showDetails ? 'active' : ''}`}
                      aria-expanded={showDetails}
                      onClick={() => setShowDetails((value) => !value)}
                    >
                      <PanelRightOpen size={14} />
                      复盘详情
                    </button>
                  </div>
                  <p>
                    {formatTradeTime(selectedTrade.entryTime)} 到{' '}
                    {formatTradeTime(selectedTrade.exitTime)}
                    {` · 持仓 ${formatHoldingMinutes(selectedTrade.holdingMinutes)}`}
                  </p>
                </div>
                <div className="posrev-chart-header-actions">
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
                </div>
              </header>

              <BitlangTradeChart
                key={`${selectedTrade.id}:${bybitSymbol(selectedTrade.instrument)}:${effectiveTimeframe}`}
                trade={selectedTrade}
                timeframe={effectiveTimeframe}
                themeMode={themeMode}
                focusRevision={focusRevision}
                showUsSessionBands={showUsSessionBands}
                showWeekendBands={showWeekendBands}
              />

              {showDetails && (
                <aside className="posrev-detail-drawer" aria-label="交易复盘详情">
                  <header className="posrev-detail-drawer-header">
                    <div>
                      <strong>复盘详情</strong>
                      <span>{bybitSymbol(selectedTrade.instrument)}</span>
                    </div>
                    <button
                      type="button"
                      aria-label="关闭复盘详情"
                      title="关闭"
                      onClick={() => setShowDetails(false)}
                    >
                      <X size={16} />
                    </button>
                  </header>
                  <div className="posrev-detail-drawer-body">
                    <BitlangTradePanel
                      key={selectedTrade.id}
                      trade={selectedTrade}
                      tags={tags}
                      onChange={updateSelected}
                      onTagsCreated={(tag) =>
                        setTags((current) => [...current, tag])
                      }
                      onTagDeleted={handleTagDeleted}
                    />
                  </div>
                </aside>
              )}
            </>
          ) : (
            <div className="bitlang-state">没有符合筛选条件的交易。</div>
          )}
        </section>
      )}
    </div>
  );
}

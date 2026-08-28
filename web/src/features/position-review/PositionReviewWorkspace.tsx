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
  KeyRound,
  LayoutDashboard,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  fetchPositionReviewState,
  fetchVenueCacheAudit,
  saveBitgetCredentials,
  syncBitgetPositions,
} from '@/api/position-review-api';
import {
  TIMEFRAME_DISPLAY_MAP,
  suggestReviewTimeframe,
  type ReviewTimeframe,
} from '@/domain/timeframe';
import {
  scrollReviewRowIntoView,
  useReviewListKeyboard,
} from '@/features/review-workspace/useReviewListKeyboard';
import { PositionDashboardWorkspace } from '@/features/position-dashboard/PositionDashboardWorkspace';
import { toast } from '@/ui/feedback/toast';
import type { PositionTag, ReviewPosition } from './position-review-types';
import { positionPnl } from './position-review-types';
import { summarizePositions } from './position-stats';
import { PositionReviewChart } from './PositionReviewChart';
import { PositionReviewPanel } from './PositionReviewPanel';
import {
  calculatePositionRoi,
  formatHoldingDuration,
  formatNumber,
  formatRoi,
  formatShanghaiTime,
  formatShanghaiTimeShort,
} from './position-review-format';
import '@/styles/bitlang.css';
import '@/styles/position-review.css';

const PAGE_SIZE = 80;
const TIMEFRAMES: ReviewTimeframe[] = ['1', '5', '15', '60', '240', 'D', 'W'];
const SYNC_STALE_MS = 24 * 60 * 60 * 1000;

type ResultFilter = 'all' | 'profit' | 'loss';
type StatusFilter = 'all' | 'open' | 'closed';
type SideFilter = 'all' | 'long' | 'short';
type SortField = 'entryTimeMs' | 'netPnl';
type DateRangeFilter = 'all' | '1d' | '3d' | '7d' | '30d' | '90d';

const DATE_RANGE_MS_MAP: Record<Exclude<DateRangeFilter, 'all'>, number> = {
  '1d': 1 * 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

interface PositionReviewWorkspaceProps {
  themeMode?: 'dark' | 'light';
}

function timeframeLabel(timeframe: ReviewTimeframe): string {
  return TIMEFRAME_DISPLAY_MAP[timeframe];
}

export function PositionReviewWorkspace({
  themeMode = 'dark',
}: PositionReviewWorkspaceProps) {
  const [configured, setConfigured] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [balanceTotal, setBalanceTotal] = useState<number | null>(null);
  const [positions, setPositions] = useState<ReviewPosition[]>([]);
  const [tags, setTags] = useState<PositionTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCredentials, setShowCredentials] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [auditingCache, setAuditingCache] = useState(false);

  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all');
  const [symbolFilter, setSymbolFilter] = useState('all');
  const [side, setSide] = useState<SideFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [result, setResult] = useState<ResultFilter>('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [noNote, setNoNote] = useState(false);
  const [noTag, setNoTag] = useState(false);
  const [sortField, setSortField] = useState<SortField>('entryTimeMs');
  const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const [timeframe, setTimeframe] = useState<ReviewTimeframe>('15');
  const [autoTimeframe, setAutoTimeframe] = useState(true);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showUsSessionBands, setShowUsSessionBands] = useState(false);
  const [showWeekendBands, setShowWeekendBands] = useState(false);
  const [viewMode, setViewMode] = useState<'chart' | 'dashboard'>(() => {
    return new URLSearchParams(window.location.search).get('view') === 'dashboard'
      ? 'dashboard'
      : 'chart';
  });
  const pendingRevealIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const applyState = useCallback(
    (state: {
      configured: boolean;
      syncedAt: string | null;
      balance: { total: number | null } | null;
      positions: ReviewPosition[];
      tags: PositionTag[];
    }) => {
      setConfigured(state.configured);
      setSyncedAt(state.syncedAt);
      setBalanceTotal(state.balance?.total ?? null);
      setPositions(state.positions);
      setTags(state.tags);
      setShowCredentials(!state.configured);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    fetchPositionReviewState()
      .then((state) => {
        if (!cancelled) {
          applyState(state);
          setError(null);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : '读取仓位复盘失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyState]);

  const symbols = useMemo(() => {
    return [...new Set(positions.map((item) => item.chartSymbol))].sort();
  }, [positions]);

  const filtered = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    const tagId = tagFilter === 'all' ? null : Number(tagFilter);
    const cutoffMs =
      dateRange === 'all' ? 0 : Date.now() - DATE_RANGE_MS_MAP[dateRange];

    const next = positions.filter((item) => {
      if (cutoffMs > 0) {
        const tradeTime = item.exitTimeMs || item.entryTimeMs;
        if (tradeTime < cutoffMs) return false;
      }
      if (symbolFilter !== 'all' && item.chartSymbol !== symbolFilter) return false;
      if (side !== 'all' && item.side !== side) return false;
      if (status !== 'all' && item.status !== status) return false;
      const pnl = positionPnl(item);
      if (result === 'profit' && pnl <= 0) return false;
      if (result === 'loss' && pnl >= 0) return false;
      if (tagId != null && !item.tagIds.includes(tagId)) return false;
      if (noNote && item.note.trim()) return false;
      if (noTag && item.tagIds.length > 0) return false;
      if (query) {
        const tagNames = item.tagIds
          .map((id) => tags.find((tag) => tag.id === id)?.name || '')
          .join(' ');
        const haystack = `${item.chartSymbol} ${item.unifiedSymbol} ${item.note} ${tagNames}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    next.sort((left, right) => {
      const leftValue =
        sortField === 'netPnl' ? positionPnl(left) : left.entryTimeMs;
      const rightValue =
        sortField === 'netPnl' ? positionPnl(right) : right.entryTimeMs;
      return descending ? rightValue - leftValue : leftValue - rightValue;
    });
    const open = next.filter((item) => item.status === 'open');
    const closed = next.filter((item) => item.status !== 'open');
    return [...open, ...closed];
  }, [
    dateRange,
    deferredSearch,
    descending,
    noNote,
    noTag,
    positions,
    result,
    side,
    sortField,
    status,
    symbolFilter,
    tagFilter,
    tags,
  ]);

  useEffect(() => {
    setPage(0);
  }, [
    dateRange,
    deferredSearch,
    descending,
    noNote,
    noTag,
    result,
    side,
    sortField,
    status,
    symbolFilter,
    tagFilter,
  ]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageTrades = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE
  );
  const selected =
    pageTrades.find((item) => item.positionId === selectedId) ||
    pageTrades[0] ||
    null;

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    if (pendingRevealIdRef.current) return;
    if (selected && selected.positionId !== selectedId) {
      setSelectedId(selected.positionId);
    }
  }, [selected, selectedId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (viewMode === 'dashboard') url.searchParams.set('view', 'dashboard');
    else url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
  }, [viewMode]);

  useEffect(() => {
    const revealId = pendingRevealIdRef.current;
    if (!revealId) return;
    const index = filtered.findIndex((item) => item.positionId === revealId);
    if (index < 0) return;
    setPage(Math.floor(index / PAGE_SIZE));
    setSelectedId(revealId);
    pendingRevealIdRef.current = null;
  }, [filtered]);

  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  const openPositionOnChart = useCallback((positionId: string) => {
    pendingRevealIdRef.current = positionId;
    const visibleIndex = filteredRef.current.findIndex(
      (item) => item.positionId === positionId
    );
    if (visibleIndex >= 0) {
      setPage(Math.floor(visibleIndex / PAGE_SIZE));
      pendingRevealIdRef.current = null;
    } else {
      setSearch('');
      setDateRange('all');
      setSymbolFilter('all');
      setSide('all');
      setStatus('all');
      setResult('all');
      setTagFilter('all');
      setNoNote(false);
      setNoTag(false);
    }
    setSelectedId(positionId);
    setViewMode('chart');
    setFocusRevision((revision) => revision + 1);
  }, []);

  const applyManualTimeframe = useCallback((next: ReviewTimeframe) => {
    setAutoTimeframe(false);
    setTimeframe(next);
    setFocusRevision((revision) => revision + 1);
  }, []);

  const selectPosition = useCallback((positionId: string, pageIndex: number) => {
    setSelectedId(positionId);
    setFocusRevision((revision) => revision + 1);
    setPage(pageIndex);
  }, []);

  const effectiveTimeframe =
    autoTimeframe && selected
      ? suggestReviewTimeframe(
          (selected.exitTimeMs ?? Date.now()) - selected.entryTimeMs
        )
      : timeframe;

  const filteredIds = useMemo(
    () => filtered.map((item) => item.positionId),
    [filtered]
  );

  useReviewListKeyboard({
    enabled: viewMode === 'chart',
    itemIds: filteredIds,
    selectedId: selected?.positionId,
    pageSize: PAGE_SIZE,
    onSelect: selectPosition,
    onTimeframe: applyManualTimeframe,
  });

  useEffect(() => {
    scrollReviewRowIntoView(listRef.current, selected?.positionId);
  }, [page, selected?.positionId]);

  const stats = useMemo(() => summarizePositions(filtered), [filtered]);
  const syncedAtMs = syncedAt ? Date.parse(syncedAt) : NaN;
  const isSyncStale =
    Number.isFinite(syncedAtMs) && Date.now() - syncedAtMs > SYNC_STALE_MS;

  const handleSaveCredentials = async () => {
    setSavingCredentials(true);
    setError(null);
    try {
      await saveBitgetCredentials({ apiKey, secret, passphrase });
      setApiKey('');
      setSecret('');
      setPassphrase('');
      setConfigured(true);
      setShowCredentials(false);
      toast.success('Bitget 只读密钥已成功加密保存');
    } catch (cause) {
      const errMsg = cause instanceof Error ? cause.message : '保存密钥失败';
      setError(errMsg);
      toast.error(errMsg);
    } finally {
      setSavingCredentials(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const state = await syncBitgetPositions();
      applyState(state);
      toast.success(`同步完成，共获取 ${state.positions.length} 笔仓位`);
    } catch (cause) {
      const errMsg = cause instanceof Error ? cause.message : '同步失败';
      setError(errMsg);
      toast.error(errMsg);
    } finally {
      setSyncing(false);
    }
  };

  const handleCacheAudit = async () => {
    setAuditingCache(true);
    try {
      const report = await fetchVenueCacheAudit();
      if (report.inconsistentCount === 0 && !report.scanTruncated) {
        toast.success(
          `Bitget 回退缓存只读审计通过，共 ${report.rangeCount} 条区间一致。未改库。`
        );
        return;
      }
      if (report.inconsistentCount === 0) {
        toast.warning(
          `本次只读审计完成 ${report.auditedRangeCount}/${report.rangeCount} 条区间，已达到扫描上限；已审计部分未发现不一致，未改库。`
        );
        return;
      }
      const sample = report.inconsistent
        .slice(0, 3)
        .map((item) => `${item.symbol} ${item.interval}: ${item.issues.join(',')}`)
        .join('；');
      toast.warning(
        `已审计 ${report.auditedRangeCount}/${report.rangeCount} 条区间，发现 ${report.inconsistentCount} 条不一致（只读，未修复）。${sample}`
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '缓存审计失败');
    } finally {
      setAuditingCache(false);
    }
  };

  const updateSelected = (next: ReviewPosition) => {
    setPositions((current) =>
      current.map((item) =>
        item.positionId === next.positionId ? next : item
      )
    );
  };

  const handleTagDeleted = (deletedId: number) => {
    setTags((current) => current.filter((tag) => tag.id !== deletedId));
    setPositions((current) =>
      current.map((pos) => ({
        ...pos,
        tagIds: pos.tagIds.filter((id) => id !== deletedId),
      }))
    );
    if (tagFilter === String(deletedId)) {
      setTagFilter('all');
    }
  };

  if (loading) {
    return (
      <div className="bitlang-state">
        <RefreshCw size={20} className="spin" />
        正在读取仓位复盘...
      </div>
    );
  }

  return (
    <div className="bitlang-review-shell">
      <aside className="bitlang-sidebar">
        <div className="bitlang-sidebar-title">
          <div>
            <strong>仓位复盘</strong>
            <span>
              Bitget UTA
              {balanceTotal != null ? ` · ${formatNumber(balanceTotal)} USDT` : ''}
            </span>
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

        <div className="bitlang-sidebar-filters posrev-toolbar">
          <div className="bitlang-filter-row">
            <button type="button" onClick={handleSync} disabled={syncing || !configured}>
              <RefreshCw size={14} className={syncing ? 'spin' : ''} />
              {syncing ? '同步中' : '同步'}
            </button>
            <button
              type="button"
              onClick={() => setShowCredentials((value) => !value)}
            >
              <KeyRound size={14} />
              密钥
            </button>
          </div>
          {showCredentials && (
            <div className="posrev-credentials">
              <p>只需只读权限，密钥加密保存在本机，不会回传到页面。</p>
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="API Key"
                type="password"
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck={false}
              />
              <input
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder="Secret"
                type="password"
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck={false}
              />
              <input
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder="Passphrase"
                type="password"
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => void handleSaveCredentials()}
                disabled={
                  savingCredentials ||
                  !apiKey.trim() ||
                  !secret.trim() ||
                  !passphrase.trim()
                }
              >
                {savingCredentials ? '保存中' : '保存密钥'}
              </button>
              <button
                type="button"
                onClick={() => void handleCacheAudit()}
                disabled={auditingCache}
              >
                {auditingCache ? '审计中' : '审计 Bitget 回退缓存'}
              </button>
            </div>
          )}
          {syncedAt && (
            <span className="posrev-synced">
              上次同步 {formatShanghaiTime(Date.parse(syncedAt))}
            </span>
          )}
          {isSyncStale && (
            <span className="posrev-stale-banner">
              数据可能不是最新（上次同步超过 24 小时），请手动同步。
            </span>
          )}
          {error && <span className="posrev-error">{error}</span>}

          <label className="bitlang-search">
            <Search size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索交易对、备注或标签"
            />
          </label>
          <div className="review-filter-chips">
            <button
              type="button"
              className={side === 'long' ? 'active' : ''}
              onClick={() => setSide((value) => (value === 'long' ? 'all' : 'long'))}
            >
              多
            </button>
            <button
              type="button"
              className={side === 'short' ? 'active' : ''}
              onClick={() => setSide((value) => (value === 'short' ? 'all' : 'short'))}
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
              className={status === 'open' ? 'active' : ''}
              onClick={() =>
                setStatus((value) => (value === 'open' ? 'all' : 'open'))
              }
            >
              持仓中
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
              onChange={(event) => setDateRange(event.target.value as DateRangeFilter)}
            >
              <option value="all">全部时间</option>
              <option value="1d">近 1 天</option>
              <option value="3d">近 3 天</option>
              <option value="7d">近 7 天</option>
              <option value="30d">近 30 天</option>
              <option value="90d">近 90 天</option>
            </select>
            <select
              value={symbolFilter}
              onChange={(event) => setSymbolFilter(event.target.value)}
            >
              <option value="all">全部交易对</option>
              {symbols.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="bitlang-filter-row">
            <select
              value={sortField}
              onChange={(event) => setSortField(event.target.value as SortField)}
            >
              <option value="entryTimeMs">开仓时间</option>
              <option value="netPnl">净盈亏</option>
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
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as StatusFilter)}
              >
                <option value="all">开/平</option>
                <option value="open">持仓中</option>
                <option value="closed">已平仓</option>
              </select>
            </div>
          )}
        </div>

        <div className="bitlang-progress posrev-stats-bar">
          <div className="posrev-stat-item">
            <span>已平仓样本</span>
            <strong>{stats.closedCount} 笔</strong>
          </div>
          {stats.count !== stats.closedCount && (
            <div className="posrev-stat-item">
              <span>含持仓</span>
              <strong>{stats.count} 笔</strong>
            </div>
          )}
          <div className="posrev-stat-item">
            <span>总盈亏</span>
            <strong className={stats.totalPnl >= 0 ? 'profit' : 'loss'}>
              {stats.totalPnl >= 0 ? '+' : ''}{formatNumber(stats.totalPnl)} USDT
            </strong>
          </div>
          <div className="posrev-stat-item">
            <span>胜率</span>
            <strong>{formatNumber(stats.winRate, 1)}%</strong>
          </div>
          {stats.profitFactor != null && (
            <div className="posrev-stat-item" title="已平仓盈利总额 / 亏损总额">
              <span>盈亏比</span>
              <strong>{formatNumber(stats.profitFactor, 2)}</strong>
            </div>
          )}
          {stats.totalFee > 0 && (
            <div className="posrev-stat-item" title="总手续费支出">
              <span>手续费</span>
              <span>-{formatNumber(stats.totalFee, 2)}</span>
            </div>
          )}
        </div>

        <div className="bitlang-trade-list" ref={listRef}>
          {pageTrades.map((item, index) => {
            const pnl = positionPnl(item);
            const roi = calculatePositionRoi(item);
            const prev = pageTrades[index - 1];
            const showOpenHeader = item.status === 'open' && index === 0;
            const showClosedHeader =
              item.status !== 'open' && (!prev || prev.status === 'open');
            return (
              <div key={item.positionId}>
                {showOpenHeader && (
                  <div className="review-list-section">持仓中</div>
                )}
                {showClosedHeader && (
                  <div className="review-list-section">已平仓</div>
                )}
              <button
                type="button"
                data-review-id={item.positionId}
                className={`bitlang-trade-row posrev-trade-row ${
                  item.positionId === selected?.positionId ? 'active' : ''
                }`}
                onClick={() => {
                  setSelectedId(item.positionId);
                  setFocusRevision((revision) => revision + 1);
                }}
              >
                <div className="posrev-row-top">
                  <div className="posrev-row-sym">
                    <strong>{item.chartSymbol}</strong>
                    <span className={`posrev-side-badge ${item.side}`}>
                      {item.side === 'long' ? '多' : '空'}
                      {item.leverage ? ` ${Math.round(item.leverage)}x` : ''}
                    </span>
                    {item.status === 'open' && (
                      <span className="posrev-open-badge">持仓中</span>
                    )}
                  </div>
                  <span className="posrev-row-time">
                    {formatShanghaiTimeShort(item.entryTimeMs)}
                  </span>
                </div>

                <div className="posrev-row-bottom">
                  <div className="posrev-row-meta">
                    <span className="posrev-duration" title="持仓时长">
                      ⏱ {formatHoldingDuration(item.entryTimeMs, item.exitTimeMs)}
                    </span>
                    {item.tagIds.length > 0 && (
                      <div className="posrev-tag-pills">
                        {item.tagIds.slice(0, 2).map((tagId) => {
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
                        {item.tagIds.length > 2 && (
                          <span className="posrev-tag-pill-more">
                            +{item.tagIds.length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="posrev-row-pnl">
                    <strong className={pnl >= 0 ? 'profit' : 'loss'}>
                      {pnl >= 0 ? '+' : ''}{formatNumber(pnl)}
                    </strong>
                    {roi != null && (
                      <span className={`posrev-roi ${roi >= 0 ? 'profit' : 'loss'}`}>
                        {formatRoi(roi)}
                      </span>
                    )}
                  </div>
                </div>
              </button>
              </div>
            );
          })}
        </div>

        <div className="bitlang-pagination">
          <button
            type="button"
            disabled={safePage <= 0}
            onClick={() => setPage(Math.max(0, safePage - 1))}
          >
            <ChevronLeft size={14} />
          </button>
          <span>
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage + 1 >= pageCount}
            onClick={() => setPage(safePage + 1)}
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="posrev-shortcut-hint">
          <span>⌨️ ↑↓ / j k 切仓位 · 1-7 切周期</span>
        </div>
      </aside>

      {viewMode === 'dashboard' ? (
        <section className="bitlang-chart-workspace posrev-dashboard-pane">
          <PositionDashboardWorkspace
            themeMode={themeMode}
            positions={positions}
            tags={tags}
            configured={configured}
            balanceTotal={balanceTotal}
            syncing={syncing}
            onSync={handleSync}
            onNoteUpdated={(positionId, note) => {
              setPositions((current) =>
                current.map((item) =>
                  item.positionId === positionId ? { ...item, note } : item
                )
              );
            }}
            onNavigateToPosition={openPositionOnChart}
          />
        </section>
      ) : (
      <section className="bitlang-chart-workspace posrev-chart-workspace">
        {selected ? (
          <>
            <header className="bitlang-chart-header">
              <div>
                <h2>{selected.chartSymbol}</h2>
                <p>
                  {formatShanghaiTime(selected.entryTimeMs)}
                  {selected.exitTimeMs
                    ? ` 到 ${formatShanghaiTime(selected.exitTimeMs)}`
                    : ' 持仓中'}
                  {` · 持仓时长 ${formatHoldingDuration(selected.entryTimeMs, selected.exitTimeMs)}`}
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
            <PositionReviewChart
              key={`${selected.chartSymbol}:${effectiveTimeframe}`}
              position={selected}
              timeframe={effectiveTimeframe}
              themeMode={themeMode}
              focusRevision={focusRevision}
              showUsSessionBands={showUsSessionBands}
              showWeekendBands={showWeekendBands}
            />
            <PositionReviewPanel
              key={selected.positionId}
              position={selected}
              tags={tags}
              onChange={updateSelected}
              onTagsCreated={(tag) => setTags((current) => [...current, tag])}
              onTagDeleted={handleTagDeleted}
            />
          </>
        ) : (
          <div className="bitlang-state">
            {configured ? '没有符合筛选条件的仓位。' : '先保存 Bitget 只读密钥，再点同步。'}
          </div>
        )}
      </section>
      )}
    </div>
  );
}

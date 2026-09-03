import { memo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  KeyRound,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { PositionTag } from '@/api/position-review-api';
import type { ReviewVenue } from './position-review-types';
import { formatShanghaiTime } from '@/domain/formatters';

export type DateRangeFilter = '1d' | '3d' | '7d' | '30d' | '90d' | 'all';
export type SideFilter = 'all' | 'long' | 'short';
export type StatusFilter = 'all' | 'open' | 'closed';
export type ResultFilter = 'all' | 'profit' | 'loss';
export type SortField = 'entryTimeMs' | 'netPnl';

interface PositionReviewToolbarProps {
  syncing: boolean;
  configured: boolean;
  syncedAt: string | null;
  isSyncStale: boolean;
  error: string | null;
  onSync: () => void;
  onToggleCredentials: () => void;

  // Filter states & setters
  search: string;
  onSearchChange: (value: string) => void;
  side: SideFilter;
  onSideChange: (side: SideFilter) => void;
  result: ResultFilter;
  onResultChange: (result: ResultFilter) => void;
  status: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
  noNote: boolean;
  onNoNoteChange: (val: boolean) => void;
  noTag: boolean;
  onNoTagChange: (val: boolean) => void;
  venueFilter: 'all' | ReviewVenue;
  onVenueFilterChange: (venue: 'all' | ReviewVenue) => void;

  dateRange: DateRangeFilter;
  onDateRangeChange: (range: DateRangeFilter) => void;
  symbolFilter: string;
  onSymbolFilterChange: (symbol: string) => void;
  symbols: string[];

  sortField: SortField;
  onSortFieldChange: (field: SortField) => void;
  descending: boolean;
  onDescendingChange: (desc: boolean) => void;

  showMoreFilters: boolean;
  onToggleMoreFilters: () => void;

  tagFilter: string;
  onTagFilterChange: (tagId: string) => void;
  tags: PositionTag[];

  showUsSessionBands: boolean;
  onToggleUsSessionBands: () => void;
  showWeekendBands: boolean;
  onToggleWeekendBands: () => void;
}

export const PositionReviewToolbar = memo(function PositionReviewToolbar(
  props: PositionReviewToolbarProps
) {
  const {
    syncing,
    configured,
    syncedAt,
    isSyncStale,
    error,
    onSync,
    onToggleCredentials,
    search,
    onSearchChange,
    side,
    onSideChange,
    result,
    onResultChange,
    status,
    onStatusChange,
    noNote,
    onNoNoteChange,
    noTag,
    onNoTagChange,
    venueFilter,
    onVenueFilterChange,
    dateRange,
    onDateRangeChange,
    symbolFilter,
    onSymbolFilterChange,
    symbols,
    sortField,
    onSortFieldChange,
    descending,
    onDescendingChange,
    showMoreFilters,
    onToggleMoreFilters,
    tagFilter,
    onTagFilterChange,
    tags,
    showUsSessionBands,
    onToggleUsSessionBands,
    showWeekendBands,
    onToggleWeekendBands,
  } = props;

  return (
    <div className="bitlang-sidebar-filters posrev-toolbar">
      <div className="bitlang-filter-row">
        <button
          type="button"
          onClick={onSync}
          disabled={syncing || !configured}
        >
          <RefreshCw size={14} className={syncing ? 'spin' : ''} />
          {syncing ? '同步中' : '同步'}
        </button>
        <button type="button" onClick={onToggleCredentials}>
          <KeyRound size={14} />
          密钥
        </button>
      </div>

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
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索交易对、备注或标签"
        />
      </label>

      <div className="review-filter-chips">
        <button
          type="button"
          className={side === 'long' ? 'active' : ''}
          onClick={() => onSideChange(side === 'long' ? 'all' : 'long')}
        >
          多
        </button>
        <button
          type="button"
          className={side === 'short' ? 'active' : ''}
          onClick={() => onSideChange(side === 'short' ? 'all' : 'short')}
        >
          空
        </button>
        <button
          type="button"
          className={result === 'profit' ? 'active' : ''}
          onClick={() => onResultChange(result === 'profit' ? 'all' : 'profit')}
        >
          盈
        </button>
        <button
          type="button"
          className={result === 'loss' ? 'active' : ''}
          onClick={() => onResultChange(result === 'loss' ? 'all' : 'loss')}
        >
          亏
        </button>
        <button
          type="button"
          className={status === 'open' ? 'active' : ''}
          onClick={() => onStatusChange(status === 'open' ? 'all' : 'open')}
        >
          持仓中
        </button>
        <button
          type="button"
          className={noNote ? 'active' : ''}
          onClick={() => onNoNoteChange(!noNote)}
        >
          未备注
        </button>
        <button
          type="button"
          className={noTag ? 'active' : ''}
          onClick={() => onNoTagChange(!noTag)}
        >
          未打标
        </button>
        <button
          type="button"
          className={venueFilter === 'bitget' ? 'active' : ''}
          onClick={() =>
            onVenueFilterChange(venueFilter === 'bitget' ? 'all' : 'bitget')
          }
        >
          Bitget
        </button>
        <button
          type="button"
          className={venueFilter === 'gate' ? 'active' : ''}
          onClick={() =>
            onVenueFilterChange(venueFilter === 'gate' ? 'all' : 'gate')
          }
        >
          Gate
        </button>
      </div>

      <div className="bitlang-filter-row">
        <select
          value={dateRange}
          onChange={(e) => onDateRangeChange(e.target.value as DateRangeFilter)}
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
          onChange={(e) => onSymbolFilterChange(e.target.value)}
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
          onChange={(e) => onSortFieldChange(e.target.value as SortField)}
        >
          <option value="entryTimeMs">开仓时间</option>
          <option value="netPnl">净盈亏</option>
        </select>
        <button
          type="button"
          onClick={() => onDescendingChange(!descending)}
        >
          {descending ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          {descending ? '降序' : '升序'}
        </button>
      </div>

      <button
        type="button"
        className="review-more-filters"
        onClick={onToggleMoreFilters}
      >
        {showMoreFilters ? '收起筛选' : '更多筛选'}
      </button>

      {showMoreFilters && (
        <div className="bitlang-filter-row">
          <select
            value={tagFilter}
            onChange={(e) => onTagFilterChange(e.target.value)}
          >
            <option value="all">全部标签</option>
            {tags.map((tag) => (
              <option key={tag.id} value={String(tag.id)}>
                {tag.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={showUsSessionBands ? 'active' : ''}
            onClick={onToggleUsSessionBands}
            title="在图表上显示美股常规交易时段垂直条带"
          >
            美股时段
          </button>
          <button
            type="button"
            className={showWeekendBands ? 'active' : ''}
            onClick={onToggleWeekendBands}
            title="在图表上显示周末非交易时段垂直条带"
          >
            周末时段
          </button>
        </div>
      )}
    </div>
  );
});

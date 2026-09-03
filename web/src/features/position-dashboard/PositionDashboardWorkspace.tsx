import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  syncBitgetPositions,
  type PositionTag,
  type ReviewPosition,
} from '@/api/position-review-api';
import { CommonDashboardLayout } from './CommonDashboardLayout';
import { TradeJournalStream } from './TradeJournalStream';
import { toast } from '@/ui/feedback/toast';
import {
  readLocalUiState,
  storedString,
  writeLocalUiState,
} from '@/ui/persistence/local-ui-state';
import { summarizePositions, formatDurationMinutes } from '@/features/position-review/position-stats';
import { RefreshCw, Wallet } from 'lucide-react';
import '@/styles/position-dashboard.css';

type DateRangeFilter = '7d' | '30d' | '90d' | 'all';
const POSITION_DASHBOARD_UI_STORAGE_KEY = 'tiabtc-position-dashboard-ui-v1';

const DATE_RANGE_MS_MAP: Record<Exclude<DateRangeFilter, 'all'>, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

function loadDashboardUiState() {
  const stored = readLocalUiState(POSITION_DASHBOARD_UI_STORAGE_KEY);
  const tagFilter = storedString(stored.tagFilter, 'all', undefined, 32);
  return {
    dateRange: storedString(stored.dateRange, '90d', [
      '7d',
      '30d',
      '90d',
      'all',
    ]) as DateRangeFilter,
    symbolFilter: storedString(stored.symbolFilter, 'all', undefined, 40),
    sideFilter: storedString(stored.sideFilter, 'all', [
      'all',
      'long',
      'short',
    ]) as 'all' | 'long' | 'short',
    tagFilter:
      tagFilter === 'all' || /^\d+$/.test(tagFilter) ? tagFilter : 'all',
  };
}

interface Props {
  themeMode?: 'dark' | 'light';
  positions: ReviewPosition[];
  tags: PositionTag[];
  configured: boolean;
  balanceTotal: number | null;
  syncing?: boolean;
  onSync?: () => void | Promise<void>;
  onNoteUpdated?: (positionId: string, note: string) => void;
  onNavigateToPosition?: (positionId: string) => void;
}

export function PositionDashboardWorkspace({
  positions,
  tags,
  configured,
  balanceTotal,
  syncing = false,
  onSync,
  onNoteUpdated,
  onNavigateToPosition,
}: Props) {
  const [initialUiState] = useState(loadDashboardUiState);
  const [dateRange, setDateRange] = useState<DateRangeFilter>(
    initialUiState.dateRange
  );
  const [symbolFilter, setSymbolFilter] = useState(initialUiState.symbolFilter);
  const [sideFilter, setSideFilter] = useState<'all' | 'long' | 'short'>(
    initialUiState.sideFilter
  );
  const [tagFilter, setTagFilter] = useState(initialUiState.tagFilter);

  const handleSync = async () => {
    if (onSync) {
      await onSync();
      return;
    }
    try {
      await syncBitgetPositions();
      toast.success('同步完成');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '同步仓位失败');
    }
  };

  const handleNoteUpdated = useCallback(
    (positionId: string, note: string) => {
      onNoteUpdated?.(positionId, note);
    },
    [onNoteUpdated]
  );

  const symbols = useMemo(() => {
    return [...new Set(positions.map((p) => p.chartSymbol))].sort();
  }, [positions]);

  useEffect(() => {
    if (positions.length === 0) return;
    if (symbolFilter !== 'all' && !symbols.includes(symbolFilter)) {
      setSymbolFilter('all');
    }
    if (
      tagFilter !== 'all' &&
      !tags.some((tag) => String(tag.id) === tagFilter)
    ) {
      setTagFilter('all');
    }
  }, [positions.length, symbolFilter, symbols, tagFilter, tags]);

  useEffect(() => {
    writeLocalUiState(POSITION_DASHBOARD_UI_STORAGE_KEY, {
      dateRange,
      symbolFilter,
      sideFilter,
      tagFilter,
    });
  }, [dateRange, sideFilter, symbolFilter, tagFilter]);

  // Filtered positions based on active filters
  const filteredPositions = useMemo(() => {
    const cutoffMs =
      dateRange === 'all' ? 0 : Date.now() - DATE_RANGE_MS_MAP[dateRange];
    const targetTagId = tagFilter === 'all' ? null : Number(tagFilter);

    return positions.filter((p) => {
      if (cutoffMs > 0) {
        const time = p.exitTimeMs || p.entryTimeMs;
        if (time < cutoffMs) return false;
      }
      if (symbolFilter !== 'all' && p.chartSymbol !== symbolFilter) return false;
      if (sideFilter !== 'all' && p.side !== sideFilter) return false;
      if (targetTagId != null && !p.tagIds.includes(targetTagId)) return false;
      return true;
    });
  }, [dateRange, positions, sideFilter, symbolFilter, tagFilter]);

  const performancePositions = useMemo(
    () => filteredPositions.filter((position) => position.status === 'closed'),
    [filteredPositions]
  );

  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);

  const journalPositions = useMemo(() => {
    if (!selectedCalendarDate) return filteredPositions;
    return filteredPositions.filter((p) => {
      const timeMs = p.exitTimeMs ?? p.entryTimeMs;
      const parts = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(timeMs));
      const y = parts.find((part) => part.type === 'year')?.value || '1970';
      const m = parts.find((part) => part.type === 'month')?.value || '01';
      const d = parts.find((part) => part.type === 'day')?.value || '01';
      return `${y}-${m}-${d}` === selectedCalendarDate;
    });
  }, [filteredPositions, selectedCalendarDate]);

  const kpi = useMemo(() => {
    const summary = summarizePositions(performancePositions);
    return {
      ...summary,
      durationText: formatDurationMinutes(summary.avgDurationMin),
    };
  }, [performancePositions]);

  return (
    <CommonDashboardLayout
      title="仓位看盘 · 账户数据大屏"
      subtitle={
        <>
          已归集 <strong>{positions.length}</strong> 笔仓位 ·{' '}
          <strong>{tags.length}</strong> 个策略标签
        </>
      }
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      dateRangeOptions={['7d', '30d', '90d', 'all']}
      symbolFilter={symbolFilter}
      onSymbolFilterChange={setSymbolFilter}
      symbols={symbols}
      sideFilter={sideFilter}
      onSideFilterChange={setSideFilter}
      tagFilter={tagFilter}
      onTagFilterChange={setTagFilter}
      tags={tags}
      kpi={kpi}
      performancePositions={performancePositions}
      calendarPositions={filteredPositions}
      selectedCalendarDate={selectedCalendarDate}
      onSelectCalendarDate={setSelectedCalendarDate}
      extraHeader={
        <>
          {balanceTotal != null && (
            <div className="posdash-balance-chip" title="已配置交易所账户权益合计">
              <span className="posdash-live-dot" />
              <Wallet size={13} />
              <span>{balanceTotal.toFixed(2)} USDT</span>
            </div>
          )}

          <button
            type="button"
            className="posdash-btn"
            onClick={handleSync}
            disabled={syncing || !configured}
            title={configured ? '同步最新仓位' : '需在仓位复盘中配置 Bitget 或 Gate 密钥'}
          >
            <RefreshCw size={13} className={syncing ? 'spin' : ''} />
            {syncing ? '同步中' : '同步'}
          </button>
        </>
      }
      journalSlot={
        <TradeJournalStream
          positions={journalPositions}
          tags={tags}
          onNavigateToPosition={onNavigateToPosition}
          onNoteUpdated={handleNoteUpdated}
        />
      }
    />
  );
}

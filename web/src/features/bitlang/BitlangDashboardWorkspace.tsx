import { useEffect, useMemo, useState } from 'react';
import type { BitlangTag } from '@/api/bitlang-review-api';
import type { ReviewPosition } from '@/features/position-review/position-review-types';
import {
  formatDurationMinutes,
  summarizePositions,
} from '@/features/position-review/position-stats';
import { CommonDashboardLayout } from '@/features/position-dashboard/CommonDashboardLayout';
import {
  readLocalUiState,
  storedString,
  writeLocalUiState,
} from '@/ui/persistence/local-ui-state';
import { BitlangJournalStream } from './BitlangJournalStream';
import { bybitSymbol } from './bitlang-format';
import type { AnnotatedBitlangTrade } from './bitlang-types';
import '@/styles/position-dashboard.css';

type DateRangeFilter = '7d' | '30d' | '90d' | 'all';
const BITLANG_DASHBOARD_UI_STORAGE_KEY = 'tiabtc-bitlang-dashboard-ui-v1';

const DATE_RANGE_MS_MAP: Record<Exclude<DateRangeFilter, 'all'>, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

function loadDashboardUiState() {
  const stored = readLocalUiState(BITLANG_DASHBOARD_UI_STORAGE_KEY);
  const tagFilter = storedString(stored.tagFilter, 'all', undefined, 32);
  return {
    dateRange: storedString(stored.dateRange, 'all', [
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
  trades: AnnotatedBitlangTrade[];
  tags: BitlangTag[];
  snapshotEndMs: number;
  onNoteUpdated?: (tradeId: string, note: string) => void;
  onNavigateToTrade?: (tradeId: string) => void;
}

function toDashboardPosition(trade: AnnotatedBitlangTrade): ReviewPosition {
  return {
    venue: 'bitlang',
    positionId: trade.id,
    unifiedSymbol: trade.instrument,
    chartSymbol: bybitSymbol(trade.instrument),
    side: trade.direction === '多' ? 'long' : 'short',
    status: 'closed',
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    contracts: trade.size,
    leverage: trade.leverage,
    marginMode: null,
    hedged: false,
    realizedPnl: trade.profit,
    netPnl: trade.profit,
    funding: 0,
    openFee: Math.abs(trade.fee || 0),
    closeFee: 0,
    entryTimeMs: Date.parse(trade.entryTime),
    exitTimeMs: Date.parse(trade.exitTime),
    note: trade.note,
    tagIds: trade.tagIds,
  };
}

export function BitlangDashboardWorkspace({
  trades,
  tags,
  snapshotEndMs,
  onNoteUpdated,
  onNavigateToTrade,
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

  const symbols = useMemo(
    () => [...new Set(trades.map((trade) => bybitSymbol(trade.instrument)))].sort(),
    [trades]
  );

  useEffect(() => {
    if (trades.length === 0) return;
    if (symbolFilter !== 'all' && !symbols.includes(symbolFilter)) {
      setSymbolFilter('all');
    }
    if (
      tagFilter !== 'all' &&
      !tags.some((tag) => String(tag.id) === tagFilter)
    ) {
      setTagFilter('all');
    }
  }, [symbolFilter, symbols, tagFilter, tags, trades.length]);

  useEffect(() => {
    writeLocalUiState(BITLANG_DASHBOARD_UI_STORAGE_KEY, {
      dateRange,
      symbolFilter,
      sideFilter,
      tagFilter,
    });
  }, [dateRange, sideFilter, symbolFilter, tagFilter]);

  const filteredTrades = useMemo(() => {
    const cutoffMs =
      dateRange === 'all' ? 0 : snapshotEndMs - DATE_RANGE_MS_MAP[dateRange];
    const targetTagId = tagFilter === 'all' ? null : Number(tagFilter);
    return trades.filter((trade) => {
      if (cutoffMs > 0 && Date.parse(trade.entryTime) < cutoffMs) return false;
      if (
        symbolFilter !== 'all' &&
        bybitSymbol(trade.instrument) !== symbolFilter
      ) {
        return false;
      }
      if (sideFilter === 'long' && trade.direction !== '多') return false;
      if (sideFilter === 'short' && trade.direction !== '空') return false;
      if (targetTagId != null && !trade.tagIds.includes(targetTagId)) return false;
      return true;
    });
  }, [dateRange, sideFilter, snapshotEndMs, symbolFilter, tagFilter, trades]);

  const journalTrades = useMemo(
    () =>
      [...filteredTrades].sort(
        (left, right) => Date.parse(right.entryTime) - Date.parse(left.entryTime)
      ),
    [filteredTrades]
  );

  const dashboardPositions = useMemo(
    () => filteredTrades.map(toDashboardPosition),
    [filteredTrades]
  );

  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);

  const displayedJournalTrades = useMemo(() => {
    if (!selectedCalendarDate) return journalTrades;
    return journalTrades.filter((trade) => {
      const parts = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(trade.exitTime || trade.entryTime));
      const y = parts.find((part) => part.type === 'year')?.value || '1970';
      const m = parts.find((part) => part.type === 'month')?.value || '01';
      const d = parts.find((part) => part.type === 'day')?.value || '01';
      return `${y}-${m}-${d}` === selectedCalendarDate;
    });
  }, [journalTrades, selectedCalendarDate]);

  const kpi = useMemo(() => {
    const summary = summarizePositions(dashboardPositions);
    return {
      ...summary,
      durationText: formatDurationMinutes(summary.avgDurationMin),
    };
  }, [dashboardPositions]);

  return (
    <CommonDashboardLayout
      title="bit浪浪 · 交割单看板"
      subtitle={
        <>
          已归集 <strong>{trades.length}</strong> 笔交易 ·{' '}
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
      performancePositions={dashboardPositions}
      calendarPositions={dashboardPositions}
      selectedCalendarDate={selectedCalendarDate}
      onSelectCalendarDate={setSelectedCalendarDate}
      journalTitle="交割单反思日记流 (Trading Journal Stream)"
      journalSubtitle="入场依据与心得沉淀"
      journalSlot={
        <BitlangJournalStream
          trades={displayedJournalTrades}
          tags={tags}
          onNavigateToTrade={onNavigateToTrade}
          onNoteUpdated={onNoteUpdated}
        />
      }
    />
  );
}

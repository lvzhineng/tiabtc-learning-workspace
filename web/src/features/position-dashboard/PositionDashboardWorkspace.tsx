import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  syncBitgetPositions,
  type PositionTag,
  type ReviewPosition,
} from '@/api/position-review-api';
import { CommonDashboardLayout } from './CommonDashboardLayout';
import { PeriodComparison } from './PeriodComparison';
import { TradeJournalStream } from './TradeJournalStream';
import { toast } from '@/ui/feedback/toast';
import { buildSymbolCountOptions } from '@/ui/symbol-count-options';
import {
  readLocalUiState,
  storedString,
  writeLocalUiState,
} from '@/ui/persistence/local-ui-state';
import { summarizePositions, formatDurationMinutes } from '@/features/position-review/position-stats';
import { isCfdPosition, positionStatisticsCurrency, isExnessUsdPosition, EXNESS_USD_STATISTICS_HINT, type ReviewCurrency } from '@/features/position-review/position-review-types';
import { RefreshCw, Wallet } from 'lucide-react';
import '@/styles/position-dashboard.css';

type DateRangeFilter = '7d' | '30d' | '90d' | 'all';
type DashboardMarket = 'all' | 'crypto' | 'cfd' | 'exness';
const POSITION_DASHBOARD_UI_STORAGE_KEY = 'tiabtc-position-dashboard-ui-v1';

const DATE_RANGE_MS_MAP: Record<Exclude<DateRangeFilter, 'all'>, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

function loadDashboardUiState() {
  const stored = readLocalUiState(POSITION_DASHBOARD_UI_STORAGE_KEY);
  const tagFilter = storedString(stored.tagFilter, 'all', undefined, 32);
  const storedMarket = storedString(stored.market, 'all', ['all', 'crypto', 'cfd', 'exness']);
  const isOverviewV2 = stored.overviewVersion === 2;
  return {
    dateRange: (isOverviewV2 ? storedString(stored.dateRange, 'all', [
      '7d',
      '30d',
      '90d',
      'all',
    ]) : 'all') as DateRangeFilter,
    symbolFilter: storedString(stored.symbolFilter, 'all', undefined, 40),
    market: (isOverviewV2 ? storedMarket : 'all') as DashboardMarket,
    moneyCurrency: storedString(stored.moneyCurrency, '', undefined, 24),
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
  cfdBalanceTotal?: number | null;
  exnessBalanceTotal?: number | null;
  exnessBalanceCurrency?: string | null;
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
  cfdBalanceTotal,
  exnessBalanceTotal,
  exnessBalanceCurrency,
  syncing = false,
  onSync,
  onNoteUpdated,
  onNavigateToPosition,
}: Props) {
  const [initialUiState] = useState(loadDashboardUiState);
  const [market, setMarket] = useState(initialUiState.market);
  const currency: ReviewCurrency = market === 'cfd' ? 'USD' : market === 'exness'
    ? positionStatisticsCurrency({ venue: 'exness', currency: exnessBalanceCurrency }) : 'USDT';
  const marketPositions = useMemo(() => positions.filter((position) => {
    if (market === 'all') return true;
    if (market === 'cfd') return position.venue === 'gate-cfd';
    if (market === 'exness') return position.venue === 'exness';
    return !isCfdPosition(position);
  }), [positions, market]);
  const [dateRange, setDateRange] = useState<DateRangeFilter>(
    initialUiState.dateRange
  );
  const [symbolFilter, setSymbolFilter] = useState(initialUiState.symbolFilter);
  const [sideFilter, setSideFilter] = useState<'all' | 'long' | 'short'>(
    initialUiState.sideFilter
  );
  const [tagFilter, setTagFilter] = useState(initialUiState.tagFilter);
  const [moneyCurrency, setMoneyCurrency] = useState(initialUiState.moneyCurrency);

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
    return [...new Set(marketPositions.map((p) => p.chartSymbol))].sort();
  }, [marketPositions]);

  const comparisonPositions = useMemo(() => marketPositions.filter((position) =>
    (symbolFilter === 'all' || position.chartSymbol === symbolFilter)
    && (sideFilter === 'all' || position.side === sideFilter)
    && (tagFilter === 'all' || position.tagIds.includes(Number(tagFilter)))
  ), [marketPositions, symbolFilter, sideFilter, tagFilter]);

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
      market,
      dateRange,
      overviewVersion: 2,
      symbolFilter,
      sideFilter,
      tagFilter,
      moneyCurrency,
    });
  }, [dateRange, sideFilter, symbolFilter, tagFilter, market, moneyCurrency]);

  // Apply every active filter except the symbol filter to the option counts.
  const baseFilteredPositions = useMemo(() => {
    const cutoffMs =
      dateRange === 'all' ? 0 : Date.now() - DATE_RANGE_MS_MAP[dateRange];
    const targetTagId = tagFilter === 'all' ? null : Number(tagFilter);

    return marketPositions.filter((p) => {
      if (cutoffMs > 0) {
        const time = p.exitTimeMs || p.entryTimeMs;
        if (time < cutoffMs) return false;
      }
      if (sideFilter !== 'all' && p.side !== sideFilter) return false;
      if (targetTagId != null && !p.tagIds.includes(targetTagId)) return false;
      return true;
    });
  }, [dateRange, marketPositions, sideFilter, tagFilter]);

  const symbolOptions = useMemo(
    () => buildSymbolCountOptions(
      baseFilteredPositions,
      (position) => position.chartSymbol,
      symbols
    ),
    [baseFilteredPositions, symbols]
  );

  const filteredPositions = useMemo(
    () => baseFilteredPositions.filter((position) =>
      symbolFilter === 'all' || position.chartSymbol === symbolFilter
    ),
    [baseFilteredPositions, symbolFilter]
  );

  const performancePositions = useMemo(
    () => filteredPositions.filter((position) => position.status === 'closed'),
    [filteredPositions]
  );
  const currencies = useMemo(() => [...new Set(performancePositions.map(positionStatisticsCurrency))].sort(), [performancePositions]);
  const preferredMoneyCurrency = currencies.includes('USDT') ? 'USDT' : currencies[0] || currency;
  const effectiveMoneyCurrency = currencies.includes(moneyCurrency) ? moneyCurrency : preferredMoneyCurrency;
  useEffect(() => {
    if (currencies.length === 0) setMoneyCurrency('');
    else if (!currencies.includes(moneyCurrency)) setMoneyCurrency(preferredMoneyCurrency);
  }, [currencies, moneyCurrency, preferredMoneyCurrency]);
  const moneyPositions = useMemo(
    () => performancePositions.filter((position) => positionStatisticsCurrency(position) === effectiveMoneyCurrency),
    [performancePositions, effectiveMoneyCurrency]
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

  const rawBalanceItems = market === 'all'
    ? [
      ...(balanceTotal == null ? [] : [{ venue: 'bitget', source: '永续', currency: 'USDT', total: balanceTotal }]),
      ...(cfdBalanceTotal == null ? [] : [{ venue: 'gate-cfd', source: 'Gate CFD', currency: 'USD', total: cfdBalanceTotal }]),
      ...(exnessBalanceTotal == null ? [] : [{ venue: 'exness', source: 'Exness', currency: exnessBalanceCurrency || '未标注币种', total: exnessBalanceTotal }]),
    ]
    : market === 'cfd'
      ? (cfdBalanceTotal == null ? [] : [{ venue: 'gate-cfd', source: 'Gate CFD', currency: 'USD', total: cfdBalanceTotal }])
      : market === 'exness'
        ? (exnessBalanceTotal == null ? [] : [{ venue: 'exness', source: 'Exness', currency: exnessBalanceCurrency || '未标注币种', total: exnessBalanceTotal }])
        : (balanceTotal == null ? [] : [{ venue: 'bitget', source: '永续', currency: 'USDT', total: balanceTotal }]);
  const balanceGroups = new Map<string, { currency: string; total: number; sources: string[]; includesExnessUsd: boolean }>();
  for (const item of rawBalanceItems) {
    const unit = positionStatisticsCurrency(item);
    const group = balanceGroups.get(unit) ?? { currency: unit, total: 0, sources: [], includesExnessUsd: false };
    group.total += item.total;
    group.sources.push(`${item.source} ${item.total.toFixed(2)} ${item.currency}`);
    group.includesExnessUsd ||= isExnessUsdPosition(item);
    balanceGroups.set(unit, group);
  }
  const balanceItems = [...balanceGroups.values()];
  const includesExnessUsd = marketPositions.some(isExnessUsdPosition) || balanceItems.some((item) => item.includesExnessUsd);

  return (
    <CommonDashboardLayout
      currency={currency}
      comparisonSlot={<PeriodComparison currency={effectiveMoneyCurrency} positions={comparisonPositions} amountPositions={comparisonPositions.filter((position) => positionStatisticsCurrency(position) === effectiveMoneyCurrency)} dateRange={dateRange} endMs={Date.now()} />}
      moneyCurrency={effectiveMoneyCurrency}
      moneyCurrencies={currencies}
      onMoneyCurrencyChange={setMoneyCurrency}
      moneyPositions={moneyPositions}
      title="账户看板"
      subtitle={
        <>
          {market === 'all' ? '全部平台' : market === 'cfd' ? 'Gate CFD' : market === 'exness' ? 'Exness' : '加密永续'} · 共 <strong>{marketPositions.length}</strong> 笔交易 ·{' '}
          <strong>{tags.length}</strong> 个策略标签
          {includesExnessUsd && <span className="posdash-statistics-note" title={EXNESS_USD_STATISTICS_HINT}> · 含 Exness USD ⓘ</span>}
        </>
      }
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      dateRangeOptions={['7d', '30d', '90d', 'all']}
      symbolFilter={symbolFilter}
      onSymbolFilterChange={setSymbolFilter}
      symbolOptions={symbolOptions}
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
          <select className="posdash-select" aria-label="账户市场" value={market} onChange={(event) => {
            setMarket(event.target.value as DashboardMarket);
            setSymbolFilter('all');
            setSelectedCalendarDate(null);
          }}>
            <option value="all">全部平台</option>
            <option value="crypto">加密永续 · USDT</option>
            <option value="cfd">Gate CFD · USD</option>
            <option value="exness">Exness</option>
          </select>
          {balanceItems.map((item) => (
            <div key={item.currency} className="posdash-balance-chip" title={`${item.sources.join(' + ')}${item.includesExnessUsd ? `；${EXNESS_USD_STATISTICS_HINT}` : ''}`}>
              <span className="posdash-live-dot" />
              <Wallet size={13} />
              <span>权益 · {item.total.toFixed(2)} {item.currency}</span>
            </div>
          ))}

          <button
            type="button"
            className="posdash-btn primary"
            onClick={handleSync}
            disabled={syncing || !configured}
            title={configured ? '同步最新交易记录' : '需在仓位复盘中配置账户密钥'}
          >
            <RefreshCw size={13} className={syncing ? 'spin' : ''} />
            {syncing ? '同步中' : '同步'}
          </button>
        </>
      }
      journalSlot={
        <TradeJournalStream
          currency={effectiveMoneyCurrency}
          positions={journalPositions}
          tags={tags}
          onNavigateToPosition={onNavigateToPosition}
          onNoteUpdated={handleNoteUpdated}
        />
      }
    />
  );
}

import { useMemo, useState } from 'react';
import type { BitlangTag } from '@/api/bitlang-review-api';
import { EquityCurveChart } from '@/features/position-dashboard/EquityCurveChart';
import { SymbolLeaderboardCard } from '@/features/position-dashboard/SymbolLeaderboardCard';
import { TagAnalyticsCard } from '@/features/position-dashboard/TagAnalyticsCard';
import {
  formatDurationMinutes,
  summarizePositions,
} from '@/features/position-review/position-stats';
import type { ReviewPosition } from '@/features/position-review/position-review-types';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  Coins,
  Layers,
  MessageSquare,
  Percent,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { BitlangJournalStream } from './BitlangJournalStream';
import { bybitSymbol } from './bitlang-format';
import type { AnnotatedBitlangTrade } from './bitlang-types';
import '@/styles/position-dashboard.css';

type DateRangeFilter = '7d' | '30d' | '90d' | 'all';

const DATE_RANGE_MS_MAP: Record<Exclude<DateRangeFilter, 'all'>, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

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
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all');
  const [symbolFilter, setSymbolFilter] = useState('all');
  const [sideFilter, setSideFilter] = useState<'all' | 'long' | 'short'>('all');
  const [tagFilter, setTagFilter] = useState('all');

  const symbols = useMemo(
    () => [...new Set(trades.map((trade) => bybitSymbol(trade.instrument)))].sort(),
    [trades]
  );

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

  const kpi = useMemo(() => {
    const summary = summarizePositions(dashboardPositions);
    return {
      ...summary,
      durationText: formatDurationMinutes(summary.avgDurationMin),
    };
  }, [dashboardPositions]);

  return (
    <div className="posdash-container">
      <header className="posdash-header">
        <div className="posdash-title-group">
          <div className="posdash-title-icon">
            <Activity size={18} />
          </div>
          <div className="posdash-title-text">
            <h2>bit浪浪 · 交割单看板</h2>
            <span>
              已归集 <strong>{trades.length}</strong> 笔交易 · <strong>{tags.length}</strong> 个策略标签
            </span>
          </div>
        </div>

        <div className="posdash-filters">
          <div className="posdash-segmented-group">
            {(['7d', '30d', '90d', 'all'] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`posdash-segmented-btn ${dateRange === item ? 'active' : ''}`}
                onClick={() => setDateRange(item)}
              >
                {item === 'all' ? '全部' : `近 ${item.replace('d', '')} 天`}
              </button>
            ))}
          </div>

          <select
            value={symbolFilter}
            onChange={(event) => setSymbolFilter(event.target.value)}
            className="posdash-select"
          >
            <option value="all">全部交易对</option>
            {symbols.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>

          <select
            value={sideFilter}
            onChange={(event) =>
              setSideFilter(event.target.value as 'all' | 'long' | 'short')
            }
            className="posdash-select"
          >
            <option value="all">多/空方向</option>
            <option value="long">仅多头</option>
            <option value="short">仅空头</option>
          </select>

          <select
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            className="posdash-select"
          >
            <option value="all">全部策略标签</option>
            {tags.map((tag) => (
              <option key={tag.id} value={String(tag.id)}>
                {tag.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <section className="posdash-kpi-grid">
        <div className={`posdash-kpi-card hero ${kpi.totalPnl >= 0 ? 'profit-glow' : 'loss-glow'}`}>
          <div className="posdash-kpi-header">
            <span className="posdash-kpi-title">累计净盈亏 (Net PnL)</span>
            <span className={`posdash-kpi-icon-wrap ${kpi.totalPnl >= 0 ? 'profit' : 'loss'}`}>
              {kpi.totalPnl >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
            </span>
          </div>
          <div
            className={`posdash-kpi-value ${
              kpi.totalPnl >= 0 ? 'posrev-profit' : 'posrev-loss'
            }`}
          >
            {kpi.totalPnl >= 0 ? '+' : ''}
            {kpi.totalPnl.toFixed(2)} <span className="posdash-currency-unit">USDT</span>
          </div>
          <div className="posdash-kpi-sub">
            <span className="posdash-sub-chip profit">
              <ArrowUpRight size={11} /> 峰值: +{kpi.maxWin.toFixed(1)}
            </span>
            <span className="posdash-sub-chip loss">
              <ArrowDownRight size={11} /> 谷值: -{kpi.maxLoss.toFixed(1)}
            </span>
          </div>
        </div>

        <div className="posdash-kpi-card">
          <div className="posdash-kpi-header">
            <span className="posdash-kpi-title">综合胜率 (Win Rate)</span>
            <span className="posdash-kpi-icon-wrap neutral">
              <Percent size={15} />
            </span>
          </div>
          <div
            className={`posdash-kpi-value ${
              kpi.winRate >= 50 ? 'posrev-profit' : 'posrev-loss'
            }`}
          >
            {kpi.winRate.toFixed(1)}%
          </div>
          <div className="posdash-kpi-sub">
            <span>
              <strong>{kpi.winCount}</strong> 胜 / <strong>{kpi.lossCount}</strong> 负
              （共 {kpi.count} 笔）
            </span>
          </div>
        </div>

        <div className="posdash-kpi-card">
          <div className="posdash-kpi-header">
            <span className="posdash-kpi-title">盈亏比 / 单笔期望</span>
            <span className="posdash-kpi-icon-wrap amber">
              <Zap size={15} />
            </span>
          </div>
          <div className="posdash-kpi-value">
            {kpi.profitFactor != null ? kpi.profitFactor.toFixed(2) : '--'}
            <span className="posdash-unit-badge">PF</span>
          </div>
          <div className="posdash-kpi-sub">
            <span>
              单笔期望:{' '}
              <strong className={kpi.expectancy >= 0 ? 'posrev-profit' : 'posrev-loss'}>
                {kpi.expectancy >= 0 ? '+' : ''}
                {kpi.expectancy.toFixed(2)} U
              </strong>
            </span>
          </div>
        </div>

        <div className="posdash-kpi-card">
          <div className="posdash-kpi-header">
            <span className="posdash-kpi-title">均持仓时长 / 多空比</span>
            <span className="posdash-kpi-icon-wrap blue">
              <Clock size={15} />
            </span>
          </div>
          <div className="posdash-kpi-value" style={{ fontSize: 18 }}>
            ⏱ {kpi.durationText}
          </div>
          <div className="posdash-side-ratio-track">
            <div
              className="posdash-side-bar long"
              style={{ width: `${kpi.longRatio}%` }}
              title={`多单 ${kpi.longCount} 笔 (${kpi.longRatio}%)`}
            />
            <div
              className="posdash-side-bar short"
              style={{ width: `${kpi.shortRatio}%` }}
              title={`空单 ${kpi.shortCount} 笔 (${kpi.shortRatio}%)`}
            />
          </div>
          <div className="posdash-kpi-sub" style={{ justifyContent: 'space-between' }}>
            <span className="posdash-side-subtext long">
              多 {kpi.longCount} ({kpi.longRatio}%)
            </span>
            <span className="posdash-side-subtext short">
              空 {kpi.shortCount} ({kpi.shortRatio}%)
            </span>
          </div>
        </div>

        <div className="posdash-kpi-card">
          <div className="posdash-kpi-header">
            <span className="posdash-kpi-title">摩擦磨损 (手续费)</span>
            <span className="posdash-kpi-icon-wrap neutral">
              <Coins size={15} />
            </span>
          </div>
          <div className="posdash-kpi-value" style={{ color: 'var(--text-secondary)' }}>
            -{kpi.totalFee.toFixed(2)}
            <span className="posdash-currency-unit"> USDT</span>
          </div>
          <div className="posdash-kpi-sub">
            <span>来自交割单手续费合计</span>
          </div>
        </div>
      </section>

      <section className="posdash-section-grid">
        <div className="posdash-card">
          <div className="posdash-card-header">
            <h3 className="posdash-card-title">
              <TrendingUp size={16} color="#3b82f6" />
              累计净盈亏收益走势 (Equity Curve)
            </h3>
            <span className="posdash-card-extra">按平仓时间顺序累加各笔净值</span>
          </div>
          <EquityCurveChart positions={dashboardPositions} />
        </div>

        <div className="posdash-card">
          <div className="posdash-card-header">
            <h3 className="posdash-card-title">
              <Zap size={16} color="#f59e0b" />
              策略标签胜率与收益画像 (Tag Performance)
            </h3>
            <span className="posdash-card-extra">打标策略盈利能力诊断</span>
          </div>
          <TagAnalyticsCard positions={dashboardPositions} tags={tags} />
        </div>
      </section>

      <section className="posdash-section-grid">
        <div className="posdash-card">
          <div className="posdash-card-header">
            <h3 className="posdash-card-title">
              <Layers size={16} color="#10b981" />
              交易对净盈亏贡献榜 (Symbol Leaderboard)
            </h3>
            <span className="posdash-card-extra">提款机 vs 绞肉机</span>
          </div>
          <SymbolLeaderboardCard positions={dashboardPositions} />
        </div>

        <div className="posdash-card">
          <div className="posdash-card-header">
            <h3 className="posdash-card-title">
              <MessageSquare size={16} color="#8b5cf6" />
              交易反思日记流 (Trading Journal Stream)
            </h3>
            <span className="posdash-card-extra">入场依据与心得沉淀</span>
          </div>
          <BitlangJournalStream
            trades={journalTrades}
            tags={tags}
            onNavigateToTrade={onNavigateToTrade}
            onNoteUpdated={onNoteUpdated}
          />
        </div>
      </section>
    </div>
  );
}

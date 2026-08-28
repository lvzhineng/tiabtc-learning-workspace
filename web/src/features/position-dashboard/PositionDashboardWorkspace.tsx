import { useCallback, useMemo, useState } from 'react';
import {
  syncBitgetPositions,
  type PositionTag,
  type ReviewPosition,
} from '@/api/position-review-api';
import { EquityCurveChart } from './EquityCurveChart';
import { TagAnalyticsCard } from './TagAnalyticsCard';
import { SymbolLeaderboardCard } from './SymbolLeaderboardCard';
import { TradeJournalStream } from './TradeJournalStream';
import { toast } from '@/ui/feedback/toast';
import { summarizePositions, formatDurationMinutes } from '@/features/position-review/position-stats';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  Coins,
  Layers,
  MessageSquare,
  Percent,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';
import '@/styles/position-dashboard.css';

type DateRangeFilter = '7d' | '30d' | '90d' | 'all';

const DATE_RANGE_MS_MAP: Record<Exclude<DateRangeFilter, 'all'>, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

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
  const [dateRange, setDateRange] = useState<DateRangeFilter>('90d');
  const [symbolFilter, setSymbolFilter] = useState('all');
  const [sideFilter, setSideFilter] = useState<'all' | 'long' | 'short'>('all');
  const [tagFilter, setTagFilter] = useState('all');

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

  const kpi = useMemo(() => {
    const summary = summarizePositions(performancePositions);
    return {
      ...summary,
      durationText: formatDurationMinutes(summary.avgDurationMin),
    };
  }, [performancePositions]);

  return (
    <div className="posdash-container">
      {/* 顶部工具栏 */}
      <header className="posdash-header">
        <div className="posdash-title-group">
          <div className="posdash-title-icon">
            <Activity size={18} />
          </div>
          <div className="posdash-title-text">
            <h2>仓位看盘 · 账户数据大屏</h2>
            <span>
              已归集 <strong>{positions.length}</strong> 笔仓位 · <strong>{tags.length}</strong> 个策略标签
            </span>
          </div>
        </div>

        <div className="posdash-filters">
          {/* 一键分段切换时间胶囊 */}
          <div className="posdash-segmented-group">
            <button
              type="button"
              className={`posdash-segmented-btn ${dateRange === '7d' ? 'active' : ''}`}
              onClick={() => setDateRange('7d')}
            >
              近 7 天
            </button>
            <button
              type="button"
              className={`posdash-segmented-btn ${dateRange === '30d' ? 'active' : ''}`}
              onClick={() => setDateRange('30d')}
            >
              近 30 天
            </button>
            <button
              type="button"
              className={`posdash-segmented-btn ${dateRange === '90d' ? 'active' : ''}`}
              onClick={() => setDateRange('90d')}
            >
              近 90 天
            </button>
            <button
              type="button"
              className={`posdash-segmented-btn ${dateRange === 'all' ? 'active' : ''}`}
              onClick={() => setDateRange('all')}
            >
              全部
            </button>
          </div>

          <select
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            className="posdash-select"
          >
            <option value="all">全部交易对</option>
            {symbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>

          <select
            value={sideFilter}
            onChange={(e) =>
              setSideFilter(e.target.value as 'all' | 'long' | 'short')
            }
            className="posdash-select"
          >
            <option value="all">多/空方向</option>
            <option value="long">仅多头 (Long)</option>
            <option value="short">仅空头 (Short)</option>
          </select>

          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="posdash-select"
          >
            <option value="all">全部策略标签</option>
            {tags.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.name}
              </option>
            ))}
          </select>

          {balanceTotal != null && (
            <div className="posdash-balance-chip" title="Bitget UTA 账户总权益">
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
            title={configured ? '同步最新仓位' : '需在仓位复盘中配置密钥'}
          >
            <RefreshCw size={13} className={syncing ? 'spin' : ''} />
            {syncing ? '同步中' : '同步'}
          </button>
        </div>
      </header>

      {/* 1. 核心 KPI 诊断矩阵 */}
      <section className="posdash-kpi-grid">
        {/* 卡片 1: 累计净盈亏 (Hero 焦点卡片) */}
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

        {/* 卡片 2: 综合胜率 */}
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
              （已平仓 {kpi.closedCount} 笔 / 共 {kpi.count} 笔）
            </span>
          </div>
        </div>

        {/* 卡片 3: 盈亏比与期望值 */}
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

        {/* 卡片 4: 平均持仓与多空分布 */}
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
          {/* 多空比例条 */}
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
            <span className="posdash-side-subtext long">多 {kpi.longCount} ({kpi.longRatio}%)</span>
            <span className="posdash-side-subtext short">空 {kpi.shortCount} ({kpi.shortRatio}%)</span>
          </div>
        </div>

        {/* 卡片 5: 交易摩擦磨损 */}
        <div className="posdash-kpi-card">
          <div className="posdash-kpi-header">
            <span className="posdash-kpi-title">摩擦磨损 (手续费/资金费)</span>
            <span className="posdash-kpi-icon-wrap neutral">
              <Coins size={15} />
            </span>
          </div>
          <div className="posdash-kpi-value" style={{ color: 'var(--text-secondary)' }}>
            -{kpi.totalFee.toFixed(2)}
            <span className="posdash-currency-unit"> USDT</span>
          </div>
          <div className="posdash-kpi-sub">
            <span>资金费: {kpi.totalFunding >= 0 ? '+' : ''}{kpi.totalFunding.toFixed(2)} USDT</span>
          </div>
        </div>
      </section>

      {/* 2. 中部核心图表: 累计收益曲线 + 策略标签效能 */}
      <section className="posdash-section-grid">
        <div className="posdash-card">
          <div className="posdash-card-header">
            <h3 className="posdash-card-title">
              <TrendingUp size={16} color="#3b82f6" />
              累计净盈亏收益走势 (Equity Curve)
            </h3>
            <span className="posdash-card-extra">按时间顺序累加各笔净值</span>
          </div>
          <EquityCurveChart positions={performancePositions} />
        </div>

        <div className="posdash-card">
          <div className="posdash-card-header">
            <h3 className="posdash-card-title">
              <Zap size={16} color="#f59e0b" />
              策略标签胜率与收益画像 (Tag Performance)
            </h3>
            <span className="posdash-card-extra">打标策略盈利能力诊断</span>
          </div>
          <TagAnalyticsCard positions={performancePositions} tags={tags} />
        </div>
      </section>

      {/* 3. 底部图表: 币种排行榜 + 交易反思日记流 */}
      <section className="posdash-section-grid">
        <div className="posdash-card">
          <div className="posdash-card-header">
            <h3 className="posdash-card-title">
              <Layers size={16} color="#10b981" />
              交易对净盈亏贡献榜 (Symbol Leaderboard)
            </h3>
            <span className="posdash-card-extra">提款机 vs 绞肉机</span>
          </div>
          <SymbolLeaderboardCard positions={performancePositions} />
        </div>

        <div className="posdash-card">
          <div className="posdash-card-header">
            <h3 className="posdash-card-title">
              <MessageSquare size={16} color="#8b5cf6" />
              交易反思日记流 (Trading Journal Stream)
            </h3>
            <span className="posdash-card-extra">入场依据与心得沉淀</span>
          </div>
          <TradeJournalStream
            positions={filteredPositions}
            tags={tags}
            onNavigateToPosition={onNavigateToPosition}
            onNoteUpdated={handleNoteUpdated}
          />
        </div>
      </section>
    </div>
  );
}

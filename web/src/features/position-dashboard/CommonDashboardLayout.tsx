import type { ReactNode } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  Clock,
  Coins,
  Layers,
  MessageSquare,
  Percent,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { EquityCurveChart } from './EquityCurveChart';
import { TagAnalyticsCard } from './TagAnalyticsCard';
import { SymbolLeaderboardCard } from './SymbolLeaderboardCard';
import { TradingCalendarHeatmap } from './TradingCalendarHeatmap';
import type { ReviewPosition } from '@/api/position-review-api';
import type { summarizePositions } from '@/features/position-review/position-stats';
import '@/styles/position-dashboard.css';

export type DashboardKpi = ReturnType<typeof summarizePositions> & {
  durationText: string;
};

export interface CommonDashboardLayoutProps {
  title: string;
  subtitle: ReactNode;

  dateRange: string;
  onDateRangeChange: (range: any) => void;
  dateRangeOptions: readonly string[];
  dateRangeLabels?: Record<string, string>;

  symbolFilter: string;
  onSymbolFilterChange: (sym: string) => void;
  symbols: string[];

  sideFilter: string;
  onSideFilterChange: (side: any) => void;

  tagFilter: string;
  onTagFilterChange: (tag: string) => void;
  tags: { id: number | string; name: string }[];

  kpi: DashboardKpi;
  performancePositions: ReviewPosition[];
  calendarPositions: ReviewPosition[];
  selectedCalendarDate: string | null;
  onSelectCalendarDate: (date: string | null) => void;
  anchorEndMs?: number;

  extraHeader?: ReactNode;

  journalSlot: ReactNode;
  journalTitle?: string;
  journalSubtitle?: string;
}

export function CommonDashboardLayout(props: CommonDashboardLayoutProps) {
  const {
    title,
    subtitle,
    dateRange,
    onDateRangeChange,
    dateRangeOptions,
    dateRangeLabels = { '7d': '近 7 天', '30d': '近 30 天', '90d': '近 90 天', all: '全部' },
    symbolFilter,
    onSymbolFilterChange,
    symbols,
    sideFilter,
    onSideFilterChange,
    tagFilter,
    onTagFilterChange,
    tags,
    kpi,
    performancePositions,
    calendarPositions,
    selectedCalendarDate,
    onSelectCalendarDate,
    anchorEndMs,
    extraHeader,
    journalSlot,
    journalTitle = '交易反思日记流 (Trading Journal Stream)',
    journalSubtitle = '入场依据与心得沉淀',
  } = props;

  return (
    <div className="posdash-container">
      {/* 顶部工具栏 */}
      <header className="posdash-header">
        <div className="posdash-title-group">
          <div className="posdash-title-icon">
            <Activity size={18} />
          </div>
          <div className="posdash-title-text">
            <h2>{title}</h2>
            <span>{subtitle}</span>
          </div>
        </div>

        <div className="posdash-filters">
          <div className="posdash-segmented-group">
            {dateRangeOptions.map((item) => (
              <button
                key={item}
                type="button"
                className={`posdash-segmented-btn ${dateRange === item ? 'active' : ''}`}
                onClick={() => onDateRangeChange(item)}
              >
                {dateRangeLabels[item] || item}
              </button>
            ))}
          </div>

          <select
            value={symbolFilter}
            onChange={(e) => onSymbolFilterChange(e.target.value)}
            className="posdash-select"
          >
            <option value="all">全部交易对</option>
            {symbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>

          <div className="posdash-segmented-group">
            <button
              type="button"
              className={`posdash-segmented-btn ${sideFilter === 'all' ? 'active' : ''}`}
              onClick={() => onSideFilterChange('all')}
            >
              全部方向
            </button>
            <button
              type="button"
              className={`posdash-segmented-btn ${sideFilter === 'long' ? 'active' : ''}`}
              onClick={() => onSideFilterChange('long')}
            >
              仅做多
            </button>
            <button
              type="button"
              className={`posdash-segmented-btn ${sideFilter === 'short' ? 'active' : ''}`}
              onClick={() => onSideFilterChange('short')}
            >
              仅做空
            </button>
          </div>

          <select
            value={tagFilter}
            onChange={(e) => onTagFilterChange(e.target.value)}
            className="posdash-select"
          >
            <option value="all">全部策略标签</option>
            {tags.map((tag) => (
              <option key={tag.id} value={String(tag.id)}>
                {tag.name}
              </option>
            ))}
          </select>

          {extraHeader}
        </div>
      </header>

      {/* 1. 顶部 KPI 卡片指标网格 */}
      <section className="posdash-kpi-grid">
        <div className="posdash-kpi-card">
          <div className="posdash-kpi-header">
            <span className="posdash-kpi-title">累计净盈亏 (Net PnL)</span>
            <span className={`posdash-kpi-icon-wrap ${kpi.totalPnl >= 0 ? 'profit' : 'loss'}`}>
              {kpi.totalPnl >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
            </span>
          </div>
          <div className={`posdash-kpi-value ${kpi.totalPnl >= 0 ? 'posrev-profit' : 'posrev-loss'}`}>
            {kpi.totalPnl >= 0 ? '+' : ''}
            {kpi.totalPnl.toFixed(2)}
            <span className="posdash-currency-unit"> USDT</span>
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
              （已平仓 {kpi.closedCount} 笔 / 共 {kpi.count} 笔）
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
          <div className="posdash-kpi-value">{kpi.durationText}</div>
          <div className="posdash-kpi-sub" style={{ justifyContent: 'space-between' }}>
            <span className="posdash-side-subtext long">多 {kpi.longCount} ({kpi.longRatio}%)</span>
            <span className="posdash-side-subtext short">空 {kpi.shortCount} ({kpi.shortRatio}%)</span>
          </div>
        </div>

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
          <TagAnalyticsCard positions={performancePositions} tags={tags as any} />
        </div>
      </section>

      {/* 2.5 交易节奏与盈亏日历热力图 */}
      <section className="posdash-card" style={{ marginBottom: '20px' }}>
        <div className="posdash-card-header">
          <h3 className="posdash-card-title">
            <Calendar size={16} color="#06b6d4" />
            交易节奏与盈亏日历 (Trading Calendar Heatmap)
          </h3>
          <span className="posdash-card-extra">
            近 12 周盈亏全景 · 点击单元格快速过滤当日交易日记
          </span>
        </div>
        <TradingCalendarHeatmap
          positions={calendarPositions}
          selectedDate={selectedCalendarDate}
          onSelectDate={onSelectCalendarDate}
          anchorEndMs={anchorEndMs}
        />
      </section>

      {/* 3. 底部图表: 币种排行榜 + 日记流插槽 */}
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
              {journalTitle}
            </h3>
            <span className="posdash-card-extra">{journalSubtitle}</span>
          </div>
          {journalSlot}
        </div>
      </section>
    </div>
  );
}

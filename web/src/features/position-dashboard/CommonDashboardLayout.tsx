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
  Tags,
  TrendingDown,
  TrendingUp,
  X,
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
  comparisonSlot?: ReactNode;

  journalSlot: ReactNode;
  journalTitle?: string;
  journalSubtitle?: string;
}

function signed(value: number, digits = 2): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function DashboardCardHeader({
  icon,
  tone,
  title,
  extra,
}: {
  icon: ReactNode;
  tone: 'blue' | 'amber' | 'cyan' | 'green' | 'violet';
  title: string;
  extra?: ReactNode;
}) {
  return (
    <div className="posdash-card-header">
      <h3 className="posdash-card-title">
        <span className={`posdash-card-icon ${tone}`}>{icon}</span>
        {title}
      </h3>
      {extra != null && <span className="posdash-card-extra">{extra}</span>}
    </div>
  );
}

export function CommonDashboardLayout(props: CommonDashboardLayoutProps) {
  const {
    title,
    subtitle,
    dateRange,
    onDateRangeChange,
    dateRangeOptions,
    dateRangeLabels = { '7d': '7 天', '30d': '30 天', '90d': '90 天', all: '全部' },
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
    comparisonSlot,
    journalSlot,
    journalTitle = '交易反思日记',
    journalSubtitle = '入场依据与心得沉淀',
  } = props;

  const isProfit = kpi.totalPnl >= 0;
  const decided = kpi.winCount + kpi.lossCount;
  const lossRate = decided > 0 ? 100 - kpi.winRate : 0;

  return (
    <div className="posdash-container">
      <header className="posdash-header">
        <div className="posdash-header-top">
          <div className="posdash-title-group">
            <div className="posdash-title-icon">
              <Activity size={18} />
            </div>
            <div className="posdash-title-text">
              <h2>{title}</h2>
              <span>{subtitle}</span>
            </div>
          </div>
          {extraHeader && <div className="posdash-header-actions">{extraHeader}</div>}
        </div>

        <div className="posdash-filters">
          <div className="posdash-filter-field">
            <span className="posdash-filter-label">时间</span>
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
          </div>

          <div className="posdash-filter-field">
            <span className="posdash-filter-label">方向</span>
            <div className="posdash-segmented-group">
              <button
                type="button"
                className={`posdash-segmented-btn ${sideFilter === 'all' ? 'active' : ''}`}
                onClick={() => onSideFilterChange('all')}
              >
                全部
              </button>
              <button
                type="button"
                className={`posdash-segmented-btn ${sideFilter === 'long' ? 'active' : ''}`}
                onClick={() => onSideFilterChange('long')}
              >
                做多
              </button>
              <button
                type="button"
                className={`posdash-segmented-btn ${sideFilter === 'short' ? 'active' : ''}`}
                onClick={() => onSideFilterChange('short')}
              >
                做空
              </button>
            </div>
          </div>

          <div className="posdash-filter-field">
            <span className="posdash-filter-label">交易对</span>
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
          </div>

          <div className="posdash-filter-field">
            <span className="posdash-filter-label">标签</span>
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
          </div>
        </div>
      </header>

      <section className="posdash-kpi-grid">
        <div className={`posdash-kpi-card hero ${isProfit ? 'profit-glow' : 'loss-glow'}`}>
          <div className="posdash-kpi-header">
            <span className="posdash-kpi-title" title="已平仓净盈亏累计，与收益曲线终点相同">
              累计净盈亏
            </span>
            <span className={`posdash-kpi-icon-wrap ${isProfit ? 'profit' : 'loss'}`}>
              {isProfit ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
            </span>
          </div>
          <div className={`posdash-kpi-value ${isProfit ? 'posrev-profit' : 'posrev-loss'}`}>
            {signed(kpi.totalPnl)}
            <span className="posdash-currency-unit">USDT</span>
          </div>
          <div className="posdash-kpi-sub">
            <span
              className={`posdash-sub-chip ${kpi.peakEquity >= 0 ? 'profit' : 'loss'}`}
              title="累计净值最高点 (ATH)，与收益曲线同一序列"
            >
              <ArrowUpRight size={11} /> 峰值 {signed(kpi.peakEquity, 1)}
            </span>
            <span
              className={`posdash-sub-chip ${kpi.valleyEquity > 0 ? 'profit' : 'loss'}`}
              title="累计净值最低点，与收益曲线同一序列"
            >
              <ArrowDownRight size={11} /> 谷值 {signed(kpi.valleyEquity, 1)}
            </span>
            <span className="posdash-sub-chip neutral" title="峰值到其后低点的最大回落">
              最大回撤 -{kpi.maxDrawdown.toFixed(1)}
            </span>
          </div>
        </div>

        <div className="posdash-kpi-card">
          <div className="posdash-kpi-header">
            <span className="posdash-kpi-title">胜率</span>
            <span className="posdash-kpi-icon-wrap neutral">
              <Percent size={15} />
            </span>
          </div>
          <div className={`posdash-kpi-value ${kpi.winRate >= 50 ? 'posrev-profit' : 'posrev-loss'}`}>
            {kpi.winRate.toFixed(1)}
            <span className="posdash-currency-unit">%</span>
          </div>
          <div className="posdash-side-ratio-track" aria-hidden="true">
            <div className="posdash-side-bar win" style={{ width: `${kpi.winRate}%` }} />
            <div className="posdash-side-bar loss" style={{ width: `${lossRate}%` }} />
          </div>
          <div className="posdash-kpi-sub">
            <span>
              <strong className="posrev-profit">{kpi.winCount}</strong> 胜 ·{' '}
              <strong className="posrev-loss">{kpi.lossCount}</strong> 负 · 已平 {kpi.closedCount}/{kpi.count}
            </span>
          </div>
        </div>

        <div className="posdash-kpi-card">
          <div className="posdash-kpi-header">
            <span className="posdash-kpi-title">盈亏比 (PF)</span>
            <span className="posdash-kpi-icon-wrap amber">
              <Zap size={15} />
            </span>
          </div>
          <div className="posdash-kpi-value">
            {kpi.profitFactor != null ? kpi.profitFactor.toFixed(2) : '--'}
          </div>
          <div className="posdash-kpi-sub">
            <span>
              单笔期望{' '}
              <strong className={kpi.expectancy >= 0 ? 'posrev-profit' : 'posrev-loss'}>
                {signed(kpi.expectancy)} U
              </strong>
            </span>
          </div>
        </div>

        <div className="posdash-kpi-card">
          <div className="posdash-kpi-header">
            <span className="posdash-kpi-title">平均持仓</span>
            <span className="posdash-kpi-icon-wrap blue">
              <Clock size={15} />
            </span>
          </div>
          <div className="posdash-kpi-value">{kpi.durationText}</div>
          <div className="posdash-side-ratio-track" aria-hidden="true">
            <div className="posdash-side-bar long" style={{ width: `${kpi.longRatio}%` }} />
            <div className="posdash-side-bar short" style={{ width: `${kpi.shortRatio}%` }} />
          </div>
          <div className="posdash-kpi-sub posdash-kpi-sub-split">
            <span className="posdash-side-subtext long">多 {kpi.longCount} · {kpi.longRatio}%</span>
            <span className="posdash-side-subtext short">空 {kpi.shortCount} · {kpi.shortRatio}%</span>
          </div>
        </div>

        <div className="posdash-kpi-card">
          <div className="posdash-kpi-header">
            <span className="posdash-kpi-title">手续费 / 资金费</span>
            <span className="posdash-kpi-icon-wrap neutral">
              <Coins size={15} />
            </span>
          </div>
          <div className="posdash-kpi-value posdash-kpi-value-muted">
            -{kpi.totalFee.toFixed(2)}
            <span className="posdash-currency-unit">USDT</span>
          </div>
          <div className="posdash-kpi-sub">
            <span>
              资金费{' '}
              <strong className={kpi.totalFunding >= 0 ? 'posrev-profit' : 'posrev-loss'}>
                {signed(kpi.totalFunding)} USDT
              </strong>
            </span>
          </div>
        </div>
      </section>

      {comparisonSlot}

      <section className="posdash-section-grid posdash-grid-main">
        <div className="posdash-card">
          <DashboardCardHeader
            icon={<TrendingUp size={14} />}
            tone="blue"
            title="累计收益曲线"
            extra="按平仓顺序累加每笔净盈亏"
          />
          <EquityCurveChart positions={performancePositions} />
        </div>

        <div className="posdash-card">
          <DashboardCardHeader
            icon={<Calendar size={14} />}
            tone="cyan"
            title="盈亏日历"
            extra="近 12 周 · 点击格子筛选日记"
          />
          <TradingCalendarHeatmap
            positions={calendarPositions}
            selectedDate={selectedCalendarDate}
            onSelectDate={onSelectCalendarDate}
            anchorEndMs={anchorEndMs}
          />
        </div>
      </section>

      <section className="posdash-section-grid posdash-grid-even">
        <div className="posdash-card">
          <DashboardCardHeader
            icon={<Tags size={14} />}
            tone="amber"
            title="策略标签表现"
            extra="按净盈亏排序"
          />
          <TagAnalyticsCard positions={performancePositions} tags={tags as any} />
        </div>

        <div className="posdash-card">
          <DashboardCardHeader
            icon={<Layers size={14} />}
            tone="green"
            title="交易对贡献榜"
            extra="谁在赚钱，谁在亏钱"
          />
          <SymbolLeaderboardCard positions={performancePositions} />
        </div>
      </section>

      <section className="posdash-card posdash-journal-section">
        <DashboardCardHeader
          icon={<MessageSquare size={14} />}
          tone="violet"
          title={journalTitle}
          extra={
            selectedCalendarDate ? (
              <button
                type="button"
                className="posdash-date-filter-chip"
                onClick={() => onSelectCalendarDate(null)}
                title="清除日期筛选"
              >
                <Calendar size={11} />
                {selectedCalendarDate}
                <X size={11} />
              </button>
            ) : (
              journalSubtitle
            )
          }
        />
        {journalSlot}
      </section>
    </div>
  );
}

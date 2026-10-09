import { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, GitCompare, Minus } from 'lucide-react';
import type { ReviewPosition } from '@/features/position-review/position-review-types';
import { formatNumber } from '@/domain/formatters';
import { compareReviewPeriods } from './period-comparison';

interface MetricProps {
  label: string;
  current: string;
  previous: string;
  delta: number | null;
  deltaText: string;
  neutral?: boolean;
}

function ComparisonMetric({ label, current, previous, delta, deltaText, neutral }: MetricProps) {
  const trend = delta == null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';
  const tone = neutral || trend === 'flat' ? 'neutral' : trend === 'up' ? 'profit' : 'loss';
  return (
    <div className="posdash-compare-metric">
      <span className="posdash-compare-label">{label}</span>
      <strong className="posdash-compare-value">{current}</strong>
      <div className="posdash-compare-foot">
        <span className={`posdash-compare-delta ${tone}`}>
          {trend === 'up' ? <ArrowUpRight size={11} /> : trend === 'down' ? <ArrowDownRight size={11} /> : <Minus size={11} />}
          {deltaText}
        </span>
        <span className="posdash-compare-prev">上期 {previous}</span>
      </div>
    </div>
  );
}

export function PeriodComparison({ positions, dateRange, endMs, useEntryTime, currency = 'USDT' }: {
  currency?: 'USDT' | 'USD';
  positions: ReviewPosition[]; dateRange: string; endMs: number; useEntryTime?: boolean;
}) {
  const days = Number(dateRange.replace('d', ''));
  const comparison = useMemo(() => compareReviewPeriods(positions, endMs, days, useEntryTime), [positions, endMs, days, useEntryTime]);
  if (![7, 30, 90].includes(days)) return null;
  const { current, previous } = comparison;
  const bothSampled = current.closedCount > 0 && previous.closedCount > 0;
  const pnlDelta = current.totalPnl - previous.totalPnl;
  const winRateDelta = bothSampled ? current.winRate - previous.winRate : null;
  const expectancyDelta = bothSampled ? current.expectancy - previous.expectancy : null;
  const countDelta = current.closedCount - previous.closedCount;
  const signedNumber = (value: number) => `${value > 0 ? '+' : ''}${formatNumber(value)}`;

  return (
    <section className="posdash-compare" aria-label="相邻时段对比">
      <div className="posdash-compare-head">
        <span className="posdash-card-icon blue"><GitCompare size={14} /></span>
        <div>
          <strong>近 {days} 天 vs 前 {days} 天</strong>
          <span>沿用当前交易对、方向和标签筛选，仅统计已平仓样本</span>
        </div>
      </div>
      <div className="posdash-compare-grid">
        <ComparisonMetric
          label={`已实现盈亏 (${currency})`}
          current={signedNumber(current.totalPnl)}
          previous={signedNumber(previous.totalPnl)}
          delta={pnlDelta}
          deltaText={signedNumber(pnlDelta)}
        />
        <ComparisonMetric
          label="胜率"
          current={current.closedCount ? `${current.winRate.toFixed(1)}%` : '—'}
          previous={previous.closedCount ? `${previous.winRate.toFixed(1)}%` : '—'}
          delta={winRateDelta}
          deltaText={winRateDelta == null ? '样本不足' : `${winRateDelta > 0 ? '+' : ''}${winRateDelta.toFixed(1)} pp`}
        />
        <ComparisonMetric
          label={`单笔期望 (${currency})`}
          current={current.closedCount ? signedNumber(current.expectancy) : '—'}
          previous={previous.closedCount ? signedNumber(previous.expectancy) : '—'}
          delta={expectancyDelta}
          deltaText={expectancyDelta == null ? '样本不足' : signedNumber(expectancyDelta)}
        />
        <ComparisonMetric
          label="平仓笔数"
          current={String(current.closedCount)}
          previous={String(previous.closedCount)}
          delta={countDelta}
          deltaText={`${countDelta > 0 ? '+' : ''}${countDelta} 笔`}
          neutral
        />
      </div>
    </section>
  );
}

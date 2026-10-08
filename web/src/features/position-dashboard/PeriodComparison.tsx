import { useMemo } from 'react';
import type { ReviewPosition } from '@/features/position-review/position-review-types';
import { formatNumber } from '@/domain/formatters';
import { compareReviewPeriods } from './period-comparison';

export function PeriodComparison({ positions, dateRange, endMs, useEntryTime, currency = 'USDT' }: {
  currency?: 'USDT' | 'USD';
  positions: ReviewPosition[]; dateRange: string; endMs: number; useEntryTime?: boolean;
}) {
  const days = Number(dateRange.replace('d', ''));
  const comparison = useMemo(() => compareReviewPeriods(positions, endMs, days, useEntryTime), [positions, endMs, days, useEntryTime]);
  if (![7, 30, 90].includes(days)) return null;
  const { current, previous } = comparison;
  return <section className="posdash-card period-comparison" aria-label="相邻时段对比">
    <h3 className="posdash-card-title">相邻时段对比 · {days} 天</h3>
    <p>沿用当前交易对、方向和标签筛选，仅统计已平仓样本。</p>
    <div className="period-comparison-table-wrap" tabIndex={0} aria-label="时段对比表，可横向滚动">
    <table><thead><tr><th scope="col">指标</th><th scope="col">当前时段</th><th scope="col">前一时段</th><th scope="col">变化</th></tr></thead><tbody>
      <tr><td>样本数</td><td>{current.closedCount}</td><td>{previous.closedCount}</td><td>{current.closedCount - previous.closedCount}</td></tr>
      <tr><td>已实现盈亏 ({currency})</td><td>{formatNumber(current.totalPnl)}</td><td>{formatNumber(previous.totalPnl)}</td><td>{formatNumber(current.totalPnl - previous.totalPnl)}</td></tr>
      <tr><td>胜率</td><td>{current.closedCount ? `${current.winRate.toFixed(1)}%` : '—'}</td><td>{previous.closedCount ? `${previous.winRate.toFixed(1)}%` : '—'}</td><td>{current.closedCount && previous.closedCount ? `${(current.winRate - previous.winRate).toFixed(1)} 个百分点` : '样本不足'}</td></tr>
    </tbody></table>
    </div>
  </section>;
}

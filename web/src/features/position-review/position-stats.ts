import { positionPnl, type ReviewPosition } from './position-review-types';

export type EquityCurvePoint = {
  timeMs: number;
  symbol: string;
  side: 'long' | 'short';
  pnl: number;
  cumulative: number;
};

export type EquityCurveStats = {
  closed: ReviewPosition[];
  points: EquityCurvePoint[];
  /** Last cumulative value = sum of closed-trade positionPnl(). */
  totalPnl: number;
  /** Max of the cumulative series, including the 0 starting equity. */
  peak: number;
  /** Min of the cumulative series, including the 0 starting equity. */
  valley: number;
  /** Max peak-to-trough drawdown on the same series (always >= 0). */
  maxDrawdown: number;
};

/**
 * Closed-trade equity series shared by dashboard KPI, equity chart, and
 * sidebar totals.
 *
 * Definition:
 * - Include only `status === 'closed'` positions.
 * - Order by exit time (fallback: entry time).
 * - Each step adds `positionPnl()` (`netPnl ?? realizedPnl ?? 0`).
 * - Starting equity is 0.
 * - ATH / 峰值 = max(cumulative), 谷值 = min(cumulative).
 * - Max DD = max(peak_so_far - cumulative) over the same series.
 * - Cumulative net PnL / 当前净值 / 总盈亏 = last cumulative.
 */
export function buildEquityCurve(positions: ReviewPosition[]): EquityCurveStats {
  const closed = [...positions]
    .filter((item) => item.status === 'closed')
    .sort(
      (left, right) =>
        (left.exitTimeMs || left.entryTimeMs) -
        (right.exitTimeMs || right.entryTimeMs)
    );

  const points: EquityCurvePoint[] = [];
  let runningPnl = 0;
  let peak = 0;
  let valley = 0;
  let maxDrawdown = 0;

  for (const position of closed) {
    const pnl = positionPnl(position);
    runningPnl += pnl;
    if (runningPnl > peak) peak = runningPnl;
    if (runningPnl < valley) valley = runningPnl;
    const drawdown = peak - runningPnl;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    points.push({
      timeMs: position.exitTimeMs || position.entryTimeMs,
      symbol: position.chartSymbol,
      side: position.side,
      pnl,
      cumulative: runningPnl,
    });
  }

  return {
    closed,
    points,
    totalPnl: runningPnl,
    peak,
    valley,
    maxDrawdown,
  };
}

export function summarizePositions(positions: ReviewPosition[]) {
  const equity = buildEquityCurve(positions);
  let winCount = 0;
  let lossCount = 0;
  let totalWin = 0;
  let totalLoss = 0;
  let maxWin = 0;
  let maxLoss = 0;
  let totalFee = 0;
  let totalFunding = 0;
  let longCount = 0;
  let shortCount = 0;
  let totalDurationMs = 0;
  let durationSamples = 0;

  for (const position of positions) {
    const pnl = positionPnl(position);
    totalFee += (position.openFee || 0) + (position.closeFee || 0);
    totalFunding += position.funding || 0;
    if (position.side === 'long') longCount += 1;
    else shortCount += 1;

    if (position.exitTimeMs && position.exitTimeMs > position.entryTimeMs) {
      totalDurationMs += position.exitTimeMs - position.entryTimeMs;
      durationSamples += 1;
    }

    if (position.status === 'open') continue;
    if (pnl > 0) {
      winCount += 1;
      totalWin += pnl;
      if (pnl > maxWin) maxWin = pnl;
    } else if (pnl < 0) {
      lossCount += 1;
      totalLoss += Math.abs(pnl);
      if (Math.abs(pnl) > maxLoss) maxLoss = Math.abs(pnl);
    }
  }

  const decided = winCount + lossCount;
  const winRate = decided > 0 ? (winCount / decided) * 100 : 0;
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : null;
  const expectancy = decided > 0 ? (totalWin - totalLoss) / decided : 0;
  const count = positions.length;
  const longRatio = count > 0 ? Math.round((longCount / count) * 100) : 0;
  const avgDurationMin =
    durationSamples > 0 ? Math.round(totalDurationMs / durationSamples / 60000) : 0;

  return {
    count,
    closedCount: equity.closed.length,
    totalPnl: equity.totalPnl,
    peakEquity: equity.peak,
    valleyEquity: equity.valley,
    maxDrawdown: equity.maxDrawdown,
    winCount,
    lossCount,
    winRate,
    profitFactor,
    expectancy,
    maxWin,
    maxLoss,
    totalFee,
    totalFunding,
    longCount,
    shortCount,
    longRatio,
    shortRatio: count > 0 ? 100 - longRatio : 0,
    avgDurationMin,
  };
}

export function formatDurationMinutes(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes >= 1440) return `${(minutes / 1440).toFixed(1)} 天`;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
  }
  return `${minutes} 分钟`;
}

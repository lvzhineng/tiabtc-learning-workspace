import { positionPnl, type ReviewPosition } from './position-review-types';

export function summarizePositions(positions: ReviewPosition[]) {
  let totalPnl = 0;
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
  let closedCount = 0;

  for (const position of positions) {
    const pnl = positionPnl(position);
    totalPnl += pnl;
    totalFee += (position.openFee || 0) + (position.closeFee || 0);
    totalFunding += position.funding || 0;
    if (position.side === 'long') longCount += 1;
    else shortCount += 1;

    if (position.exitTimeMs && position.exitTimeMs > position.entryTimeMs) {
      totalDurationMs += position.exitTimeMs - position.entryTimeMs;
      closedCount += 1;
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
    closedCount > 0 ? Math.round(totalDurationMs / closedCount / 60000) : 0;

  return {
    count,
    closedCount,
    totalPnl,
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

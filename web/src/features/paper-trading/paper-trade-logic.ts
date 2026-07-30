import type {
  PaperTradeItem,
  PaperTradeStats,
  TradeType,
} from './paper-trade-types';
import type { Candlestick } from '@/domain/candle';

export function calculateRR(type: TradeType, entry: number, tp: number, sl: number): number {
  if (type === 'LONG') {
    const risk = entry - sl;
    const reward = tp - entry;
    if (risk <= 0) return 0;
    return Number((reward / risk).toFixed(2));
  } else {
    const risk = sl - entry;
    const reward = entry - tp;
    if (risk <= 0) return 0;
    return Number((reward / risk).toFixed(2));
  }
}

export function computePaperTradeStats(trades: PaperTradeItem[]): PaperTradeStats {
  const totalTrades = trades.length;
  let openCount = 0;
  let winCount = 0;
  let lossCount = 0;
  let totalR = 0;

  for (const t of trades) {
    if (t.status === 'OPEN') {
      openCount += 1;
    } else if (t.status === 'WIN') {
      winCount += 1;
      totalR += t.pnlR || 0;
    } else if (t.status === 'LOSS') {
      lossCount += 1;
      totalR += t.pnlR || -1;
    }
  }

  const closedCount = winCount + lossCount;
  const winRatePercent = closedCount > 0 ? Math.round((winCount / closedCount) * 100) : 0;

  return {
    totalTrades,
    openCount,
    winCount,
    lossCount,
    winRatePercent,
    totalR: Number(totalR.toFixed(2)),
  };
}

export function checkTradeTrigger(
  trade: PaperTradeItem,
  candle: Candlestick
): PaperTradeItem | null {
  if (trade.status !== 'OPEN') return null;

  const rrRatio = calculateRR(trade.direction, trade.entryPrice, trade.takeProfitPrice, trade.stopLossPrice);

  if (trade.direction === 'LONG') {
    // Take Profit Trigger
    if (candle.high >= trade.takeProfitPrice) {
      return {
        ...trade,
        status: 'WIN',
        pnlR: rrRatio,
        closedAt: new Date(candle.timestampMs).toISOString(),
      };
    }
    // Stop Loss Trigger
    if (candle.low <= trade.stopLossPrice) {
      return {
        ...trade,
        status: 'LOSS',
        pnlR: -1.0,
        closedAt: new Date(candle.timestampMs).toISOString(),
      };
    }
  } else {
    // Short Take Profit Trigger
    if (candle.low <= trade.takeProfitPrice) {
      return {
        ...trade,
        status: 'WIN',
        pnlR: rrRatio,
        closedAt: new Date(candle.timestampMs).toISOString(),
      };
    }
    // Short Stop Loss Trigger
    if (candle.high >= trade.stopLossPrice) {
      return {
        ...trade,
        status: 'LOSS',
        pnlR: -1.0,
        closedAt: new Date(candle.timestampMs).toISOString(),
      };
    }
  }

  return null;
}

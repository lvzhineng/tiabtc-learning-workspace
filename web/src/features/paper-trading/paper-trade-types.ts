import type { PaperTrade } from '@/domain/paper-trade';

export type TradeType = 'LONG' | 'SHORT';

export type TradeStatus = 'OPEN' | 'CLOSED' | 'WIN' | 'LOSS';

export type PaperTradeItem = PaperTrade;

export type PositionToolParams = {
  type: TradeType;
  entryPrice: number;
  tpPrice: number;
  slPrice: number;
  rrRatio: number;
};

export type PaperTradeStats = {
  totalTrades: number;
  openCount: number;
  winCount: number;
  lossCount: number;
  winRatePercent: number;
  totalR: number;
};

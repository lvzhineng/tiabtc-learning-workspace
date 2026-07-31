import type { ReviewTimeframe } from './timeframe';

export type PaperTradeStatus = 'OPEN' | 'WIN' | 'LOSS';

export type PaperTrade = {
  id: string;
  videoId: string;
  symbol: string;
  interval: ReviewTimeframe;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  riskRewardRatio: number;
  status: PaperTradeStatus;
  pnlR: number;
  createdAt: string;
  closedAt: string | null;
};

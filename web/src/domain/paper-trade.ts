import type { ReviewTimeframe } from './timeframe';

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
  status: 'OPEN' | 'CLOSED';
  pnlR: number;
  createdAt: string;
  closedAt: string | null;
};

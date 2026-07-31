export type BitlangDirection = '多' | '空';

export interface BitlangTrade {
  id: string;
  sequence: number;
  instrument: string;
  direction: BitlangDirection;
  leverage: number;
  margin: number;
  entryPrice: number;
  exitPrice: number;
  returnRate: number;
  profit: number;
  turnover: number;
  size: number;
  maxPositionValue: number;
  fee: number;
  entryTime: string;
  exitTime: string;
  holdingMinutes: number;
  amplitude: number;
  sourceNote: string;
}

export interface BitlangTradeSnapshot {
  source: string;
  generatedAt: string;
  trades: BitlangTrade[];
}

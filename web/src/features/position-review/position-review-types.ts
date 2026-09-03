export type PositionSide = 'long' | 'short';
export type PositionStatus = 'open' | 'closed';
export type PositionFillKind = 'open' | 'scaleIn' | 'reduce' | 'close';

export interface PositionTag {
  id: number;
  name: string;
  color: string;
}

export interface PositionFill {
  execId: string;
  timeMs: number;
  side: 'buy' | 'sell';
  tradeSide: 'open' | 'close' | null;
  kind: PositionFillKind;
  price: number | null;
  quantity: number | null;
  pnl: number | null;
}

export interface ReviewPosition {
  venue: string;
  positionId: string;
  unifiedSymbol: string;
  chartSymbol: string;
  side: PositionSide;
  status: PositionStatus;
  entryPrice: number | null;
  exitPrice: number | null;
  contracts: number | null;
  leverage: number | null;
  marginMode: string | null;
  hedged: boolean;
  realizedPnl: number | null;
  netPnl: number | null;
  funding: number | null;
  openFee: number | null;
  closeFee: number | null;
  entryTimeMs: number;
  exitTimeMs: number | null;
  note: string;
  tagIds: number[];
  fills?: PositionFill[];
}

export type ReviewVenue = 'bitget' | 'gate';

export interface PositionReviewVenues {
  bitget: boolean;
  gate: boolean;
}

export interface PositionReviewState {
  configured: boolean;
  venues?: PositionReviewVenues;
  syncedAt: string | null;
  warning?: string | null;
  balance: { total: number | null } | null;
  balances?: {
    bitget: { total: number | null } | null;
    gate: { total: number | null } | null;
  };
  positions: ReviewPosition[];
  tags: PositionTag[];
}

export function positionKey(position: Pick<ReviewPosition, 'venue' | 'positionId'>): string {
  return `${position.venue}::${position.positionId}`;
}

export function venueLabel(venue: string | null | undefined): string {
  if (venue === 'gate') return 'Gate';
  if (venue === 'bitget') return 'Bitget';
  return venue || '未知交易所';
}

export interface PositionCandleBatch {
  candles: import('@/domain/candle').Candlestick[];
  warning: string | null;
  candleVenue: 'bybit' | 'bitget' | string;
  truncated?: boolean;
}

export function positionPnl(position: ReviewPosition): number {
  return position.netPnl ?? position.realizedPnl ?? 0;
}

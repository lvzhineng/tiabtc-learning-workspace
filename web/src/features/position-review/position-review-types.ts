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
  currency?: string | null;
  positionId: string;
  unifiedSymbol: string;
  chartSymbol: string;
  side: PositionSide;
  status: PositionStatus;
  entryPrice: number | null;
  exitPrice: number | null;
  contracts: number | null;
  contractSize?: number | null;
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

export type ReviewVenue = 'bitget' | 'gate' | 'gate-cfd';
/** Venues that can appear in the position list, including imported sources. */
export type PositionVenue = ReviewVenue | 'exness';
export type ReviewCurrency = string;

export type PositionReviewCredentialInput =
  | { apiKey: string; secret: string; passphrase?: string }
  | { reuseGateCredentials: true };

export interface PositionReviewVenues {
  bitget: boolean;
  gate: boolean;
  'gate-cfd'?: boolean;
  exness?: boolean;
}

export interface PositionReviewState {
  exnessMarket?: import('@/api/exness-market-api').ExnessMarketConnectionState;
  configured: boolean;
  venues?: PositionReviewVenues;
  syncedAt: string | null;
  warning?: string | null;
  exnessImport?: {
    directory: string;
    checkedAt: string | null;
    importedAt: string | null;
    fileCount: number;
    positionCount: number;
    legCount: number;
    added: number;
    updated: number;
    skipped: number;
    warning: string | null;
  };
  balance: { total: number | null } | null;
  balances?: {
    bitget: { total: number | null } | null;
    gate: { total: number | null } | null;
    'gate-cfd'?: { total: number | null; currency: 'USD' } | null;
    exness?: { total: number | null; currency: string | null } | null;
  };
  positions: ReviewPosition[];
  tags: PositionTag[];
}

export function positionKey(position: Pick<ReviewPosition, 'venue' | 'positionId'>): string {
  return `${position.venue}::${position.positionId}`;
}

export function venueLabel(venue: string | null | undefined): string {
  if (venue === 'exness') return 'Exness';
  if (venue === 'gate-cfd') return 'Gate CFD';
  if (venue === 'gate') return 'Gate';
  if (venue === 'bitget') return 'Bitget';
  return venue || '未知交易所';
}

export function isCfdPosition(positionOrVenue: Pick<ReviewPosition, 'venue'> | string): boolean {
  const venue = typeof positionOrVenue === 'string' ? positionOrVenue : positionOrVenue.venue;
  return venue === 'gate-cfd' || venue === 'exness';
}

export function positionCurrency(position: Pick<ReviewPosition, 'venue' | 'currency'>): ReviewCurrency {
  if (position.venue === 'exness') return position.currency || '未标注币种';
  return position.venue === 'gate-cfd' ? 'USD' : 'USDT';
}

export const EXNESS_USD_STATISTICS_HINT = 'Exness USD 按 1 USD = 1 USDT 并入 USDT 统计；交易明细保留原币种。';

export function isExnessUsdPosition(position: Pick<ReviewPosition, 'venue' | 'currency'>): boolean {
  return position.venue === 'exness' && position.currency?.trim().toUpperCase() === 'USD';
}

/** Reporting convention only: never rewrite source currency, PnL or fees. */
export function positionStatisticsCurrency(position: Pick<ReviewPosition, 'venue' | 'currency'>): ReviewCurrency {
  return isExnessUsdPosition(position) ? 'USDT' : positionCurrency(position);
}

/** Individual trade amounts always keep the source unit. */
export function positionCurrencyLabel(position: Pick<ReviewPosition, 'venue' | 'currency'>): string {
  const currency = positionCurrency(position);
  return currency === '未标注币种' ? '' : currency;
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

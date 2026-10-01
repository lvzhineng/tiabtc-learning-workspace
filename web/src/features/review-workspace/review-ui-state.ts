import { REVIEW_TIMEFRAMES, type ReviewTimeframe } from '@/domain/timeframe';
import { CFD_SYMBOLS } from '@/api/cfd-api';
import { storedTradingSessions, type TradingSession } from '@/chart/trading-sessions';
import { readLocalUiState, storedBoolean, storedString, writeLocalUiState } from '@/ui/persistence/local-ui-state';
export const REVIEW_LOCATION_STORAGE_KEY = 'tiabtc-review-location-v1';
export const REVIEW_UI_STORAGE_KEY = 'tiabtc-review-ui-v1';
export const MIN_REVIEW_TIMESTAMP_MS = 1_500_000_000_000;
export const DEFAULT_REVIEW_VISIBLE_SPAN = 120;
export const MIN_REVIEW_VISIBLE_SPAN = 30;
export const MAX_REVIEW_VISIBLE_SPAN = 200;

export type ReviewUiPreferences = {
  symbol: string;
  isLogScale: boolean;
  sessionBands: TradingSession[];
  showWeekendBands: boolean;
};

export function loadReviewUiPreferences(market: 'perpetual' | 'cfd'): ReviewUiPreferences {
  const stored = readLocalUiState(market === 'cfd' ? 'tiabtc-cfd-ui-v1' : REVIEW_UI_STORAGE_KEY);
  const fallback = market === 'cfd' ? 'XAUUSD' : 'BTCUSDT';
  const symbol = storedString(stored.symbol, fallback, undefined, 32).toUpperCase();
  const valid = market === 'cfd'
    ? CFD_SYMBOLS.some((item) => item.symbol === symbol)
    : /^[A-Z0-9]{1,24}USDT$/.test(symbol);
  return {
    symbol: valid ? symbol : fallback,
    isLogScale: storedBoolean(stored.isLogScale, false),
    sessionBands: storedTradingSessions(stored),
    showWeekendBands: storedBoolean(stored.showWeekendBands, false),
  };
}

export type StoredReviewLocation = {
  timeframe: ReviewTimeframe;
  timestampMs: number;
  visibleSpan: number;
  replay: StoredFreeReplay | null;
};

export type StoredFreeReplay = {
  startTimeMs: number;
  cursorTimeMs: number;
  speed: number;
};

export function normalizeReviewVisibleSpan(value: unknown): number {
  const visibleSpan = Number(value);
  if (!Number.isFinite(visibleSpan)) return DEFAULT_REVIEW_VISIBLE_SPAN;
  return Math.min(
    MAX_REVIEW_VISIBLE_SPAN,
    Math.max(MIN_REVIEW_VISIBLE_SPAN, visibleSpan)
  );
}

export function normalizeStoredFreeReplay(value: unknown): StoredFreeReplay | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<StoredFreeReplay>;
  const startTimeMs = Number(raw.startTimeMs);
  const cursorTimeMs = Number(raw.cursorTimeMs);
  const speed = Number(raw.speed);
  if (
    !Number.isFinite(startTimeMs) ||
    !Number.isFinite(cursorTimeMs) ||
    startTimeMs < MIN_REVIEW_TIMESTAMP_MS ||
    cursorTimeMs < startTimeMs ||
    cursorTimeMs > Date.now()
  ) {
    return null;
  }
  return {
    startTimeMs: Math.round(startTimeMs),
    cursorTimeMs: Math.round(cursorTimeMs),
    speed: [1, 2, 5, 10].includes(speed) ? speed : 1,
  };
}

export function loadStoredReviewLocation(market: 'perpetual' | 'cfd'): StoredReviewLocation | null {
  try {
    // Retired GC replay coordinates must not become a BTC replay context.
    if (market === 'perpetual' && readLocalUiState(REVIEW_UI_STORAGE_KEY).symbol === 'GC') return null;
    const raw = readLocalUiState(
      market === 'cfd' ? 'tiabtc-cfd-location-v1' : REVIEW_LOCATION_STORAGE_KEY
    ) as Partial<StoredReviewLocation>;
    const timeframe = raw?.timeframe;
    const timestampMs = Number(raw?.timestampMs);
    if (
      !REVIEW_TIMEFRAMES.includes(timeframe as ReviewTimeframe) ||
      !Number.isFinite(timestampMs) ||
      timestampMs < MIN_REVIEW_TIMESTAMP_MS ||
      timestampMs > Date.now()
    ) {
      return null;
    }
    return {
      timeframe: timeframe as ReviewTimeframe,
      timestampMs: Math.round(timestampMs),
      visibleSpan: normalizeReviewVisibleSpan(raw?.visibleSpan),
      replay: normalizeStoredFreeReplay(raw?.replay),
    };
  } catch {
    return null;
  }
}

export function saveStoredReviewLocation(location: StoredReviewLocation, market: 'perpetual' | 'cfd'): void {
  writeLocalUiState(market === 'cfd' ? 'tiabtc-cfd-location-v1' : REVIEW_LOCATION_STORAGE_KEY, { ...location });
}

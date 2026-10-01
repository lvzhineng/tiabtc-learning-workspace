import { requestJson } from './http';
import { parseCandleRows, type RawCandle } from './candle-parser';
import { toPersistedDrawing, type RawScopedDrawing } from './drawing-response';
import type { PersistedDrawing } from '@/domain/drawing';
import { TIMEFRAME_SECONDS_MAP, type ReviewTimeframe } from '@/domain/timeframe';
import {
  rememberCandleWindow,
  sliceCachedCandleWindow,
  boundedTradeWindowMs,
  positionCandleCacheVenue,
  TRUNCATED_WINDOW_HINT,
} from './candle-window-cache';
import {
  type PositionCandleBatch,
  type PositionReviewState,
  type PositionTag,
  type ReviewPosition,
  positionPnl,
} from '@/features/position-review/position-review-types';

export type {
  PositionCandleBatch,
  PositionReviewState,
  PositionTag,
  ReviewPosition,
};

export { positionPnl };

type RawCandleResponse = {
  candles: RawCandle[];
  source?: string;
  candleVenue?: string;
  warning?: string;
  truncated?: boolean;
};

export async function fetchPositionReviewState(): Promise<PositionReviewState> {
  return requestJson<PositionReviewState>('/api/position-review');
}

export type VenueCacheAuditIssue = {
  venue: string;
  symbol: string;
  interval: string;
  startTimestamp: number;
  endTimestamp: number;
  candleCount: number;
  issues: string[];
  fetchedAt: string;
};

export type VenueCacheAudit = {
  readOnly: boolean;
  repaired: boolean;
  rangeCount: number;
  auditedRangeCount: number;
  scanTruncated: boolean;
  consistentCount: number;
  inconsistentCount: number;
  inconsistent: VenueCacheAuditIssue[];
};

export async function fetchVenueCacheAudit(): Promise<VenueCacheAudit> {
  return requestJson<VenueCacheAudit>('/api/position-review/cache-audit');
}

export async function savePositionReviewCredentials(payload: {
  venue: 'bitget' | 'gate';
  apiKey: string;
  secret: string;
  passphrase?: string;
}): Promise<{ configured: boolean; venue: string }> {
  return requestJson('/api/position-review/credentials', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function syncPositionReview(): Promise<PositionReviewState> {
  return requestJson('/api/position-review/sync', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function syncBitgetPositions(): Promise<PositionReviewState> {
  return requestJson('/api/position-review/sync', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function savePositionNote(payload: {
  venue: string;
  positionId: string;
  note: string;
}): Promise<{ ok: boolean }> {
  return requestJson('/api/position-review/notes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createPositionTag(name: string): Promise<PositionTag> {
  return requestJson('/api/position-review/tags', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function deletePositionTag(tagId: number): Promise<{ ok: boolean }> {
  return requestJson(`/api/position-review/tags?id=${encodeURIComponent(tagId)}`, {
    method: 'DELETE',
  });
}

export async function savePositionTagMap(payload: {
  venue: string;
  positionId: string;
  tagIds: number[];
}): Promise<{ ok: boolean; tagIds: number[] }> {
  return requestJson('/api/position-review/position-tags', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export type PositionDrawingScope = {
  venue: string;
  positionId: string;
};

export async function fetchPositionDrawings(
  scope: PositionDrawingScope,
  symbol: string,
  interval: ReviewTimeframe,
  signal?: AbortSignal
): Promise<PersistedDrawing[]> {
  const params = new URLSearchParams({
    venue: scope.venue,
    positionId: scope.positionId,
    symbol,
    interval,
  });
  const data = await requestJson<{ drawings: RawScopedDrawing[] }>(
    `/api/position-review/drawings?${params}`,
    { signal }
  );
  return (data.drawings || []).map((raw) =>
    toPersistedDrawing(raw, scope.positionId, symbol, interval)
  );
}

export async function savePositionDrawing(
  scope: PositionDrawingScope,
  drawing: PersistedDrawing
): Promise<PersistedDrawing> {
  const saved = await requestJson<RawScopedDrawing>(
    '/api/position-review/drawings',
    {
      method: 'POST',
      body: JSON.stringify({
        venue: scope.venue,
        positionId: scope.positionId,
        id: drawing.id,
        symbol: drawing.symbol,
        interval: drawing.interval,
        toolType: drawing.toolType,
        points: drawing.points,
        options: drawing.options,
      }),
    }
  );
  return toPersistedDrawing(
    saved,
    scope.positionId,
    drawing.symbol,
    drawing.interval
  );
}

export async function replacePositionDrawings(
  scope: PositionDrawingScope,
  symbol: string,
  interval: ReviewTimeframe,
  drawings: PersistedDrawing[]
): Promise<PersistedDrawing[]> {
  const data = await requestJson<{ drawings: RawScopedDrawing[] }>(
    '/api/position-review/drawings',
    {
      method: 'PUT',
      body: JSON.stringify({
        venue: scope.venue,
        positionId: scope.positionId,
        symbol,
        interval,
        drawings: drawings.map((drawing) => ({
          id: drawing.id,
          interval: drawing.interval,
          toolType: drawing.toolType,
          points: drawing.points,
          options: drawing.options,
        })),
      }),
    }
  );
  return (data.drawings || []).map((raw) =>
    toPersistedDrawing(raw, scope.positionId, symbol, interval)
  );
}

export async function deletePositionDrawing(
  scope: PositionDrawingScope,
  symbol: string,
  interval: ReviewTimeframe,
  id?: string
): Promise<void> {
  const params = new URLSearchParams({
    venue: scope.venue,
    positionId: scope.positionId,
    symbol,
    interval,
  });
  if (id) params.set('id', id);
  await requestJson<{ ok: boolean }>(
    `/api/position-review/drawings?${params}`,
    { method: 'DELETE' }
  );
}

async function requestPositionCandles(
  params: URLSearchParams,
  symbol: string,
  interval: ReviewTimeframe,
  signal?: AbortSignal
): Promise<PositionCandleBatch> {
  const data = await requestJson<RawCandleResponse>(
    `/api/position-review/candles?${params}`,
    { signal }
  );
  const truncated = Boolean(data.truncated);
  const rawWarning = (data.warning || '').trim() || null;
  const candleVenue = data.candleVenue || 'bybit';
  const candles = parseCandleRows(data.candles, symbol, interval);
  if (!rawWarning) {
    rememberCandleWindow(
      'position',
      symbol,
      interval,
      candles,
      candleVenue
    );
  }
  return {
    candles,
    warning: rawWarning || (truncated ? TRUNCATED_WINDOW_HINT : null),
    candleVenue,
    truncated,
  };
}

export async function fetchPositionReviewCandles(
  symbol: string,
  interval: ReviewTimeframe,
  entryTimeMs: number,
  exitTimeMs: number,
  signal?: AbortSignal,
  venue?: string
): Promise<PositionCandleBatch> {
  const window = boundedTradeWindowMs(entryTimeMs, exitTimeMs, interval);
  const cacheVenue = positionCandleCacheVenue(symbol, venue);
  const cached = sliceCachedCandleWindow(
    'position',
    symbol,
    interval,
    window.fromMs,
    window.toMs,
    200,
    cacheVenue
  );
  if (cached) {
    return {
      candles: cached.candles,
      warning: window.truncated ? TRUNCATED_WINDOW_HINT : null,
      candleVenue: cached.venue || 'bybit',
      truncated: window.truncated,
    };
  }
  const params = new URLSearchParams({
    symbol,
    interval,
    entry: String(entryTimeMs),
    exit: String(exitTimeMs),
  });
  if (venue) params.set('venue', venue);
  return requestPositionCandles(params, symbol, interval, signal);
}

export async function fetchPositionEarlierCandles(
  symbol: string,
  interval: ReviewTimeframe,
  beforeMs: number,
  limit = 500,
  signal?: AbortSignal,
  venue?: string
): Promise<PositionCandleBatch> {
  const intervalMs = TIMEFRAME_SECONDS_MAP[interval] * 1000;
  const exitTimeMs = beforeMs - intervalMs;
  const entryTimeMs = Math.max(1_230_768_000_000, exitTimeMs - intervalMs * limit);
  if (entryTimeMs >= exitTimeMs) {
    return { candles: [], warning: null, candleVenue: 'bybit' };
  }
  const params = new URLSearchParams({
    symbol,
    interval,
    entry: String(entryTimeMs),
    exit: String(exitTimeMs),
  });
  if (venue) params.set('venue', venue);
  return requestPositionCandles(params, symbol, interval, signal);
}

export async function fetchPositionLaterCandles(
  symbol: string,
  interval: ReviewTimeframe,
  afterMs: number,
  limit = 500,
  signal?: AbortSignal,
  venue?: string
): Promise<PositionCandleBatch> {
  const intervalMs = TIMEFRAME_SECONDS_MAP[interval] * 1000;
  const entryTimeMs = afterMs + intervalMs;
  const exitTimeMs = Math.min(Date.now(), entryTimeMs + intervalMs * limit);
  if (entryTimeMs >= exitTimeMs) {
    return { candles: [], warning: null, candleVenue: 'bybit' };
  }
  const params = new URLSearchParams({
    symbol,
    interval,
    entry: String(entryTimeMs),
    exit: String(exitTimeMs),
  });
  if (venue) params.set('venue', venue);
  return requestPositionCandles(params, symbol, interval, signal);
}

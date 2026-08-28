import { ApiError, requestJson } from './http';
import type { Candlestick } from '@/domain/candle';
import type { PersistedDrawing } from '@/domain/drawing';
import { TIMEFRAME_SECONDS_MAP, type ReviewTimeframe } from '@/domain/timeframe';
import {
  rememberCandleWindow,
  sliceCachedCandleWindow,
  boundedTradeWindowMs,
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

type RawCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type RawCandleResponse = {
  candles: RawCandle[];
  source?: string;
  candleVenue?: string;
  warning?: string;
  truncated?: boolean;
};

function parseCandles(
  response: RawCandleResponse,
  symbol: string,
  interval: ReviewTimeframe
): Candlestick[] {
  const rawList = response.candles;
  if (!rawList || !Array.isArray(rawList)) return [];
  const result = new Map<number, Candlestick>();
  for (const raw of rawList) {
    if (!raw) continue;
    const timestampMs = Number(raw.timestamp);
    const open = Number(raw.open);
    const high = Number(raw.high);
    const low = Number(raw.low);
    const close = Number(raw.close);
    const volume = Number(raw.volume);
    if (
      !Number.isFinite(timestampMs) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(volume) ||
      timestampMs <= 0 ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      volume < 0
    ) {
      continue;
    }
    result.set(timestampMs, {
      symbol,
      interval,
      timestampMs,
      open,
      high,
      low,
      close,
      volume,
    });
  }
  return [...result.values()].sort(
    (left, right) => left.timestampMs - right.timestampMs
  );
}

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

export async function saveBitgetCredentials(payload: {
  apiKey: string;
  secret: string;
  passphrase: string;
}): Promise<{ configured: boolean }> {
  return requestJson('/api/position-review/credentials', {
    method: 'POST',
    body: JSON.stringify(payload),
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
  try {
    return await requestJson(`/api/position-review/tags?id=${encodeURIComponent(tagId)}`, {
      method: 'DELETE',
    });
  } catch (cause) {
    if (!(cause instanceof ApiError) || ![404, 405].includes(cause.status)) {
      throw cause;
    }
    return await requestJson('/api/position-review/tags/delete', {
      method: 'POST',
      body: JSON.stringify({ id: tagId }),
    });
  }
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

type PositionDrawingResponse = {
  id: string;
  toolType: string;
  points: Array<{ timestamp: number; price: number }>;
  options: Record<string, unknown>;
  interval?: ReviewTimeframe;
};

function toPositionDrawing(
  raw: PositionDrawingResponse,
  positionId: string,
  symbol: string,
  interval: ReviewTimeframe
): PersistedDrawing {
  return {
    id: raw.id,
    videoId: positionId,
    symbol,
    interval: raw.interval || interval,
    toolType: raw.toolType,
    points: raw.points || [],
    options: raw.options || {},
  };
}

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
  const data = await requestJson<{ drawings: PositionDrawingResponse[] }>(
    `/api/position-review/drawings?${params}`,
    { signal }
  );
  return (data.drawings || []).map((raw) =>
    toPositionDrawing(raw, scope.positionId, symbol, interval)
  );
}

export async function savePositionDrawing(
  scope: PositionDrawingScope,
  drawing: PersistedDrawing
): Promise<PersistedDrawing> {
  const saved = await requestJson<PositionDrawingResponse>(
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
  return toPositionDrawing(
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
  const data = await requestJson<{ drawings: PositionDrawingResponse[] }>(
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
    toPositionDrawing(raw, scope.positionId, symbol, interval)
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
  const warning = data.warning?.trim() || null;
  const batch = {
    candles: parseCandles(data, symbol, interval),
    warning: warning || (truncated ? TRUNCATED_WINDOW_HINT : null),
    candleVenue: data.candleVenue || 'bybit',
    truncated,
  };
  if (!warning) {
    rememberCandleWindow(
      'position',
      symbol,
      interval,
      batch.candles,
      batch.candleVenue
    );
  }
  return batch;
}

export async function fetchPositionReviewCandles(
  symbol: string,
  interval: ReviewTimeframe,
  entryTimeMs: number,
  exitTimeMs: number,
  signal?: AbortSignal
): Promise<PositionCandleBatch> {
  const window = boundedTradeWindowMs(entryTimeMs, exitTimeMs, interval);
  const cached = sliceCachedCandleWindow(
    'position',
    symbol,
    interval,
    window.fromMs,
    window.toMs
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
  return requestPositionCandles(params, symbol, interval, signal);
}

export async function fetchPositionEarlierCandles(
  symbol: string,
  interval: ReviewTimeframe,
  beforeMs: number,
  limit = 500,
  signal?: AbortSignal
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
  return requestPositionCandles(params, symbol, interval, signal);
}

export async function fetchPositionLaterCandles(
  symbol: string,
  interval: ReviewTimeframe,
  afterMs: number,
  limit = 500,
  signal?: AbortSignal
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
  return requestPositionCandles(params, symbol, interval, signal);
}

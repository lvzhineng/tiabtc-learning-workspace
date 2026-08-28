import { ApiError, requestJson } from './http';
import type { PersistedDrawing } from '@/domain/drawing';
import type { ReviewTimeframe } from '@/domain/timeframe';

export type BitlangTag = {
  id: number;
  name: string;
  color: string;
};

export type BitlangReviewState = {
  notes: Record<string, string>;
  tags: BitlangTag[];
  tagMap: Record<string, number[]>;
};

export async function fetchBitlangReviewState(): Promise<BitlangReviewState> {
  return requestJson<BitlangReviewState>('/api/bitlang-review');
}

export async function saveBitlangNote(payload: {
  tradeId: string;
  note: string;
}): Promise<{ ok: boolean }> {
  return requestJson('/api/bitlang-review/notes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createBitlangTag(name: string): Promise<BitlangTag> {
  return requestJson('/api/bitlang-review/tags', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function deleteBitlangTag(tagId: number): Promise<{ ok: boolean }> {
  try {
    return await requestJson(
      `/api/bitlang-review/tags?id=${encodeURIComponent(tagId)}`,
      { method: 'DELETE' }
    );
  } catch (cause) {
    if (!(cause instanceof ApiError) || ![404, 405].includes(cause.status)) {
      throw cause;
    }
    return await requestJson('/api/bitlang-review/tags/delete', {
      method: 'POST',
      body: JSON.stringify({ id: tagId }),
    });
  }
}

export async function saveBitlangTagMap(payload: {
  tradeId: string;
  tagIds: number[];
}): Promise<{ ok: boolean; tagIds: number[] }> {
  return requestJson('/api/bitlang-review/trade-tags', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export type BitlangDrawingScope = {
  tradeId: string;
};

type BitlangDrawingResponse = {
  id: string;
  toolType: string;
  points: Array<{ timestamp: number; price: number }>;
  options: Record<string, unknown>;
  interval?: ReviewTimeframe;
};

function toBitlangDrawing(
  raw: BitlangDrawingResponse,
  tradeId: string,
  symbol: string,
  interval: ReviewTimeframe
): PersistedDrawing {
  return {
    id: raw.id,
    videoId: tradeId,
    symbol,
    interval: raw.interval || interval,
    toolType: raw.toolType,
    points: raw.points || [],
    options: raw.options || {},
  };
}

export async function fetchBitlangDrawings(
  scope: BitlangDrawingScope,
  symbol: string,
  interval: ReviewTimeframe,
  signal?: AbortSignal
): Promise<PersistedDrawing[]> {
  const params = new URLSearchParams({
    tradeId: scope.tradeId,
    symbol,
    interval,
  });
  const data = await requestJson<{ drawings: BitlangDrawingResponse[] }>(
    `/api/bitlang-review/drawings?${params}`,
    { signal }
  );
  return (data.drawings || []).map((raw) =>
    toBitlangDrawing(raw, scope.tradeId, symbol, interval)
  );
}

export async function saveBitlangDrawing(
  scope: BitlangDrawingScope,
  drawing: PersistedDrawing
): Promise<PersistedDrawing> {
  const saved = await requestJson<BitlangDrawingResponse>(
    '/api/bitlang-review/drawings',
    {
      method: 'POST',
      body: JSON.stringify({
        tradeId: scope.tradeId,
        id: drawing.id,
        symbol: drawing.symbol,
        interval: drawing.interval,
        toolType: drawing.toolType,
        points: drawing.points,
        options: drawing.options,
      }),
    }
  );
  return toBitlangDrawing(
    saved,
    scope.tradeId,
    drawing.symbol,
    drawing.interval
  );
}

export async function replaceBitlangDrawings(
  scope: BitlangDrawingScope,
  symbol: string,
  interval: ReviewTimeframe,
  drawings: PersistedDrawing[]
): Promise<PersistedDrawing[]> {
  const data = await requestJson<{ drawings: BitlangDrawingResponse[] }>(
    '/api/bitlang-review/drawings',
    {
      method: 'PUT',
      body: JSON.stringify({
        tradeId: scope.tradeId,
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
    toBitlangDrawing(raw, scope.tradeId, symbol, interval)
  );
}

export async function deleteBitlangDrawing(
  scope: BitlangDrawingScope,
  symbol: string,
  interval: ReviewTimeframe,
  id?: string
): Promise<void> {
  const params = new URLSearchParams({
    tradeId: scope.tradeId,
    symbol,
    interval,
  });
  if (id) params.set('id', id);
  await requestJson<{ ok: boolean }>(
    `/api/bitlang-review/drawings?${params}`,
    { method: 'DELETE' }
  );
}

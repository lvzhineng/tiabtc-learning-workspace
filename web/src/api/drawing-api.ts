import { requestJson } from './http';
import type { PersistedDrawing } from '@/domain/drawing';
import type { ReviewTimeframe } from '@/domain/timeframe';

type DrawingResponse = {
  id: string;
  toolType: string;
  points: Array<{ timestamp: number; price: number }>;
  options: Record<string, unknown>;
};

type DrawingsResponse = {
  drawings: DrawingResponse[];
};

function toPersistedDrawing(
  raw: DrawingResponse,
  videoId: string,
  symbol: string,
  interval: ReviewTimeframe
): PersistedDrawing {
  return {
    id: raw.id,
    videoId,
    symbol,
    interval,
    toolType: raw.toolType,
    points: raw.points || [],
    options: raw.options || {},
  };
}

export async function fetchDrawings(
  videoId: string,
  symbol: string,
  interval: ReviewTimeframe,
  signal?: AbortSignal
): Promise<PersistedDrawing[]> {
  const params = new URLSearchParams({ videoId, symbol, interval });
  const data = await requestJson<DrawingsResponse>(`/api/chart/drawings?${params}`, { signal });
  return (data.drawings || []).map((raw) =>
    toPersistedDrawing(raw, videoId, symbol, interval)
  );
}

export async function saveDrawing(drawing: PersistedDrawing): Promise<PersistedDrawing> {
  const saved = await requestJson<DrawingResponse>('/api/chart/drawings', {
    method: 'POST',
    body: JSON.stringify({
      id: drawing.id,
      videoId: drawing.videoId,
      symbol: drawing.symbol,
      interval: drawing.interval,
      toolType: drawing.toolType,
      points: drawing.points,
      options: drawing.options,
    }),
  });
  return toPersistedDrawing(
    saved,
    drawing.videoId,
    drawing.symbol,
    drawing.interval
  );
}

export async function replaceDrawings(
  videoId: string,
  symbol: string,
  interval: ReviewTimeframe,
  drawings: PersistedDrawing[]
): Promise<PersistedDrawing[]> {
  const data = await requestJson<DrawingsResponse>('/api/chart/drawings', {
    method: 'PUT',
    body: JSON.stringify({
      videoId,
      symbol,
      interval,
      drawings: drawings.map((drawing) => ({
        id: drawing.id,
        toolType: drawing.toolType,
        points: drawing.points,
        options: drawing.options,
      })),
    }),
  });
  return (data.drawings || []).map((raw) =>
    toPersistedDrawing(raw, videoId, symbol, interval)
  );
}

export async function deleteDrawing(
  id: string,
  videoId: string,
  symbol: string,
  interval: ReviewTimeframe
): Promise<void> {
  const params = new URLSearchParams({ id, videoId, symbol, interval });
  await requestJson<{ ok: boolean }>(`/api/chart/drawings?${params}`, {
    method: 'DELETE',
  });
}

export async function clearAllDrawingsForSymbol(
  videoId: string,
  symbol: string,
  interval: ReviewTimeframe
): Promise<void> {
  const params = new URLSearchParams({ videoId, symbol, interval });
  await requestJson<{ ok: boolean }>(`/api/chart/drawings?${params}`, {
    method: 'DELETE',
  });
}

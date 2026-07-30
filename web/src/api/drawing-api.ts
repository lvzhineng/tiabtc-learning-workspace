import { requestJson } from './http';
import type { PersistedDrawing } from '@/domain/drawing';
import type { ReviewTimeframe } from '@/domain/timeframe';

type RawDrawing = {
  id: string;
  video_id: string;
  symbol: string;
  interval: string;
  tool_type: string;
  tool_json: string;
  created_at?: string;
  updated_at?: string;
};

type DrawingsResponse = {
  drawings: RawDrawing[];
};

function rawToPersisted(raw: RawDrawing): PersistedDrawing {
  let parsedTool: unknown = null;
  try {
    parsedTool = JSON.parse(raw.tool_json);
  } catch {
    parsedTool = raw.tool_json;
  }
  return {
    id: raw.id,
    videoId: raw.video_id,
    symbol: raw.symbol,
    interval: raw.interval as ReviewTimeframe,
    toolType: raw.tool_type,
    tool: parsedTool,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function persistedToRaw(drawing: PersistedDrawing): RawDrawing {
  return {
    id: drawing.id,
    video_id: drawing.videoId,
    symbol: drawing.symbol,
    interval: drawing.interval,
    tool_type: drawing.toolType,
    tool_json: typeof drawing.tool === 'string' ? drawing.tool : JSON.stringify(drawing.tool),
    created_at: drawing.createdAt,
    updated_at: drawing.updatedAt,
  };
}

export async function fetchDrawings(
  videoId: string,
  symbol: string,
  interval?: ReviewTimeframe,
  signal?: AbortSignal
): Promise<PersistedDrawing[]> {
  const params = new URLSearchParams({ videoId, symbol });
  if (interval) {
    params.set('interval', interval);
  }
  const data = await requestJson<DrawingsResponse>(`/api/chart/drawings?${params}`, { signal });
  return (data.drawings || []).map(rawToPersisted);
}

export async function saveDrawing(drawing: PersistedDrawing): Promise<PersistedDrawing> {
  const raw = persistedToRaw(drawing);
  const data = await requestJson<RawDrawing>('/api/chart/drawings', {
    method: 'POST',
    body: JSON.stringify(raw),
  });
  return rawToPersisted(data);
}

export async function replaceDrawings(drawings: PersistedDrawing[]): Promise<PersistedDrawing[]> {
  const rawList = drawings.map(persistedToRaw);
  const data = await requestJson<DrawingsResponse>('/api/chart/drawings', {
    method: 'PUT',
    body: JSON.stringify(rawList),
  });
  return (data.drawings || []).map(rawToPersisted);
}

export async function deleteDrawing(id: string, videoId = '', symbol = ''): Promise<void> {
  const params = new URLSearchParams({ id, videoId, symbol });
  await requestJson<{ ok: boolean }>(`/api/chart/drawings?${params}`, {
    method: 'DELETE',
  });
}

export async function clearAllDrawingsForSymbol(symbol: string): Promise<void> {
  const params = new URLSearchParams({ symbol, clearAll: 'true' });
  await requestJson<{ ok: boolean }>(`/api/chart/drawings?${params}`, {
    method: 'DELETE',
  });
}

import { requestJson } from './http';
import { toPersistedDrawing, type RawScopedDrawing } from './drawing-response';
import type { PersistedDrawing } from '@/domain/drawing';
import type { ReviewTimeframe } from '@/domain/timeframe';

export async function fetchDrawings(scope: string, symbol: string, interval: ReviewTimeframe, signal?: AbortSignal): Promise<PersistedDrawing[]> {
  const data = await requestJson<{ drawings: RawScopedDrawing[] }>(`/api/cfd/drawings?${new URLSearchParams({ symbol, interval })}`, { signal });
  return data.drawings.map((row) => toPersistedDrawing(row, scope, symbol, interval));
}
export async function saveDrawing(drawing: PersistedDrawing): Promise<PersistedDrawing> {
  const data = await requestJson<RawScopedDrawing>('/api/cfd/drawings', { method: 'POST', body: JSON.stringify(drawing) });
  return toPersistedDrawing(data, drawing.videoId, drawing.symbol, drawing.interval);
}
export async function replaceDrawings(scope: string, symbol: string, interval: ReviewTimeframe, drawings: PersistedDrawing[]): Promise<PersistedDrawing[]> {
  const data = await requestJson<{ drawings: RawScopedDrawing[] }>('/api/cfd/drawings', { method: 'PUT', body: JSON.stringify({ symbol, interval, drawings }) });
  return data.drawings.map((row) => toPersistedDrawing(row, scope, symbol, interval));
}
export async function deleteDrawing(id: string, _scope: string, symbol: string, interval: ReviewTimeframe): Promise<void> {
  await requestJson(`/api/cfd/drawings?${new URLSearchParams({ id, symbol, interval })}`, { method: 'DELETE' });
}
export async function clearAllDrawingsForSymbol(_scope: string, symbol: string, interval: ReviewTimeframe): Promise<void> {
  await requestJson(`/api/cfd/drawings?${new URLSearchParams({ symbol, interval })}`, { method: 'DELETE' });
}

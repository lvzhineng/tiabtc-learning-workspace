import type { PersistedDrawing } from '@/domain/drawing';
import type { ReviewTimeframe } from '@/domain/timeframe';

export type RawScopedDrawing = {
  id: string;
  toolType: string;
  points: Array<{ timestamp: number; price: number }>;
  options: Record<string, unknown>;
  interval?: ReviewTimeframe;
};

export function toPersistedDrawing(
  raw: RawScopedDrawing,
  scopeId: string,
  symbol: string,
  interval: ReviewTimeframe
): PersistedDrawing {
  return {
    id: raw.id,
    videoId: scopeId,
    symbol,
    interval: raw.interval || interval,
    toolType: raw.toolType,
    points: raw.points || [],
    options: raw.options || {},
  };
}

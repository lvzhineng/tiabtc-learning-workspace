import type { PersistedDrawing } from '@/domain/drawing';
import type { DrawingToolState, DrawingPoint } from './drawing-types';

export function deserializeDrawing(persisted: PersistedDrawing): DrawingToolState {
  const toolObj = typeof persisted.tool === 'object' && persisted.tool !== null ? (persisted.tool as Record<string, unknown>) : {};

  const points: DrawingPoint[] = [];

  // Parse points if in legacy "points" array format
  if (Array.isArray(toolObj.points)) {
    for (const pt of toolObj.points) {
      if (typeof pt === 'object' && pt !== null) {
        const rawTs = (pt as { timestamp?: number; time?: number }).timestamp ?? (pt as { time?: number }).time ?? 0;
        const tsMs = rawTs < 10000000000 ? rawTs * 1000 : rawTs;
        const price = Number((pt as { price?: number }).price) || 0;
        points.push({ timestampMs: tsMs, price });
      }
    }
  }

  // Parse points if in enhanced "anchors" array format
  if (points.length === 0 && Array.isArray(toolObj.anchors)) {
    for (const pt of toolObj.anchors) {
      if (typeof pt === 'object' && pt !== null) {
        const rawTs = (pt as { time?: number; timestamp?: number }).time ?? (pt as { timestamp?: number }).timestamp ?? 0;
        const tsMs = rawTs < 10000000000 ? rawTs * 1000 : rawTs;
        const price = Number((pt as { price?: number }).price) || 0;
        points.push({ timestampMs: tsMs, price });
      }
    }
  }

  const toolType = (toolObj.toolType as string) || (toolObj.type as string) || persisted.toolType;

  return {
    id: persisted.id,
    videoId: persisted.videoId,
    symbol: persisted.symbol,
    interval: persisted.interval,
    toolType,
    points,
    text: (toolObj.text as string) || '',
    locked: Boolean(toolObj.locked || toolObj.isLocked),
    color: (toolObj.color as string) || '#2962ff',
    lineWidth: Number(toolObj.lineWidth || toolObj.width) || 2,
    extra: toolObj,
  };
}

export function serializeDrawing(state: DrawingToolState): PersistedDrawing {
  const toolPayload = {
    id: state.id,
    toolType: state.toolType,
    points: state.points.map((pt) => ({
      timestamp: pt.timestampMs,
      price: pt.price,
    })),
    text: state.text,
    locked: Boolean(state.locked),
    color: state.color || '#2962ff',
    lineWidth: state.lineWidth || 2,
    ...state.extra,
  };

  return {
    id: state.id,
    videoId: state.videoId,
    symbol: state.symbol,
    interval: state.interval as any,
    toolType: state.toolType,
    tool: toolPayload,
  };
}

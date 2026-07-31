import type { PersistedDrawing } from '@/domain/drawing';
import type { DrawingToolState, DrawingPoint } from './drawing-types';

const SERVER_TOOL_TYPES: Record<string, string> = {
  'short-position': 'ShortPosition',
  'long-position': 'LongPosition',
  'date-price-range': 'DatePriceRange',
  path: 'Path',
  'text-annotation': 'TextAnnotation',
  'fixed-range-volume-profile': 'FixedRangeVolumeProfile',
  'arrow-mark-up': 'ArrowMarkUp',
  'arrow-mark-down': 'ArrowMarkDown',
  brush: 'Brush',
  'rotated-rectangle': 'RotatedRectangle',
};

const UI_TOOL_TYPES = Object.fromEntries(
  Object.entries(SERVER_TOOL_TYPES).map(([uiType, serverType]) => [
    serverType,
    uiType,
  ])
);

export function toServerToolType(toolType: string): string {
  return SERVER_TOOL_TYPES[toolType] || toolType;
}

export function toUiToolType(toolType: string): string {
  return UI_TOOL_TYPES[toolType] || toolType;
}

export function deserializeDrawing(
  persisted: PersistedDrawing
): DrawingToolState {
  const lineOptions =
    typeof persisted.options.line === 'object' &&
    persisted.options.line !== null
      ? (persisted.options.line as Record<string, unknown>)
      : {};
  const points: DrawingPoint[] = (persisted.points || []).map((point) => {
    const rawTimestamp = Number(point.timestamp);
    return {
      timestampMs:
        rawTimestamp < 10_000_000_000
          ? rawTimestamp * 1000
          : rawTimestamp,
      price: Number(point.price),
    };
  });

  return {
    id: persisted.id,
    videoId: persisted.videoId,
    symbol: persisted.symbol,
    interval: persisted.interval,
    toolType: toUiToolType(persisted.toolType),
    points,
    text: String(persisted.options.text || ''),
    locked: Boolean(
      persisted.options.locked || persisted.options.editable === false
    ),
    color: String(
      persisted.options.color || lineOptions.color || '#2962ff'
    ),
    lineWidth:
      Number(persisted.options.lineWidth || lineOptions.width) || 2,
    extra: persisted.options,
  };
}

export function serializeDrawing(
  state: DrawingToolState
): PersistedDrawing {
  const {
    text: _oldText,
    locked: _oldLocked,
    color: _oldColor,
    lineWidth: _oldLineWidth,
    ...extraOptions
  } = state.extra || {};

  return {
    id: state.id,
    videoId: state.videoId,
    symbol: state.symbol,
    interval: state.interval,
    toolType: toServerToolType(state.toolType),
    points: state.points.map((point) => ({
      timestamp: point.timestampMs,
      price: point.price,
    })),
    options: {
      ...extraOptions,
      text: state.text || '',
      locked: Boolean(state.locked),
      editable: !state.locked,
      color: state.color || '#2962ff',
      lineWidth: state.lineWidth || 2,
    },
  };
}

import {
  useEffect,
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { IChartApi, ISeriesApi, Logical } from 'lightweight-charts';
import type { Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { TIMEFRAME_SECONDS_MAP } from '@/domain/timeframe';
import {
  coordinateToChartTimestampMs,
  timestampMsToUtcTimestamp,
} from '@/chart/chart-time';
import { formatPrice } from '@/chart/candlestick-readout';
import {
  ANCHOR_COUNTS,
  type ActiveToolType,
  type DrawingPoint,
  type DrawingToolState,
} from './drawing-types';
import { DrawingQuickActionBar } from './DrawingQuickActionBar';
import { getSavedDrawingStyle } from './drawing-style-storage';

function isPositionTool(toolType: string): boolean {
  return (
    toolType === 'LongPosition' ||
    toolType === 'ShortPosition' ||
    toolType === 'long-position' ||
    toolType === 'short-position'
  );
}

function isLongPositionTool(toolType: string): boolean {
  return toolType === 'LongPosition' || toolType === 'long-position';
}

/** TradingView-style: one click places entry + default TP/SL box (about 1:2 RR). */
function buildPositionPoints(
  entry: DrawingPoint,
  toolType: string,
  interval: ReviewTimeframe
): DrawingPoint[] {
  const intervalMs = TIMEFRAME_SECONDS_MAP[interval] * 1000;
  const risk = Math.max(entry.price * 0.005, Number.EPSILON);
  const long = isLongPositionTool(toolType);
  const stopPrice = long ? entry.price - risk : entry.price + risk;
  const targetPrice = long ? entry.price + risk * 2 : entry.price - risk * 2;
  const rightTime = entry.timestampMs + intervalMs * 40;
  return [
    { timestampMs: entry.timestampMs, price: entry.price },
    { timestampMs: rightTime, price: targetPrice },
    { timestampMs: rightTime, price: stopPrice },
  ];
}

type Props = {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  candles: Candlestick[];
  drawings: DrawingToolState[];
  activeTool: ActiveToolType;
  selectedDrawingId: string | null;
  magnetEnabled: boolean;
  videoId: string;
  symbol: string;
  interval: ReviewTimeframe;
  onSelectDrawing: (id: string | null) => void;
  onSaveDrawing: (drawing: DrawingToolState) => void | Promise<void>;
  onDeleteDrawing?: (id: string) => void;
  onToggleLockDrawing?: (id: string) => void;
  onDrawingComplete: () => void;
};

type DragState = {
  drawing: DrawingToolState;
  origin: DrawingPoint;
  preview: DrawingToolState;
  pointIndex: number | null;
};

function drawingId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `drawing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const DRAWING_CURSOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 25 25">' +
  '<path d="M12.5 1v8m0 7v8M1 12.5h8m7 0h8" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>' +
  '<path d="M12.5 1v8m0 7v8M1 12.5h8m7 0h8" fill="none" stroke="#0f172a" stroke-width="2" stroke-linecap="round"/>' +
  '<circle cx="12.5" cy="12.5" r="2.25" fill="#fff" stroke="#0f172a" stroke-width="1.5"/>' +
  '</svg>';
const DRAWING_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  DRAWING_CURSOR_SVG
)}") 12 12, crosshair`;

function formatRangeDuration(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.round(durationMs / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}分钟`);
  return parts.join(' ');
}

function formatSignedPrice(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatPrice(Math.abs(value))}`;
}

function findNearestCandle(
  candles: Candlestick[],
  timestampMs: number
): Candlestick {
  let low = 0;
  let high = candles.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].timestampMs < timestampMs) low = middle + 1;
    else high = middle;
  }
  const right = candles[low];
  const left = candles[Math.max(0, low - 1)];
  return Math.abs(left.timestampMs - timestampMs) <=
    Math.abs(right.timestampMs - timestampMs)
    ? left
    : right;
}

function timestampToChartCoordinate(
  chart: IChartApi,
  candles: Candlestick[],
  timestampMs: number,
  interval: ReviewTimeframe
): number | null {
  const directCoordinate = chart.timeScale().timeToCoordinate(
    timestampMsToUtcTimestamp(timestampMs)
  );
  if (directCoordinate !== null) return directCoordinate;
  if (candles.length === 0) return null;
  if (candles.length === 1) {
    const intervalMs = TIMEFRAME_SECONDS_MAP[interval] * 1000;
    const logicalOffset =
      (timestampMs - candles[0].timestampMs) / intervalMs;
    return chart.timeScale().logicalToCoordinate(logicalOffset as Logical);
  }

  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].timestampMs < timestampMs) low = middle + 1;
    else high = middle;
  }

  let rightIndex = Math.min(
    candles.length - 1,
    Math.max(1, low)
  );
  while (rightIndex > 0) {
    const leftCandle = candles[rightIndex - 1];
    const rightCandle = candles[rightIndex];
    const leftCoordinate = chart.timeScale().timeToCoordinate(
      timestampMsToUtcTimestamp(leftCandle.timestampMs)
    );
    const rightCoordinate = chart.timeScale().timeToCoordinate(
      timestampMsToUtcTimestamp(rightCandle.timestampMs)
    );
    if (leftCoordinate !== null && rightCoordinate !== null) {
      const timeSpan = rightCandle.timestampMs - leftCandle.timestampMs;
      if (timeSpan <= 0) return leftCoordinate;
      const ratio = (timestampMs - leftCandle.timestampMs) / timeSpan;
      return leftCoordinate + (rightCoordinate - leftCoordinate) * ratio;
    }
    rightIndex -= 1;
  }
  return null;
}

export function ChartDrawingOverlay({
  chart,
  series,
  candles,
  drawings,
  activeTool,
  selectedDrawingId,
  magnetEnabled,
  videoId,
  symbol,
  interval,
  onSelectDrawing,
  onSaveDrawing,
  onDeleteDrawing,
  onToggleLockDrawing,
  onDrawingComplete,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const candlesRef = useRef(candles);
  const [draftPoints, setDraftPoints] = useState<DrawingPoint[]>([]);
  const [hoverPoint, setHoverPoint] = useState<DrawingPoint | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [viewportRevision, setViewportRevision] = useState(0);
  const redrawFrameRef = useRef<number | null>(null);
  candlesRef.current = candles;

  useEffect(() => {
    let disposed = false;
    const scheduleRedraw = () => {
      if (disposed || redrawFrameRef.current !== null) return;
      redrawFrameRef.current = window.requestAnimationFrame(() => {
        redrawFrameRef.current = null;
        if (disposed) return;
        setViewportRevision((revision) => revision + 1);
      });
    };
    const timeScale = chart.timeScale();
    const host = svgRef.current?.parentElement;
    let pointerActive = false;
    const handlePointerDown = () => {
      pointerActive = true;
      scheduleRedraw();
    };
    const handlePointerMove = () => {
      if (pointerActive) scheduleRedraw();
    };
    const handlePointerEnd = () => {
      if (!pointerActive) return;
      pointerActive = false;
      scheduleRedraw();
    };
    const pendingTimeouts: number[] = [];
    const handleWheel = () => {
      scheduleRedraw();
      pendingTimeouts.push(window.setTimeout(scheduleRedraw, 0));
    };
    const handleDoubleClick = () => {
      scheduleRedraw();
      pendingTimeouts.push(window.setTimeout(scheduleRedraw, 0));
    };

    timeScale.subscribeVisibleLogicalRangeChange(scheduleRedraw);
    timeScale.subscribeSizeChange(scheduleRedraw);
    host?.addEventListener('pointerdown', handlePointerDown, true);
    host?.addEventListener('pointermove', handlePointerMove, true);
    host?.addEventListener('pointerup', handlePointerEnd, true);
    host?.addEventListener('pointercancel', handlePointerEnd, true);
    host?.addEventListener('wheel', handleWheel, true);
    host?.addEventListener('dblclick', handleDoubleClick, true);

    return () => {
      disposed = true;
      timeScale.unsubscribeVisibleLogicalRangeChange(scheduleRedraw);
      timeScale.unsubscribeSizeChange(scheduleRedraw);
      host?.removeEventListener('pointerdown', handlePointerDown, true);
      host?.removeEventListener('pointermove', handlePointerMove, true);
      host?.removeEventListener('pointerup', handlePointerEnd, true);
      host?.removeEventListener('pointercancel', handlePointerEnd, true);
      host?.removeEventListener('wheel', handleWheel, true);
      host?.removeEventListener('dblclick', handleDoubleClick, true);
      for (const timeoutId of pendingTimeouts) {
        window.clearTimeout(timeoutId);
      }
      if (redrawFrameRef.current !== null) {
        window.cancelAnimationFrame(redrawFrameRef.current);
        redrawFrameRef.current = null;
      }
    };
  }, [chart]);

  // ChartCanvas applies Lightweight Charts series data in an effect after the
  // React tree has rendered. Redraw once on the next frame so drawing
  // coordinates always use the updated candle series after replay steps,
  // rewinds, and prepend/append loads.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setViewportRevision((revision) => revision + 1);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [candles]);

  const coordinateRevision = `${viewportRevision}`;
  const isFreehandTool = activeTool === 'brush';

  const displayedDrawings = useMemo(() => {
    if (!drag) return drawings;
    return drawings.map((drawing) =>
      drawing.id === drag.preview.id ? drag.preview : drawing
    );
  }, [drag, drawings]);

  const drawingTimeBounds = useMemo(() => {
    const bounds = new Map<string, { minMs: number; maxMs: number }>();
    for (const drawing of displayedDrawings) {
      if (drawing.points.length === 0) continue;
      let minMs = drawing.points[0].timestampMs;
      let maxMs = minMs;
      for (let index = 1; index < drawing.points.length; index++) {
        const timestampMs = drawing.points[index].timestampMs;
        if (timestampMs < minMs) minMs = timestampMs;
        if (timestampMs > maxMs) maxMs = timestampMs;
      }
      bounds.set(drawing.id, { minMs, maxMs });
    }
    return bounds;
  }, [displayedDrawings]);

  const snapPrice = useCallback(
    (price: number, timestampMs: number) => {
      if (!magnetEnabled || candlesRef.current.length === 0) return price;
      const nearestCandle = findNearestCandle(candlesRef.current, timestampMs);
      const candidates = [
        nearestCandle.open,
        nearestCandle.high,
        nearestCandle.low,
        nearestCandle.close,
      ];
      let best = price;
      let minDiff = Number.POSITIVE_INFINITY;
      for (const candidate of candidates) {
        const diff = Math.abs(candidate - price);
        if (diff < minDiff) {
          minDiff = diff;
          best = candidate;
        }
      }
      return best;
    },
    [magnetEnabled]
  );

  const eventToPoint = useCallback(
    (event: ReactPointerEvent<SVGElement>): DrawingPoint | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const clientX = event.clientX - rect.left;
      const clientY = event.clientY - rect.top;
      const lastCandleTimeMs =
        candlesRef.current.length > 0
          ? candlesRef.current[candlesRef.current.length - 1].timestampMs
          : undefined;
      const timestampMs = coordinateToChartTimestampMs(
        chart,
        clientX,
        lastCandleTimeMs,
        interval
      );
      const rawPrice = series.coordinateToPrice(clientY);
      if (timestampMs === null || rawPrice === null) return null;
      const price = snapPrice(Number(rawPrice), timestampMs);
      return { timestampMs, price };
    },
    [chart, interval, series, snapPrice]
  );

  const saveNewDrawing = (points: DrawingPoint[]) => {
    const savedStyle = getSavedDrawingStyle(activeTool);
    const drawing: DrawingToolState = {
      id: drawingId(),
      videoId,
      symbol,
      interval,
      toolType: activeTool,
      points,
      color: savedStyle.color,
      lineWidth: savedStyle.lineWidth,
      extra: {
        ...(activeTool === 'half-retracement'
          ? { retracementVariant: 'half' }
          : {}),
        lineStyle: savedStyle.lineStyle,
      },
    };
    setDraftPoints([]);
    setHoverPoint(null);
    onSelectDrawing(drawing.id);
    void onSaveDrawing(drawing);
    onDrawingComplete();
  };

  const handleBackgroundPointerDown = (
    event: ReactPointerEvent<SVGRectElement>
  ) => {
    if (event.button !== 0) return;
    if (activeTool === 'select') {
      onSelectDrawing(null);
      return;
    }

    const point = eventToPoint(event);
    if (!point) return;
    setHoverPoint(null);
    if (isFreehandTool) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraftPoints([point]);
      return;
    }

    if (isPositionTool(activeTool)) {
      saveNewDrawing(buildPositionPoints(point, activeTool, interval));
      return;
    }

    const requiredPoints = ANCHOR_COUNTS[activeTool] || 2;
    const nextPoints = [...draftPoints, point];
    if (nextPoints.length < requiredPoints) {
      setDraftPoints(nextPoints);
      return;
    }
    saveNewDrawing(nextPoints);
  };

  const handleDrawingPointerDown = useCallback((
    event: ReactPointerEvent<SVGElement>,
    drawing: DrawingToolState,
    pointIndex: number | null = null
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectDrawing(drawing.id);
    if (activeTool !== 'select' || drawing.locked) return;
    const origin = eventToPoint(event);
    if (!origin) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ drawing, origin, preview: drawing, pointIndex });
  }, [activeTool, eventToPoint, onSelectDrawing]);

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag) {
      const current = eventToPoint(event);
      if (!current) {
        setHoverPoint(null);
        return;
      }
      if (activeTool !== 'select' && !isFreehandTool) {
        setHoverPoint(current);
      }
      if (draftPoints.length === 0) return;
      if (!isFreehandTool) return;

      const pointLimit = activeTool === 'brush' ? 1000 : 500;
      setDraftPoints((points) => {
        if (points.length >= pointLimit) return points;
        const previous = points[points.length - 1];
        if (
          previous &&
          previous.timestampMs === current.timestampMs &&
          Math.abs(previous.price - current.price) <
            Math.max(1e-8, current.price * 0.00001)
        ) {
          return points;
        }
        return [...points, current];
      });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const current = eventToPoint(event);
    if (!current) return;
    const deltaTime = current.timestampMs - drag.origin.timestampMs;
    const deltaPrice = current.price - drag.origin.price;
    const toolType = drag.drawing.toolType;

    let nextPoints = drag.drawing.points.map((point, index) =>
      drag.pointIndex === null
        ? {
            timestampMs: point.timestampMs + deltaTime,
            price: Math.max(Number.EPSILON, point.price + deltaPrice),
          }
        : index === drag.pointIndex
        ? current
        : point
    );

    if (isPositionTool(toolType) && drag.pointIndex !== null && nextPoints.length >= 3) {
      if (drag.pointIndex === 0) {
        const widthMs = Math.max(
          0,
          drag.drawing.points[1].timestampMs - drag.drawing.points[0].timestampMs
        );
        nextPoints = [
          {
            timestampMs: drag.drawing.points[0].timestampMs + deltaTime,
            price: Math.max(Number.EPSILON, current.price),
          },
          {
            timestampMs:
              drag.drawing.points[0].timestampMs + deltaTime + widthMs,
            price: nextPoints[1].price,
          },
          {
            timestampMs:
              drag.drawing.points[0].timestampMs + deltaTime + widthMs,
            price: nextPoints[2].price,
          },
        ];
      } else if (drag.pointIndex === 1) {
        nextPoints = [
          nextPoints[0],
          {
            timestampMs: Math.max(
              nextPoints[0].timestampMs + 1,
              current.timestampMs
            ),
            price: Math.max(Number.EPSILON, current.price),
          },
          {
            timestampMs: Math.max(
              nextPoints[0].timestampMs + 1,
              current.timestampMs
            ),
            price: nextPoints[2].price,
          },
        ];
      } else if (drag.pointIndex === 2) {
        nextPoints = [
          nextPoints[0],
          {
            ...nextPoints[1],
            timestampMs: nextPoints[1].timestampMs,
          },
          {
            timestampMs: nextPoints[1].timestampMs,
            price: Math.max(Number.EPSILON, current.price),
          },
        ];
      }
    }

    setDrag({
      ...drag,
      preview: {
        ...drag.drawing,
        points: nextPoints,
      },
    });
  };

  const finishPointerInteraction = () => {
    if (drag) {
      const updated = drag.preview;
      setDrag(null);
      void onSaveDrawing(updated);
      return;
    }
    if (isFreehandTool && draftPoints.length > 0) {
      const completedPoints = draftPoints;
      setDraftPoints([]);
      if (completedPoints.length >= 2) {
        saveNewDrawing(completedPoints);
      }
    }
  };

  const handleContextMenu = (
    event: ReactMouseEvent<SVGSVGElement>
  ) => {
    if (activeTool === 'select') return;
    event.preventDefault();
    event.stopPropagation();
    setDraftPoints([]);
    setHoverPoint(null);
    setDrag(null);
    onDrawingComplete();
  };

  const toTimeCoordinate = useCallback((timestampMs: number) => {
    return timestampToChartCoordinate(
      chart,
      candlesRef.current,
      timestampMs,
      interval
    );
  }, [chart, interval]);

  const toCoordinate = useCallback((point: DrawingPoint) => {
    const x = toTimeCoordinate(point.timestampMs);
    const y = series.priceToCoordinate(point.price);
    return x === null || y === null ? null : { x, y: Number(y) };
  }, [series, toTimeCoordinate]);

  const draftCoordinates = draftPoints
    .map(toCoordinate)
    .flatMap((point) =>
      point === null ? [] : [{ x: point.x, y: Number(point.y) }]
    );
  const previewPoints =
    !isFreehandTool && hoverPoint && draftPoints.length > 0
      ? [...draftPoints, hoverPoint]
      : [];
  const activeToolStyle = useMemo(
    () => getSavedDrawingStyle(activeTool),
    [activeTool]
  );
  const draftPreview: DrawingToolState | null =
    previewPoints.length > 1
      ? {
          id: '__draft-preview__',
          videoId,
          symbol,
          interval,
          toolType: activeTool,
          points: previewPoints,
          color: activeToolStyle.color,
          lineWidth: activeToolStyle.lineWidth,
          locked: true,
          extra: {
            lineStyle: activeToolStyle.lineStyle,
          },
        }
      : null;

  const viewportWidth = chart.timeScale().width();

  const visibleDrawings = useMemo(() => {
    if (viewportWidth <= 0) return displayedDrawings;
    const bufferPx = Math.max(viewportWidth * 0.5, 160);
    return displayedDrawings.filter((drawing) => {
      if (drawing.id === selectedDrawingId) return true;
      if (
        drawing.toolType === 'HorizontalLine' ||
        drawing.toolType === 'HorizontalRay' ||
        drawing.toolType === 'Ray' ||
        drawing.toolType === 'ExtendedLine'
      ) {
        return true;
      }
      const bounds = drawingTimeBounds.get(drawing.id);
      if (!bounds) return true;
      const minX = toTimeCoordinate(bounds.minMs);
      const maxX = toTimeCoordinate(bounds.maxMs);
      if (minX === null || maxX === null) return true;
      return !(
        Math.max(minX, maxX) < -bufferPx ||
        Math.min(minX, maxX) > viewportWidth + bufferPx
      );
    });
  }, [
    coordinateRevision,
    displayedDrawings,
    drawingTimeBounds,
    selectedDrawingId,
    toTimeCoordinate,
    viewportWidth,
  ]);

  const selectedDrawing = useMemo(
    () => displayedDrawings.find((d) => d.id === selectedDrawingId) || null,
    [displayedDrawings, selectedDrawingId]
  );

  const quickBarPosition = useMemo(() => {
    if (!selectedDrawing || activeTool !== 'select' || drag !== null) {
      return null;
    }
    const points = selectedDrawing.points
      .map(toCoordinate)
      .filter((p): p is { x: number; y: number } => p !== null);
    if (points.length === 0) return null;
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    return { x: (minX + maxX) / 2, y: minY };
  }, [activeTool, drag, selectedDrawing, toCoordinate]);

  const hoverPointCoord = hoverPoint ? toCoordinate(hoverPoint) : null;

  return (
    <>
      <svg
        ref={svgRef}
        className="chart-drawing-overlay"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverPoint(null)}
        onPointerUp={finishPointerInteraction}
        onPointerCancel={finishPointerInteraction}
        onContextMenu={handleContextMenu}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 4,
          cursor: activeTool === 'select' ? 'default' : DRAWING_CURSOR,
          pointerEvents: 'none',
        }}
      >
        <rect
          width="100%"
          height="100%"
          fill="transparent"
          pointerEvents={activeTool === 'select' ? 'none' : 'all'}
          onPointerDown={handleBackgroundPointerDown}
        />
        {visibleDrawings.map((drawing) => (
          <DrawingGeometry
            key={drawing.id}
            drawing={drawing}
            selected={drawing.id === selectedDrawingId}
            interactive={activeTool === 'select'}
            coordinateRevision={coordinateRevision}
            toCoordinate={toCoordinate}
            onPointerDown={handleDrawingPointerDown}
          />
        ))}

        {draftPreview && (
          <DrawingGeometry
            drawing={draftPreview}
            selected={false}
            interactive={false}
            coordinateRevision={coordinateRevision}
            toCoordinate={toCoordinate}
            onPointerDown={() => {}}
          />
        )}

        {draftCoordinates.map((point, index) => (
          <circle
            key={`draft-${index}`}
            cx={point.x}
            cy={point.y}
            r={4}
            fill="#facc15"
            stroke="#111827"
            strokeWidth={1}
            pointerEvents="none"
          />
        ))}
        {draftCoordinates.length > 1 && (
          <polyline
            points={draftCoordinates.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke="#facc15"
            strokeWidth={2}
            strokeDasharray="5 4"
            pointerEvents="none"
          />
        )}

        {/* Real-time Magnet snapping cursor guide */}
        {magnetEnabled && hoverPointCoord && (activeTool !== 'select' || drag !== null) && (
          <g pointerEvents="none">
            <circle
              cx={hoverPointCoord.x}
              cy={hoverPointCoord.y}
              r={7}
              fill="none"
              stroke="#38bdf8"
              strokeWidth={1.5}
              strokeDasharray="2 2"
            />
            <circle
              cx={hoverPointCoord.x}
              cy={hoverPointCoord.y}
              r={2.5}
              fill="#38bdf8"
            />
            <line
              x1={hoverPointCoord.x - 12}
              y1={hoverPointCoord.y}
              x2={hoverPointCoord.x + 12}
              y2={hoverPointCoord.y}
              stroke="#38bdf8"
              strokeWidth={1}
            />
            <line
              x1={hoverPointCoord.x}
              y1={hoverPointCoord.y - 12}
              x2={hoverPointCoord.x}
              y2={hoverPointCoord.y + 12}
              stroke="#38bdf8"
              strokeWidth={1}
            />
          </g>
        )}
      </svg>

      {/* Floating Quick Action Bar for selected drawing */}
      {selectedDrawing && quickBarPosition && (
        <DrawingQuickActionBar
          drawing={selectedDrawing}
          position={quickBarPosition}
          onUpdateDrawing={(updated) => {
            void onSaveDrawing(updated);
          }}
          onDeleteDrawing={() => {
            if (onDeleteDrawing) {
              onDeleteDrawing(selectedDrawing.id);
            }
          }}
          onToggleLock={() => {
            if (onToggleLockDrawing) {
              onToggleLockDrawing(selectedDrawing.id);
            }
          }}
        />
      )}
    </>
  );
}

const DrawingGeometry = memo(function DrawingGeometry({
  drawing,
  selected,
  interactive,
  coordinateRevision,
  toCoordinate,
  onPointerDown,
}: {
  drawing: DrawingToolState;
  selected: boolean;
  interactive: boolean;
  coordinateRevision: string;
  toCoordinate: (point: DrawingPoint) => { x: number; y: number } | null;
  onPointerDown: (
    event: ReactPointerEvent<SVGElement>,
    drawing: DrawingToolState,
    pointIndex?: number | null
  ) => void;
}) {
  void coordinateRevision;

  const points = drawing.points
    .map(toCoordinate)
    .filter((point): point is { x: number; y: number } => point !== null);
  if (points.length === 0) return null;

  const color = drawing.color || '#2962ff';
  const width = drawing.lineWidth || 2;
  const first = points[0];
  const second = points[1] || first;
  const type = drawing.toolType;
  const isDashed = drawing.extra?.lineStyle === 'dashed';
  const stroke = selected ? '#facc15' : color;
  const common = {
    fill: 'none',
    stroke,
    strokeWidth: selected ? width + 1 : width,
    strokeDasharray: isDashed ? '6 4' : undefined,
    vectorEffect: 'non-scaling-stroke' as const,
  };

  let geometry;
  if (type === 'HorizontalLine' || type === 'HorizontalRay') {
    geometry = (
      <line
        x1={type === 'HorizontalRay' ? first.x : 0}
        y1={first.y}
        x2="100%"
        y2={first.y}
        {...common}
      />
    );
  } else if (type === 'VerticalLine') {
    geometry = (
      <line x1={first.x} y1={0} x2={first.x} y2="100%" {...common} />
    );
  } else if (type === 'FibRetracement' || type === 'half-retracement') {
    const levels =
      type === 'half-retracement' ? [0, 0.5, 1] : [0, 0.618, 0.66, 1];
    geometry = (
      <>
        {levels.map((level) => {
          const y = second.y + (first.y - second.y) * level;
          return (
            <g key={level}>
              <line
                x1={Math.min(first.x, second.x)}
                x2={Math.max(first.x, second.x)}
                y1={y}
                y2={y}
                {...common}
              />
              <text
                x={Math.max(first.x, second.x) + 4}
                y={y - 2}
                fill={stroke}
                fontSize={10}
                stroke="none"
              >
                {level}
              </text>
            </g>
          );
        })}
      </>
    );
  } else if (type === 'ParallelChannel' && points.length >= 3) {
    const third = points[2];
    geometry = (
      <>
        <line x1={first.x} y1={first.y} x2={second.x} y2={second.y} {...common} />
        <line
          x1={third.x}
          y1={third.y}
          x2={third.x + second.x - first.x}
          y2={third.y + second.y - first.y}
          {...common}
        />
      </>
    );
  } else if (
    (type === 'rotated-rectangle' || type === 'RotatedRectangle') &&
    points.length >= 3
  ) {
    const third = points[2];
    const fourth = {
      x: second.x + third.x - first.x,
      y: second.y + third.y - first.y,
    };
    geometry = (
      <polygon
        points={`${first.x},${first.y} ${second.x},${second.y} ${fourth.x},${fourth.y} ${third.x},${third.y}`}
        fill={`${color}22`}
        stroke={stroke}
        strokeWidth={selected ? width + 1 : width}
      />
    );
  } else if (type === 'date-price-range' || type === 'DatePriceRange') {
    const left = Math.min(first.x, second.x);
    const top = Math.min(first.y, second.y);
    const boxWidth = Math.max(1, Math.abs(second.x - first.x));
    const boxHeight = Math.max(1, Math.abs(second.y - first.y));
    const fromPoint = drawing.points[0];
    const toPoint = drawing.points[1] || fromPoint;
    const priceChange = toPoint.price - fromPoint.price;
    const priceChangePercent = fromPoint.price
      ? (priceChange / fromPoint.price) * 100
      : 0;
    const timeSpanMs = Math.abs(toPoint.timestampMs - fromPoint.timestampMs);
    const intervalMs = TIMEFRAME_SECONDS_MAP[drawing.interval] * 1000;
    const barCount = Math.max(0, Math.round(timeSpanMs / intervalMs));
    const rangeColor = priceChange >= 0 ? '#089981' : '#f23645';
    const priceSign = priceChangePercent > 0 ? '+' : '';
    const priceLabel = `${formatSignedPrice(priceChange)} (${priceSign}${priceChangePercent.toFixed(
      2
    )}%)`;
    const timeLabel = `${barCount} 根K · ${formatRangeDuration(timeSpanMs)}`;
    const labelWidth = Math.max(
      132,
      Math.min(220, Math.max(priceLabel.length, timeLabel.length) * 7 + 12)
    );
    const labelX = left + 6;
    const labelY = top + 6;
    geometry = (
      <>
        <rect
          x={left}
          y={top}
          width={boxWidth}
          height={boxHeight}
          fill={rangeColor}
          fillOpacity={0.12}
          stroke={selected ? '#facc15' : rangeColor}
          strokeWidth={selected ? width + 1 : width}
        />
        <g pointerEvents="none">
          <rect
            x={labelX}
            y={labelY}
            width={labelWidth}
            height={34}
            rx={3}
            fill={rangeColor}
            fillOpacity={0.9}
          />
          <text
            x={labelX + 6}
            y={labelY + 13}
            fill="#ffffff"
            fontSize={11}
            fontWeight={600}
            stroke="none"
          >
            {priceLabel}
          </text>
          <text
            x={labelX + 6}
            y={labelY + 27}
            fill="#ffffff"
            fontSize={10}
            stroke="none"
          >
            {timeLabel}
          </text>
        </g>
      </>
    );
  } else if (
    type === 'Rectangle' ||
    type === 'fixed-range-volume-profile' ||
    type === 'FixedRangeVolumeProfile'
  ) {
    geometry = (
      <rect
        x={Math.min(first.x, second.x)}
        y={Math.min(first.y, second.y)}
        width={Math.max(1, Math.abs(second.x - first.x))}
        height={Math.max(1, Math.abs(second.y - first.y))}
        fill={`${color}22`}
        stroke={stroke}
        strokeWidth={selected ? width + 1 : width}
      />
    );
  } else if (
    type === 'LongPosition' ||
    type === 'ShortPosition' ||
    type === 'long-position' ||
    type === 'short-position'
  ) {
    const entry = first;
    const target = points[1] || first;
    const stop = points[2] || first;
    const left = Math.min(entry.x, target.x, stop.x);
    const right = Math.max(entry.x, target.x, stop.x);
    const widthPx = Math.max(56, right - left);
    const isLong = isLongPositionTool(type);
    const profitTop = Math.min(entry.y, target.y);
    const profitHeight = Math.max(2, Math.abs(target.y - entry.y));
    const lossTop = Math.min(entry.y, stop.y);
    const lossHeight = Math.max(2, Math.abs(stop.y - entry.y));
    const entryPrice = drawing.points[0]?.price ?? 0;
    const targetPrice = drawing.points[1]?.price ?? entryPrice;
    const stopPrice = drawing.points[2]?.price ?? entryPrice;
    const reward = Math.abs(targetPrice - entryPrice);
    const risk = Math.max(Math.abs(entryPrice - stopPrice), Number.EPSILON);
    const rr = reward / risk;
    const targetPct = entryPrice
      ? ((targetPrice - entryPrice) / entryPrice) * 100
      : 0;
    const stopPct = entryPrice
      ? ((stopPrice - entryPrice) / entryPrice) * 100
      : 0;
    geometry = (
      <>
        <rect
          x={left}
          y={profitTop}
          width={widthPx}
          height={profitHeight}
          fill="#26a69a"
          fillOpacity={0.25}
          stroke="#26a69a"
          strokeWidth={selected ? 2 : 1.25}
        />
        <rect
          x={left}
          y={lossTop}
          width={widthPx}
          height={lossHeight}
          fill="#ef5350"
          fillOpacity={0.25}
          stroke="#ef5350"
          strokeWidth={selected ? 2 : 1.25}
        />
        <line
          x1={left}
          y1={entry.y}
          x2={left + widthPx}
          y2={entry.y}
          stroke={selected ? '#facc15' : '#787b86'}
          strokeWidth={selected ? width + 1 : width}
        />
        <text
          x={left + 6}
          y={(profitTop + entry.y) / 2 + 4}
          fill="#089981"
          fontSize={11}
          fontWeight={600}
          stroke="none"
        >
          {`目标 ${targetPct >= 0 ? '+' : ''}${targetPct.toFixed(2)}%`}
        </text>
        <text
          x={left + 6}
          y={(lossTop + lossTop + lossHeight) / 2 + 4}
          fill="#f23645"
          fontSize={11}
          fontWeight={600}
          stroke="none"
        >
          {`止损 ${stopPct >= 0 ? '+' : ''}${stopPct.toFixed(2)}%`}
        </text>
        <text
          x={left + widthPx + 6}
          y={entry.y + 4}
          fill={selected ? '#facc15' : '#d1d4dc'}
          fontSize={11}
          fontWeight={600}
          stroke="none"
        >
          {`${isLong ? 'Long' : 'Short'}  ${rr.toFixed(2)} R`}
        </text>
      </>
    );
  } else if (
    type === 'TextAnnotation' ||
    type === 'text-annotation'
  ) {
    geometry = (
      <text
        x={first.x}
        y={first.y}
        fill={stroke}
        fontSize={13}
        stroke="none"
      >
        {drawing.text || '标注'}
      </text>
    );
  } else if (
    type === 'ArrowMarkUp' ||
    type === 'arrow-mark-up' ||
    type === 'ArrowMarkDown' ||
    type === 'arrow-mark-down'
  ) {
    const isUp = type === 'ArrowMarkUp' || type === 'arrow-mark-up';
    geometry = (
      <text
        x={first.x}
        y={first.y}
        fill={isUp ? '#089981' : '#f23645'}
        fontSize={22}
        textAnchor="middle"
        stroke="none"
      >
        {isUp ? '▲' : '▼'}
      </text>
    );
  } else if (type === 'ExtendedLine' || type === 'Ray') {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const factor = 1000;
    const isRay = type === 'Ray';
    geometry = (
      <line
        x1={isRay ? first.x : first.x - dx * factor}
        y1={isRay ? first.y : first.y - dy * factor}
        x2={second.x + dx * factor}
        y2={second.y + dy * factor}
        {...common}
      />
    );
  } else if (type === 'Arrow') {
    const angle = Math.atan2(second.y - first.y, second.x - first.x);
    const arrowSize = 8;
    const left = {
      x: second.x - arrowSize * Math.cos(angle - Math.PI / 6),
      y: second.y - arrowSize * Math.sin(angle - Math.PI / 6),
    };
    const right = {
      x: second.x - arrowSize * Math.cos(angle + Math.PI / 6),
      y: second.y - arrowSize * Math.sin(angle + Math.PI / 6),
    };
    geometry = (
      <>
        <line x1={first.x} y1={first.y} x2={second.x} y2={second.y} {...common} />
        <polyline
          points={`${left.x},${left.y} ${second.x},${second.y} ${right.x},${right.y}`}
          {...common}
        />
      </>
    );
  } else {
    geometry = (
      <polyline
        points={points.map((point) => `${point.x},${point.y}`).join(' ')}
        {...common}
      />
    );
  }

  return (
    <g
      onPointerDown={(event) => onPointerDown(event, drawing)}
      pointerEvents={interactive ? 'all' : 'none'}
      style={{ cursor: drawing.locked ? 'not-allowed' : 'move' }}
    >
      {geometry}
      {selected &&
        points.map((point, index) => (
          <g key={index}>
            <circle
              cx={point.x}
              cy={point.y}
              r={10}
              fill="transparent"
              stroke="transparent"
              onPointerDown={(event) => {
                event.stopPropagation();
                onPointerDown(event, drawing, index);
              }}
              style={{ cursor: drawing.locked ? 'not-allowed' : 'grab' }}
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={4}
              fill="#facc15"
              stroke="#111827"
              strokeWidth={1}
              pointerEvents="none"
            />
          </g>
        ))}
    </g>
  );
});

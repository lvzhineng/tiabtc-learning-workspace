import {
  useEffect,
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import type { Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { timestampMsToUtcTimestamp } from '@/chart/chart-time';
import type {
  ActiveToolType,
  DrawingPoint,
  DrawingToolState,
} from './drawing-types';
import { ANCHOR_COUNTS } from './drawing-types';

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
  onDrawingComplete: () => void;
};

type DragState = {
  drawing: DrawingToolState;
  origin: DrawingPoint;
  preview: DrawingToolState;
  pointIndex: number | null;
};

function timeToTimestampMs(time: Time | null): number | null {
  if (typeof time === 'number') return time * 1000;
  if (typeof time === 'string') {
    const parsed = Date.parse(`${time}T00:00:00Z`);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (time) {
    return Date.UTC(time.year, time.month - 1, time.day);
  }
  return null;
}

function drawingId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `drawing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
  onDrawingComplete,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const candlesRef = useRef(candles);
  const [draftPoints, setDraftPoints] = useState<DrawingPoint[]>([]);
  const [hoverPoint, setHoverPoint] = useState<DrawingPoint | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [viewportRevision, setViewportRevision] = useState(0);
  candlesRef.current = candles;

  useEffect(() => {
    const redraw = () => setViewportRevision((revision) => revision + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);
  }, [chart]);

  useEffect(() => {
    setDraftPoints([]);
    setHoverPoint(null);
  }, [activeTool, symbol, interval]);

  const displayedDrawings = useMemo(
    () =>
      drawings.map((drawing) =>
        drag?.drawing.id === drawing.id ? drag.preview : drawing
      ),
    [drawings, drag]
  );
  const lastCandle = candles[candles.length - 1];
  const coordinateRevision = `${viewportRevision}:${candles.length}:${
    lastCandle?.timestampMs || 0
  }:${lastCandle?.close || 0}`;
  const isFreehandTool =
    activeTool === 'path' || activeTool === 'brush';

  const eventToPoint = useCallback((event: {
    clientX: number;
    clientY: number;
  }): DrawingPoint | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const bounds = svg.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const timestampMs = timeToTimestampMs(
      chart.timeScale().coordinateToTime(x)
    );
    const price = series.coordinateToPrice(y);
    if (timestampMs === null || price === null || !Number.isFinite(price)) {
      return null;
    }

    const currentCandles = candlesRef.current;
    if (!magnetEnabled || currentCandles.length === 0) {
      return { timestampMs, price };
    }

    const nearest = findNearestCandle(currentCandles, timestampMs);
    const prices = [nearest.open, nearest.high, nearest.low, nearest.close];
    const nearestPrice = prices.reduce((best, candidate) =>
      Math.abs(candidate - price) < Math.abs(best - price) ? candidate : best
    );
    return { timestampMs: nearest.timestampMs, price: nearestPrice };
  }, [chart, magnetEnabled, series]);

  const saveNewDrawing = (points: DrawingPoint[]) => {
    const text =
      activeTool === 'text-annotation'
        ? window.prompt('请输入标注文字', '') || ''
        : '';
    const drawing: DrawingToolState = {
      id: drawingId(),
      videoId,
      symbol,
      interval,
      toolType: activeTool,
      points,
      text,
      locked: false,
      color: '#2962ff',
      lineWidth: 2,
      extra: {},
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
      if (draftPoints.length === 0) return;
      const current = eventToPoint(event);
      if (!current) return;
      if (!isFreehandTool) {
        setHoverPoint(current);
        return;
      }
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
    setDrag({
      ...drag,
      preview: {
        ...drag.drawing,
        points: drag.drawing.points.map((point, index) =>
          drag.pointIndex === null
            ? {
                timestampMs: point.timestampMs + deltaTime,
                price: Math.max(Number.EPSILON, point.price + deltaPrice),
              }
            : index === drag.pointIndex
            ? current
            : point
        ),
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

  const toCoordinate = useCallback((point: DrawingPoint) => {
    const x = chart.timeScale().timeToCoordinate(
      timestampMsToUtcTimestamp(point.timestampMs)
    );
    const y = series.priceToCoordinate(point.price);
    return x === null || y === null ? null : { x, y };
  }, [chart, series]);

  const draftCoordinates = draftPoints
    .map(toCoordinate)
    .filter((point): point is { x: number; y: number } => point !== null);
  const previewPoints =
    !isFreehandTool && hoverPoint && draftPoints.length > 0
      ? [...draftPoints, hoverPoint]
      : [];
  const draftPreview: DrawingToolState | null =
    previewPoints.length > 1
      ? {
          id: '__draft-preview__',
          videoId,
          symbol,
          interval,
          toolType: activeTool,
          points: previewPoints,
          color: '#facc15',
          lineWidth: 2,
          locked: true,
          extra: {},
        }
      : null;

  return (
    <svg
      ref={svgRef}
      className="chart-drawing-overlay"
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerInteraction}
      onPointerCancel={finishPointerInteraction}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 4,
        cursor: activeTool === 'select' ? 'default' : 'crosshair',
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
      {displayedDrawings.map((drawing) => (
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
    </svg>
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
  const stroke = selected ? '#facc15' : color;
  const common = {
    fill: 'none',
    stroke,
    strokeWidth: selected ? width + 1 : width,
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
  } else if (type === 'FibRetracement') {
    const levels = [0, 0.382, 0.5, 0.618, 0.66, 1];
    geometry = (
      <>
        {levels.map((level) => {
          const y = first.y + (second.y - first.y) * level;
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
  } else if (
    type === 'Rectangle' ||
    type === 'date-price-range' ||
    type === 'DatePriceRange' ||
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
    geometry = (
      <>
        {points.map((point, index) => (
          <line
            key={index}
            x1={first.x}
            x2={point.x}
            y1={point.y}
            y2={point.y}
            {...common}
            stroke={index === 1 ? '#089981' : index === 2 ? '#f23645' : stroke}
          />
        ))}
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
  } else if (type === 'Ray' || type === 'ExtendedLine') {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const factor = 1000;
    geometry = (
      <line
        x1={type === 'ExtendedLine' ? first.x - dx * factor : first.x}
        y1={type === 'ExtendedLine' ? first.y - dy * factor : first.y}
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
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={4}
            fill="#facc15"
            stroke="#111827"
            strokeWidth={1}
            onPointerDown={(event) => {
              event.stopPropagation();
              onPointerDown(event, drawing, index);
            }}
            style={{ cursor: drawing.locked ? 'not-allowed' : 'grab' }}
          />
        ))}
    </g>
  );
});

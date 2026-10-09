import { useEffect, useId, useMemo, useState } from 'react';
import type { ReviewPosition } from '@/api/position-review-api';
import { buildEquityCurve } from '@/features/position-review/position-stats';
import { formatChartTime } from '@/chart/chart-time';
import { TrendingDown, TrendingUp } from 'lucide-react';

interface Point {
  index: number;
  timeMs: number;
  symbol: string;
  side: 'long' | 'short';
  pnl: number;
  cumulative: number;
  x: number;
  y: number;
}

interface Props {
  currency?: 'USDT' | 'USD';
  positions: ReviewPosition[];
}

const CHART_HEIGHT = 248;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;
const PAD_LEFT = 52;
const PAD_RIGHT = 14;
const PROFIT_COLOR = 'var(--accent-green)';
const LOSS_COLOR = 'var(--accent-red)';

function getSmoothPath(points: Point[]): string {
  if (points.length <= 1) return '';
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
  }
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function downsamplePathPoints(points: Point[], maxPoints = 1200): Point[] {
  if (points.length <= maxPoints) return points;

  const result: Point[] = [points[0]];
  const interiorCount = points.length - 2;
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2));

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = 1 + Math.floor((bucket * interiorCount) / bucketCount);
    const end = 1 + Math.floor(((bucket + 1) * interiorCount) / bucketCount);
    if (start >= end) continue;

    let minIndex = start;
    let maxIndex = start;
    for (let index = start + 1; index < end; index++) {
      if (points[index].y < points[minIndex].y) minIndex = index;
      if (points[index].y > points[maxIndex].y) maxIndex = index;
    }

    if (minIndex === maxIndex) {
      result.push(points[minIndex]);
    } else if (minIndex < maxIndex) {
      result.push(points[minIndex], points[maxIndex]);
    } else {
      result.push(points[maxIndex], points[minIndex]);
    }
  }

  result.push(points[points.length - 1]);
  return result;
}

function formatShortDate(timestampMs: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestampMs)).replace(/\//g, '-');
}

function formatAxisValue(value: number): string {
  const abs = Math.abs(value);
  const text = abs >= 10000 ? `${(abs / 1000).toFixed(0)}k` : abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs.toFixed(0);
  if (Number(text.replace('k', '')) === 0) return '0';
  return `${value < 0 ? '-' : '+'}${text}`;
}

function niceStep(range: number, targetTicks: number): number {
  const rough = range / Math.max(1, targetTicks);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const nice = residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1;
  return nice * magnitude;
}

export function EquityCurveChart({ positions, currency = 'USDT' }: Props) {
  const gradientId = useId().replace(/:/g, '');
  const [canvasElement, setCanvasElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hoveredPoint, setHoveredPoint] = useState<Point | null>(null);

  useEffect(() => {
    if (!canvasElement) return;
    const update = () => setWidth(Math.round(canvasElement.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvasElement);
    return () => observer.disconnect();
  }, [canvasElement]);

  const equity = useMemo(() => buildEquityCurve(positions), [positions]);

  const geometry = useMemo(() => {
    if (equity.points.length === 0 || width <= 0) return null;

    const series = [
      { timeMs: equity.points[0].timeMs - 3600000, symbol: '', side: 'long' as const, pnl: 0, cumulative: 0 },
      ...equity.points,
    ];

    let rawMin = 0;
    let rawMax = 0;
    for (const item of series) {
      if (item.cumulative < rawMin) rawMin = item.cumulative;
      if (item.cumulative > rawMax) rawMax = item.cumulative;
    }
    if (rawMax === rawMin) {
      rawMax += 10;
      rawMin -= 10;
    }
    const step = niceStep(rawMax - rawMin, 4);
    const minVal = Math.floor(rawMin / step) * step;
    const maxVal = Math.ceil(rawMax / step) * step;
    const valRange = maxVal - minVal || 1;
    const plotWidth = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
    const plotHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
    const toY = (value: number) => PAD_TOP + (1 - (value - minVal) / valRange) * plotHeight;

    const points: Point[] = series.map((item, index) => ({
      index,
      timeMs: item.timeMs,
      symbol: item.symbol,
      side: item.side,
      pnl: item.pnl,
      cumulative: item.cumulative,
      x: PAD_LEFT + (index / Math.max(1, series.length - 1)) * plotWidth,
      y: toY(item.cumulative),
    }));

    const ticks: Array<{ value: number; y: number }> = [];
    for (let value = minVal; value <= maxVal + step / 2; value += step) {
      ticks.push({ value, y: toY(value) });
    }

    const zeroY = toY(0);
    const pathPoints = downsamplePathPoints(points);
    const linePath = getSmoothPath(pathPoints);
    const firstX = pathPoints[0].x;
    const lastX = pathPoints[pathPoints.length - 1].x;
    const zeroOffset = Math.min(1, Math.max(0, (zeroY - PAD_TOP) / plotHeight));

    const labelCount = Math.max(2, Math.min(6, Math.floor(plotWidth / 110)));
    const xLabels: Point[] = [];
    for (let i = 0; i < labelCount; i++) {
      const index = 1 + Math.round((i / (labelCount - 1)) * (points.length - 2));
      const point = points[Math.min(points.length - 1, Math.max(1, index))];
      if (!xLabels.some((item) => item.index === point.index)) xLabels.push(point);
    }

    return {
      points,
      ticks,
      zeroY,
      zeroOffset,
      linePath,
      areaPath: `${linePath} L ${lastX.toFixed(1)} ${zeroY.toFixed(1)} L ${firstX.toFixed(1)} ${zeroY.toFixed(1)} Z`,
      xLabels,
      plotWidth,
    };
  }, [equity, width]);

  if (equity.points.length === 0) {
    return (
      <div className="posdash-empty-state">
        <TrendingUp size={28} />
        <span>暂无足够交易数据绘制收益曲线</span>
      </div>
    );
  }

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!geometry) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const { points, plotWidth } = geometry;
    const pointIndex = Math.max(
      1,
      Math.min(points.length - 1, Math.round(((mouseX - PAD_LEFT) / plotWidth) * (points.length - 1)))
    );
    const nextPoint = points[pointIndex];
    setHoveredPoint((current) => (current?.index === nextPoint.index ? current : nextPoint));
  };

  const activePoint =
    hoveredPoint && geometry ? geometry.points[hoveredPoint.index] ?? null : null;
  const lastPoint = geometry?.points[geometry.points.length - 1];

  return (
    <div className="posdash-chart-wrap">
      <div className="posdash-chart-canvas" ref={setCanvasElement} style={{ height: CHART_HEIGHT }}>
        {geometry && (
          <svg
            className="posdash-svg-chart"
            width={width}
            height={CHART_HEIGHT}
            viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoveredPoint(null)}
          >
            <defs>
              <linearGradient
                id={`${gradientId}-stroke`}
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1={PAD_TOP}
                x2="0"
                y2={CHART_HEIGHT - PAD_BOTTOM}
              >
                <stop offset={geometry.zeroOffset} stopColor={PROFIT_COLOR} />
                <stop offset={geometry.zeroOffset} stopColor={LOSS_COLOR} />
              </linearGradient>
              <linearGradient
                id={`${gradientId}-fill`}
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1={PAD_TOP}
                x2="0"
                y2={CHART_HEIGHT - PAD_BOTTOM}
              >
                <stop offset="0" stopColor={PROFIT_COLOR} stopOpacity="0.24" />
                <stop offset={geometry.zeroOffset} stopColor={PROFIT_COLOR} stopOpacity="0.02" />
                <stop offset={geometry.zeroOffset} stopColor={LOSS_COLOR} stopOpacity="0.02" />
                <stop offset="1" stopColor={LOSS_COLOR} stopOpacity="0.24" />
              </linearGradient>
            </defs>

            {geometry.ticks.map((tick) => (
              <g key={tick.value}>
                <line
                  className="posdash-chart-grid"
                  x1={PAD_LEFT}
                  y1={tick.y}
                  x2={width - PAD_RIGHT}
                  y2={tick.y}
                />
                <text className="posdash-chart-axis" x={PAD_LEFT - 8} y={tick.y + 3.5} textAnchor="end">
                  {formatAxisValue(tick.value)}
                </text>
              </g>
            ))}

            <line
              className="posdash-chart-zero"
              x1={PAD_LEFT}
              y1={geometry.zeroY}
              x2={width - PAD_RIGHT}
              y2={geometry.zeroY}
            />

            <path d={geometry.areaPath} fill={`url(#${gradientId}-fill)`} />
            <path
              d={geometry.linePath}
              fill="none"
              stroke={`url(#${gradientId}-stroke)`}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {geometry.xLabels.map((point, index) => (
              <text
                key={point.index}
                className="posdash-chart-axis"
                x={point.x}
                y={CHART_HEIGHT - 8}
                textAnchor={index === 0 ? 'start' : index === geometry.xLabels.length - 1 ? 'end' : 'middle'}
              >
                {formatShortDate(point.timeMs)}
              </text>
            ))}

            {lastPoint && !activePoint && (
              <circle
                cx={lastPoint.x}
                cy={lastPoint.y}
                r="3.5"
                fill={lastPoint.cumulative >= 0 ? PROFIT_COLOR : LOSS_COLOR}
                stroke="var(--bg-dark-800)"
                strokeWidth="2"
              />
            )}

            {activePoint && (
              <g>
                <line
                  className="posdash-chart-crosshair"
                  x1={activePoint.x}
                  y1={PAD_TOP}
                  x2={activePoint.x}
                  y2={CHART_HEIGHT - PAD_BOTTOM}
                />
                <circle
                  cx={activePoint.x}
                  cy={activePoint.y}
                  r="8"
                  fill={activePoint.cumulative >= 0 ? PROFIT_COLOR : LOSS_COLOR}
                  opacity="0.18"
                />
                <circle
                  cx={activePoint.x}
                  cy={activePoint.y}
                  r="4"
                  fill={activePoint.cumulative >= 0 ? PROFIT_COLOR : LOSS_COLOR}
                  stroke="var(--bg-dark-800)"
                  strokeWidth="2"
                />
              </g>
            )}
          </svg>
        )}

        {activePoint && geometry && (
          <div
            className="posdash-chart-tooltip"
            style={{
              left: activePoint.x,
              top: activePoint.y,
              transform: `translate(${
                activePoint.x < width * 0.25 ? '12px' : activePoint.x > width * 0.75 ? 'calc(-100% - 12px)' : '-50%'
              }, ${activePoint.y < CHART_HEIGHT * 0.45 ? '14px' : 'calc(-100% - 14px)'})`,
            }}
          >
            <div className="posdash-tooltip-header">
              <span className={`posrev-side-badge ${activePoint.side}`}>
                {activePoint.symbol} · {activePoint.side === 'long' ? '多' : '空'}
              </span>
              <span className="posdash-tooltip-time">{formatChartTime(activePoint.timeMs)}</span>
            </div>
            <div className="posdash-tooltip-row">
              <span className="posdash-tooltip-label">单笔净盈亏</span>
              <span className={`posdash-tooltip-value ${activePoint.pnl >= 0 ? 'profit' : 'loss'}`}>
                {activePoint.pnl >= 0 ? '+' : ''}
                {activePoint.pnl.toFixed(2)} {currency}
              </span>
            </div>
            <div className="posdash-tooltip-row">
              <span className="posdash-tooltip-label">累计净值</span>
              <span className={`posdash-tooltip-value ${activePoint.cumulative >= 0 ? 'profit' : 'loss'}`}>
                {activePoint.cumulative >= 0 ? '+' : ''}
                {activePoint.cumulative.toFixed(2)} {currency}
              </span>
            </div>
            <div className="posdash-tooltip-row">
              <span className="posdash-tooltip-label">序号</span>
              <span className="posdash-tooltip-value">#{activePoint.index}</span>
            </div>
          </div>
        )}
      </div>

      <div className="posdash-chart-summary">
        <div className="posdash-summary-item">
          <span className="posdash-summary-label" title="累计净值序列的最高点">
            历史最高 (ATH)
          </span>
          <span className={`posdash-summary-val ${equity.peak > 0 ? 'profit' : 'neutral'}`}>
            <TrendingUp size={13} />
            {equity.peak >= 0 ? '+' : ''}
            {equity.peak.toFixed(2)}
          </span>
        </div>

        <div className="posdash-summary-item">
          <span className="posdash-summary-label" title="同一累计净值序列上，历史峰值到其后低点的最大回落">
            最大回撤
          </span>
          <span className="posdash-summary-val loss">
            <TrendingDown size={13} />-{equity.maxDrawdown.toFixed(2)}
          </span>
        </div>

        <div className="posdash-summary-item">
          <span className="posdash-summary-label" title="已平仓净盈亏累计，等于收益曲线终点">
            当前净值
          </span>
          <span className={`posdash-summary-val ${equity.totalPnl >= 0 ? 'profit' : 'loss'}`}>
            {equity.totalPnl >= 0 ? '+' : ''}
            {equity.totalPnl.toFixed(2)}
          </span>
        </div>

        <div className="posdash-summary-item">
          <span className="posdash-summary-label">样本</span>
          <span className="posdash-summary-val neutral">{equity.closed.length} 笔</span>
        </div>
      </div>
    </div>
  );
}

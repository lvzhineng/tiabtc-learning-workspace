import { useMemo, useState } from 'react';
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
  positions: ReviewPosition[];
}

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
  const d = new Date(timestampMs);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d).replace(/\//g, '-');
}

export function EquityCurveChart({ positions }: Props) {
  const [hoveredPoint, setHoveredPoint] = useState<Point | null>(null);

  const { points, maxAth, maxDrawdown, totalPnl, sampleCount, minVal, maxVal, yTicks } = useMemo(() => {
    const equity = buildEquityCurve(positions);
    if (equity.points.length === 0) {
      return {
        points: [],
        maxAth: 0,
        maxDrawdown: 0,
        totalPnl: 0,
        sampleCount: 0,
        minVal: 0,
        maxVal: 0,
        yTicks: [],
      };
    }

    const firstTime = equity.points[0].timeMs - 3600000;
    const dataSeries = [
      {
        timeMs: firstTime,
        symbol: '',
        side: 'long' as const,
        pnl: 0,
        cumulative: 0,
      },
      ...equity.points,
    ];

    // Map to SVG coordinates (width: 600, height: 210, padding: 30 left/right, 24 top, 28 bottom)
    const svgWidth = 600;
    const svgHeight = 210;
    const padTop = 22;
    const padBottom = 32;
    const padLeft = 45;
    const padRight = 20;

    let computedMin = 0;
    let computedMax = 0;
    for (const d of dataSeries) {
      if (d.cumulative < computedMin) computedMin = d.cumulative;
      if (d.cumulative > computedMax) computedMax = d.cumulative;
    }
    if (computedMax === computedMin) {
      computedMax += 10;
      computedMin -= 10;
    }
    // Add 10% breathing room
    const paddingVal = (computedMax - computedMin) * 0.08;
    computedMax += paddingVal;
    computedMin -= paddingVal;

    const valRange = computedMax - computedMin || 1;

    const mappedPoints: Point[] = dataSeries.map((d, i) => {
      const x =
        padLeft +
        (i / Math.max(1, dataSeries.length - 1)) * (svgWidth - padLeft - padRight);
      const normalizedY = (d.cumulative - computedMin) / valRange;
      const y =
        svgHeight - padBottom - normalizedY * (svgHeight - padTop - padBottom);
      return {
        index: i,
        timeMs: d.timeMs,
        symbol: d.symbol,
        side: d.side,
        pnl: d.pnl,
        cumulative: d.cumulative,
        x,
        y,
      };
    });

    // Generate 4 Y-ticks
    const ticks: Array<{ val: number; y: number }> = [];
    const tickSteps = 3;
    for (let step = 0; step <= tickSteps; step++) {
      const v = computedMin + (step / tickSteps) * valRange;
      const y = svgHeight - padBottom - (step / tickSteps) * (svgHeight - padTop - padBottom);
      ticks.push({ val: v, y });
    }

    return {
      points: mappedPoints,
      maxAth: equity.peak,
      maxDrawdown: equity.maxDrawdown,
      totalPnl: equity.totalPnl,
      sampleCount: equity.closed.length,
      minVal: computedMin,
      maxVal: computedMax,
      yTicks: ticks,
    };
  }, [positions]);

  const pathGeometry = useMemo(() => {
    if (points.length <= 1) {
      return { linePath: '', areaPath: '', zeroY: 0 };
    }
    const valRange = maxVal - minVal || 1;
    const zeroY = 210 - 32 - ((0 - minVal) / valRange) * (210 - 22 - 32);
    const pathPoints = downsamplePathPoints(points);
    const linePath = getSmoothPath(pathPoints);
    const firstX = pathPoints[0].x;
    const lastX = pathPoints[pathPoints.length - 1].x;
    return {
      linePath,
      areaPath: `${linePath} L ${lastX.toFixed(1)} ${zeroY.toFixed(1)} L ${firstX.toFixed(1)} ${zeroY.toFixed(1)} Z`,
      zeroY,
    };
  }, [maxVal, minVal, points]);

  if (points.length <= 1) {
    return (
      <div className="posdash-empty-state">
        <TrendingUp size={28} />
        <span>暂无足够交易数据绘制收益曲线</span>
      </div>
    );
  }

  const { areaPath, linePath, zeroY } = pathGeometry;

  // 现代科技电光青蓝 (Cyber Blue-Cyan) 配色
  const strokeColor = '#0ea5e9';
  const fillColor = 'url(#cyberCyanGrad)';

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * 600;

    const pointIndex = Math.max(
      0,
      Math.min(
        points.length - 1,
        Math.round(((mouseX - 45) / (580 - 45)) * (points.length - 1))
      )
    );
    const nextPoint = points[pointIndex];
    setHoveredPoint((current) =>
      current?.index === nextPoint.index ? current : nextPoint
    );
  };

  // 3 Key time points for X-axis
  const startPoint = points[1] || points[0];
  const midPoint = points[Math.floor(points.length / 2)];
  const endPoint = points[points.length - 1];

  return (
    <div className="posdash-chart-wrap">
      <svg
        className="posdash-svg-chart"
        viewBox="0 0 600 210"
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredPoint(null)}
      >
        <defs>
          {/* 电光青蓝通透云雾渐变 */}
          <linearGradient id="cyberCyanGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.22" />
            <stop offset="45%" stopColor="#38bdf8" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#0284c7" stopOpacity="0.0" />
          </linearGradient>
          {/* 电光科技微光阴影 */}
          <filter id="cyberGlow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow
              dx="0"
              dy="3"
              stdDeviation="3.5"
              floodColor="#0ea5e9"
              floodOpacity="0.38"
            />
          </filter>
        </defs>

        {/* 背景轻量水平网格线与 Y 轴刻度 */}
        {yTicks.map((t, idx) => (
          <g key={idx}>
            <line
              x1="45"
              y1={t.y}
              x2="580"
              y2={t.y}
              stroke="var(--border-color, rgba(128,128,128,0.12))"
              strokeDasharray="3 3"
              strokeWidth="0.8"
              opacity="0.6"
            />
            <text
              x="40"
              y={t.y + 3.5}
              textAnchor="end"
              fontSize="9.5"
              fill="var(--text-muted, #888)"
              fontFamily="var(--font-mono, monospace)"
            >
              {t.val >= 0 ? `+${t.val.toFixed(0)}` : t.val.toFixed(0)}
            </text>
          </g>
        ))}

        {/* 零轴基准线 (加深) */}
        <line
          x1="45"
          y1={zeroY}
          x2="580"
          y2={zeroY}
          stroke="var(--text-muted, rgba(128,128,128,0.4))"
          strokeDasharray="4 4"
          strokeWidth="1.2"
          opacity="0.75"
        />

        {/* 渐变面积 */}
        <path d={areaPath} fill={fillColor} />

        {/* 电光青蓝丝滑平滑曲线 */}
        <path
          d={linePath}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#cyberGlow)"
        />

        {/* X 轴时间刻度文字 */}
        {startPoint && (
          <text
            x={startPoint.x}
            y="202"
            fontSize="9.5"
            fill="var(--text-muted, #888)"
            textAnchor="start"
          >
            {formatShortDate(startPoint.timeMs)}
          </text>
        )}
        {midPoint && points.length > 3 && (
          <text
            x={midPoint.x}
            y="202"
            fontSize="9.5"
            fill="var(--text-muted, #888)"
            textAnchor="middle"
          >
            {formatShortDate(midPoint.timeMs)}
          </text>
        )}
        {endPoint && (
          <text
            x={endPoint.x}
            y="202"
            fontSize="9.5"
            fill="var(--text-muted, #888)"
            textAnchor="end"
          >
            {formatShortDate(endPoint.timeMs)}
          </text>
        )}

        {/* 鼠标悬浮指示 */}
        {hoveredPoint && hoveredPoint.index > 0 && (
          <g>
            <line
              x1={hoveredPoint.x}
              y1="20"
              x2={hoveredPoint.x}
              y2="180"
              stroke="#0ea5e9"
              strokeDasharray="3 3"
              strokeWidth="1.2"
              opacity="0.6"
            />
            {/* 发光外圈 */}
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.y}
              r="7"
              fill="#0ea5e9"
              opacity="0.25"
            />
            {/* 实体核心点 */}
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.y}
              r="4"
              fill="#0ea5e9"
              stroke="var(--bg-dark-800, #ffffff)"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>

      {/* Tooltip 悬浮卡片 */}
      {hoveredPoint && hoveredPoint.index > 0 && (
        <div
          className="posdash-chart-tooltip"
          style={{
            left: `${(hoveredPoint.x / 600) * 100}%`,
            top: `${(hoveredPoint.y / 210) * 100}%`,
            transform: `translate(${
              hoveredPoint.x < 150
                ? '0%'
                : hoveredPoint.x > 450
                ? '-100%'
                : '-50%'
            }, ${hoveredPoint.y < 90 ? '14px' : 'calc(-100% - 12px)'})`,
          }}
        >
          <div className="posdash-tooltip-header">
            <span
              className={`posrev-side-badge ${hoveredPoint.side}`}
              style={{ fontSize: 11, padding: '2px 7px', fontWeight: 600 }}
            >
              {hoveredPoint.symbol} · {hoveredPoint.side === 'long' ? '多头' : '空头'}
            </span>
            <span className="posdash-tooltip-time">
              {formatChartTime(hoveredPoint.timeMs)}
            </span>
          </div>

          <div className="posdash-tooltip-row">
            <span className="posdash-tooltip-label">单笔净盈亏</span>
            <span
              className={`posdash-tooltip-value ${
                hoveredPoint.pnl >= 0 ? 'profit' : 'loss'
              }`}
            >
              {hoveredPoint.pnl >= 0 ? '+' : ''}
              {hoveredPoint.pnl.toFixed(2)} USDT
            </span>
          </div>

          <div className="posdash-tooltip-row">
            <span className="posdash-tooltip-label">累计净值</span>
            <span
              className={`posdash-tooltip-value ${
                hoveredPoint.cumulative >= 0 ? 'profit' : 'loss'
              }`}
            >
              {hoveredPoint.cumulative >= 0 ? '+' : ''}
              {hoveredPoint.cumulative.toFixed(2)} USDT
            </span>
          </div>
        </div>
      )}

      {/* 底部摘要栏 */}
      <div className="posdash-chart-summary">
        <div className="posdash-summary-item">
          <span className="posdash-summary-label" title="累计净值序列的最高点">
            历史最高净值 (ATH)
          </span>
          <span className="posdash-summary-val cyan-accent">
            <TrendingUp size={13} />
            {maxAth >= 0 ? '+' : ''}
            {maxAth.toFixed(2)} USDT
          </span>
        </div>

        <div className="posdash-summary-item">
          <span
            className="posdash-summary-label"
            title="同一累计净值序列上，历史峰值到其后低点的最大回落"
          >
            最大回撤 (Max DD)
          </span>
          <span className="posdash-summary-val loss">
            <TrendingDown size={13} />
            -{maxDrawdown.toFixed(2)} USDT
          </span>
        </div>

        <div className="posdash-summary-item">
          <span className="posdash-summary-label" title="已平仓净盈亏累计，等于收益曲线终点">
            当前净值
          </span>
          <span className={`posdash-summary-val ${totalPnl >= 0 ? 'cyan-accent' : 'loss'}`}>
            {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} USDT
          </span>
        </div>

        <div className="posdash-summary-item">
          <span className="posdash-summary-label">总样本</span>
          <span className="posdash-summary-val neutral">
            {sampleCount} 笔交易
          </span>
        </div>
      </div>
    </div>
  );
}

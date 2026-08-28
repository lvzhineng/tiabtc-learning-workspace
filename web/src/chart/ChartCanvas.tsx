import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  PriceScaleMode,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type SeriesMarker,
  type UTCTimestamp,
  type Time,
  type WhitespaceData,
} from 'lightweight-charts';
import type { Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { TIMEFRAME_SECONDS_MAP } from '@/domain/timeframe';
import {
  shouldLoadEarlierByLogicalRange,
  shouldLoadLaterByLogicalRange,
} from './chart-autoload';
import {
  formatChartTickTime,
  formatChartTime,
  coordinateToChartTimestampMs,
  timestampMsToUtcTimestamp,
  utcTimestampToTimestampMs,
} from './chart-time';
import type {
  ActiveToolType,
  DrawingToolState,
} from '@/features/drawings/drawing-types';
import { ChartDrawingOverlay } from '@/features/drawings/ChartDrawingOverlay';
import { UsSessionBandsOverlay } from '@/chart/UsSessionBandsOverlay';

interface ChartCanvasProps {
  candles: Candlestick[];
  symbol: string;
  interval: ReviewTimeframe;
  isLogScale?: boolean;
  themeMode?: 'dark' | 'light';
  focusTimeMs?: number | null;
  focusRangeMs?: { from: number; to: number } | null;
  focusRevision?: number;
  systemMarkers?: SeriesMarker<UTCTimestamp>[];
  onCrosshairMove?: (candle: Candlestick | null) => void;
  onDoubleClickTime?: (timestampMs: number) => void;
  onViewportAnchorChange?: (timestampMs: number) => void;
  onLoadEarlier?: () => void;
  isLoadingEarlier?: boolean;
  onLoadLater?: () => void;

  isLoadingLater?: boolean;
  drawings?: DrawingToolState[];
  activeDrawingTool?: ActiveToolType;
  selectedDrawingId?: string | null;
  magnetEnabled?: boolean;
  drawingVideoId?: string;
  onSelectDrawing?: (id: string | null) => void;
  onSaveDrawing?: (drawing: DrawingToolState) => void | Promise<void>;
  onDeleteDrawing?: (id: string) => void;
  onToggleLockDrawing?: (id: string) => void;
  onDrawingComplete?: () => void;
  showVolume?: boolean;
  showOiCvd?: boolean;
  oiPoints?: { timestampMs: number; value: number }[];
  cvdPoints?: { timestampMs: number; value: number }[];
  /** Soft vertical bands for US regular session (NYSE 09:30–16:00). */
  showUsSessionBands?: boolean;
  /** Warm vertical bands for the weekend in America/New_York. */
  showWeekendBands?: boolean;
}

function findNearestCandleIndex(
  candles: Candlestick[],
  targetTimeMs: number
): number {
  if (candles.length === 0) return -1;
  let low = 0;
  let high = candles.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].timestampMs < targetTimeMs) low = middle + 1;
    else high = middle;
  }
  const right = candles[low];
  const left = low > 0 ? candles[low - 1] : null;
  return left &&
    Math.abs(left.timestampMs - targetTimeMs) <=
      Math.abs(right.timestampMs - targetTimeMs)
    ? low - 1
    : low;
}

function findNearestCandle(
  candles: Candlestick[],
  targetTimeMs: number
): Candlestick | null {
  const index = findNearestCandleIndex(candles, targetTimeMs);
  return index >= 0 ? candles[index] : null;
}

function candlesEqual(
  left: Candlestick | undefined,
  right: Candlestick | undefined
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.timestampMs === right.timestampMs &&
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close &&
    left.volume === right.volume
  );
}
/** Place the focus bar near 80% of the viewport, leaving ~20% room on the right. */
const FOCUS_VIEWPORT_RATIO = 0.8;
const PRICE_SCALE_MIN_WIDTH = 72;
const FLOW_PANE_HEIGHT = 90;
const FLOW_CVD_PANE_HEIGHT = 114;

type FlowPoint = { timestampMs: number; value: number };

function clampVisibleSpan(span: number): number {
  if (!Number.isFinite(span) || span < 10) return 120;
  return Math.min(200, Math.max(30, span));
}

function logicalRangeForFocus(
  focusIndex: number,
  visibleSpan: number,
  anchorRatio = FOCUS_VIEWPORT_RATIO
): { from: number; to: number } {
  const span = clampVisibleSpan(visibleSpan);
  const ratio = Math.min(0.95, Math.max(0.5, anchorRatio));
  return {
    from: focusIndex - span * ratio,
    to: focusIndex + span * (1 - ratio),
  };
}

function chartThemeColors(themeMode: 'dark' | 'light') {
  const isLight = themeMode === 'light';
  return {
    background: isLight ? '#ffffff' : '#0c0f14',
    text: isLight ? '#475569' : '#8b92a8',
    grid: isLight ? '#e4e9f2' : '#1c2230',
    border: isLight ? '#d5dbe8' : '#2a3142',
    crosshair: '#8b92a8',
  };
}

function applyVolumeScaleMargins(
  chart: IChartApi,
  candleSeries: ISeriesApi<'Candlestick'>,
  hasVolume: boolean
) {
  if (!hasVolume) return;
  candleSeries.priceScale().applyOptions({
    scaleMargins: { top: 0.08, bottom: 0.25 },
  });
  chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.78, bottom: 0 },
  });
}

function alignFlowToCandles(
  candles: Candlestick[],
  points: FlowPoint[]
): (LineData | WhitespaceData)[] {
  if (candles.length === 0) return [];
  const byTimestamp = new Map<number, number>();
  for (const point of points) {
    byTimestamp.set(point.timestampMs, point.value);
  }
  const data: (LineData | WhitespaceData)[] = [];
  let lastValue: number | undefined;
  for (const candle of candles) {
    const exact = byTimestamp.get(candle.timestampMs);
    if (exact !== undefined) lastValue = exact;
    const time = timestampMsToUtcTimestamp(candle.timestampMs);
    if (lastValue === undefined) data.push({ time });
    else data.push({ time, value: lastValue });
  }
  return data;
}

function flowValueAtOrBefore(
  points: FlowPoint[],
  timestampMs: number
): number | null {
  if (points.length === 0) return null;
  let low = 0;
  let high = points.length - 1;
  let found: number | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const current = points[middle].timestampMs;
    if (current === timestampMs) return points[middle].value;
    if (current < timestampMs) {
      found = points[middle].value;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function createFlowPaneChart(
  container: HTMLDivElement,
  themeMode: 'dark' | 'light',
  color: string,
  showTimeScale: boolean,
  intervalRef: { current: ReviewTimeframe }
) {
  const theme = chartThemeColors(themeMode);
  const chart = createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      background: {
        type: ColorType.Solid,
        color: theme.background,
      },
      textColor: theme.text,
    },
    localization: {
      locale: 'zh-CN',
      timeFormatter: (time: Time) =>
        formatChartTime(utcTimestampToTimestampMs(time), intervalRef.current),
    },
    grid: {
      vertLines: { color: theme.grid },
      horzLines: { color: theme.grid },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: {
        color: theme.crosshair,
        width: 1,
        style: 3,
      },
      horzLine: {
        color: theme.crosshair,
        width: 1,
        style: 3,
      },
    },
    rightPriceScale: {
      borderColor: theme.border,
      minimumWidth: PRICE_SCALE_MIN_WIDTH,
      scaleMargins: { top: 0.16, bottom: 0.12 },
    },
    timeScale: {
      borderColor: theme.border,
      visible: showTimeScale,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 0,
      barSpacing: 6,
      shiftVisibleRangeOnNewBar: false,
      tickMarkFormatter: (time: Time) =>
        formatChartTickTime(
          utcTimestampToTimestampMs(time),
          intervalRef.current
        ),
    },
  });
  const series = chart.addLineSeries({
    color,
    lineWidth: 2 as const,
    priceLineVisible: false,
    lastValueVisible: true,
    crosshairMarkerVisible: true,
    priceFormat: { type: 'volume', precision: 0, minMove: 1 },
  });
  return { chart, series };
}

export function ChartCanvas({
  candles,
  symbol,
  interval,
  isLogScale = false,
  themeMode = 'dark',
  focusTimeMs = null,
  focusRangeMs = null,
  focusRevision = 0,
  systemMarkers = [],
  onCrosshairMove,
  onDoubleClickTime,
  onViewportAnchorChange,
  onLoadEarlier,
  isLoadingEarlier = false,
  onLoadLater,
  isLoadingLater = false,
  drawings = [],
  activeDrawingTool = 'select',
  selectedDrawingId = null,
  magnetEnabled = false,
  drawingVideoId = '__global__',
  onSelectDrawing = () => {},
  onSaveDrawing = () => {},
  onDeleteDrawing,
  onToggleLockDrawing,
  onDrawingComplete = () => {},
  showVolume = false,
  showOiCvd = false,
  oiPoints = [],
  cvdPoints = [],
  showUsSessionBands = false,
  showWeekendBands = false,
}: ChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const oiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const cvdSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const prevBarsCountRef = useRef<number>(0);
  const prevFirstTimestampRef = useRef<number | null>(null);
  const prevLastTimestampRef = useRef<number | null>(null);
  const prevCandlesRef = useRef<Candlestick[]>([]);
  const prevSeriesKeyRef = useRef<string>('');
  const pendingViewportResetRef = useRef(false);
  const lastVisibleSpanRef = useRef(120);
  const isFetchingEarlierRef = useRef<boolean>(isLoadingEarlier);
  const isFetchingLaterRef = useRef<boolean>(isLoadingLater);
  const candlesRef = useRef<Candlestick[]>(candles);
  const onCrosshairMoveRef = useRef(onCrosshairMove);
  const onLoadEarlierRef = useRef(onLoadEarlier);
  const onLoadLaterRef = useRef(onLoadLater);
  const onSelectDrawingRef = useRef(onSelectDrawing);
  const onDoubleClickTimeRef = useRef(onDoubleClickTime);
  const onViewportAnchorChangeRef = useRef(onViewportAnchorChange);
  const activeDrawingToolRef = useRef(activeDrawingTool);
  const selectedDrawingIdRef = useRef(selectedDrawingId);
  const intervalRef = useRef(interval);
  const lastAppliedFocusKeyRef = useRef<string | null>(null);
  const lastNotifiedViewportAnchorRef = useRef<number | null>(null);
  const focusTimeMsRef = useRef(focusTimeMs);
  const focusRangeMsRef = useRef(focusRangeMs);
  const oiContainerRef = useRef<HTMLDivElement>(null);
  const cvdContainerRef = useRef<HTMLDivElement>(null);
  const oiChartRef = useRef<IChartApi | null>(null);
  const cvdChartRef = useRef<IChartApi | null>(null);
  const flowSyncingRef = useRef(false);
  const oiPointsRef = useRef(oiPoints);
  const cvdPointsRef = useRef(cvdPoints);
  const [chartReady, setChartReady] = useState(false);

  oiPointsRef.current = oiPoints;
  cvdPointsRef.current = cvdPoints;

  useEffect(() => {
    isFetchingEarlierRef.current = isLoadingEarlier;
  }, [isLoadingEarlier]);

  focusTimeMsRef.current = focusTimeMs;
  focusRangeMsRef.current = focusRangeMs;

  useEffect(() => {
    isFetchingLaterRef.current = isLoadingLater;
  }, [isLoadingLater]);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  useEffect(() => {
    onCrosshairMoveRef.current = onCrosshairMove;
  }, [onCrosshairMove]);

  useEffect(() => {
    onLoadEarlierRef.current = onLoadEarlier;
  }, [onLoadEarlier]);

  useEffect(() => {
    onLoadLaterRef.current = onLoadLater;
  }, [onLoadLater]);

  useEffect(() => {
    onSelectDrawingRef.current = onSelectDrawing;
  }, [onSelectDrawing]);

  useEffect(() => {
    onDoubleClickTimeRef.current = onDoubleClickTime;
  }, [onDoubleClickTime]);

  useEffect(() => {
    onViewportAnchorChangeRef.current = onViewportAnchorChange;
  }, [onViewportAnchorChange]);

  useEffect(() => {
    activeDrawingToolRef.current = activeDrawingTool;
    selectedDrawingIdRef.current = selectedDrawingId;
  }, [activeDrawingTool, selectedDrawingId]);

  useEffect(() => {
    intervalRef.current = interval;
  }, [interval]);

  // Chart initialization & lifecycle
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const theme = chartThemeColors(themeMode);
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: {
          type: ColorType.Solid,
          color: theme.background,
        },
        textColor: theme.text,
      },
      localization: {
        locale: 'zh-CN',
        timeFormatter: (time: Time) =>
          formatChartTime(
            utcTimestampToTimestampMs(time),
            intervalRef.current
          ),
      },
      grid: {
        vertLines: { color: theme.grid },
        horzLines: { color: theme.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: theme.crosshair,
          width: 1,
          style: 3, // dashed
        },
        horzLine: {
          color: theme.crosshair,
          width: 1,
          style: 3,
        },
      },
      rightPriceScale: {
        borderColor: theme.border,
        mode: isLogScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        autoScale: true,
        minimumWidth: PRICE_SCALE_MIN_WIDTH,
      },
      timeScale: {
        borderColor: theme.border,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time) =>
          formatChartTickTime(
            utcTimestampToTimestampMs(time),
            intervalRef.current
          ),
        // Padding is controlled by logicalRangeForFocus (~20% right of the
        // focus/live tip). A fixed rightOffset would push the 80% anchor left.
        rightOffset: 0,
        barSpacing: 6,
        shiftVisibleRangeOnNewBar: false,
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: '#089981',
      downColor: '#f23645',
      borderUpColor: '#089981',
      borderDownColor: '#f23645',
      wickUpColor: '#089981',
      wickDownColor: '#f23645',
    });
    const volumeSeries = showVolume
      ? chart.addHistogramSeries({
          priceFormat: { type: 'volume' },
          priceScaleId: 'volume',
          priceLineVisible: false,
          lastValueVisible: false,
        })
      : null;

    if (volumeSeries) {
      series.priceScale().applyOptions({
        scaleMargins: { top: 0.08, bottom: 0.25 },
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
      });
    }

    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;
    setChartReady(true);

    // Crosshair listener
    chart.subscribeCrosshairMove((param) => {
      const notifyCrosshairMove = onCrosshairMoveRef.current;
      const timeVal = param?.time;
      if (
        !param ||
        !timeVal ||
        param.point === undefined ||
        param.point.x < 0 ||
        param.point.x > container.clientWidth ||
        param.point.y < 0 ||
        param.point.y > container.clientHeight
      ) {
        notifyCrosshairMove?.(null);
        oiChartRef.current?.clearCrosshairPosition();
        cvdChartRef.current?.clearCrosshairPosition();
        return;
      }

      const timeMs = typeof timeVal === 'number' ? timeVal * 1000 : 0;
      const found = findNearestCandle(candlesRef.current, timeMs);
      notifyCrosshairMove?.(
        found && Math.abs(found.timestampMs - timeMs) < 1000 ? found : null
      );

      const oiSeries = oiSeriesRef.current;
      const oiChart = oiChartRef.current;
      const oiValue = flowValueAtOrBefore(oiPointsRef.current, timeMs);
      if (oiChart && oiSeries && oiValue != null) {
        oiChart.setCrosshairPosition(oiValue, timeVal, oiSeries);
      }
      const cvdSeries = cvdSeriesRef.current;
      const cvdChart = cvdChartRef.current;
      const cvdValue = flowValueAtOrBefore(cvdPointsRef.current, timeMs);
      if (cvdChart && cvdSeries && cvdValue != null) {
        cvdChart.setCrosshairPosition(cvdValue, timeVal, cvdSeries);
      }
    });

    // Logical range change for autoloading earlier candles
    chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange) => {
      if (logicalRange) {
        const visibleSpan = logicalRange.to - logicalRange.from;
        const currentCandles = candlesRef.current;
        if (
          Number.isFinite(visibleSpan) &&
          visibleSpan > 0 &&
          currentCandles.length > 0
        ) {
          const anchorIndex = Math.min(
            currentCandles.length - 1,
            Math.max(
              0,
              Math.round(
                logicalRange.from + visibleSpan * FOCUS_VIEWPORT_RATIO
              )
            )
          );
          const anchorTimeMs = currentCandles[anchorIndex]?.timestampMs;
          if (
            anchorTimeMs !== undefined &&
            anchorTimeMs !== lastNotifiedViewportAnchorRef.current
          ) {
            lastNotifiedViewportAnchorRef.current = anchorTimeMs;
            onViewportAnchorChangeRef.current?.(anchorTimeMs);
          }
        }
      }
      if (
        onLoadEarlierRef.current &&
        !isFetchingEarlierRef.current &&
        shouldLoadEarlierByLogicalRange(logicalRange, 40)
      ) {
        onLoadEarlierRef.current();
      }
      if (
        onLoadLaterRef.current &&
        !isFetchingLaterRef.current &&
        shouldLoadLaterByLogicalRange(
          logicalRange,
          candlesRef.current.length,
          40
        )
      ) {
        onLoadLaterRef.current();
      }
    });
    chart.subscribeClick(() => onSelectDrawingRef.current(null));

    const handleDoubleClick = (event: MouseEvent) => {
      if (
        activeDrawingToolRef.current !== 'select' ||
        selectedDrawingIdRef.current
      ) {
        return;
      }

      const containerBounds = container.getBoundingClientRect();
      const chartCoordinateX = event.clientX - containerBounds.left;
      // The price scale is rendered inside the chart container, but it is not
      // a time-axis surface.  In particular, its double-click auto-scale
      // gesture must not be interpreted as a double-click on the right-side
      // whitespace used for replay positioning.
      if (chartCoordinateX < 0 || chartCoordinateX >= chart.timeScale().width()) {
        return;
      }

      const targetTimeMs = coordinateToChartTimestampMs(
        chart,
        chartCoordinateX,
        candlesRef.current[candlesRef.current.length - 1]?.timestampMs,
        intervalRef.current
      );
      if (targetTimeMs === null) return;

      const nearestCandle = findNearestCandle(
        candlesRef.current,
        targetTimeMs
      );
      if (nearestCandle) {
        event.preventDefault();
        onDoubleClickTimeRef.current?.(targetTimeMs);
      }
    };
    container.addEventListener('dblclick', handleDoubleClick);

    // ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries.length || !entries[0].contentRect) return;
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener('dblclick', handleDoubleClick);
      resizeObserver.disconnect();
      setChartReady(false);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      oiChartRef.current?.remove();
      cvdChartRef.current?.remove();
      oiChartRef.current = null;
      cvdChartRef.current = null;
      oiSeriesRef.current = null;
      cvdSeriesRef.current = null;
    };
  }, []); // Run once on mount

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = seriesRef.current;
    const oiContainer = oiContainerRef.current;
    const cvdContainer = cvdContainerRef.current;
    if (!chart || !candleSeries || !chartReady) return;

    if (!showOiCvd) {
      oiChartRef.current?.remove();
      cvdChartRef.current?.remove();
      oiChartRef.current = null;
      cvdChartRef.current = null;
      oiSeriesRef.current = null;
      cvdSeriesRef.current = null;
      chart.timeScale().applyOptions({ visible: true });
      applyVolumeScaleMargins(chart, candleSeries, Boolean(volumeSeriesRef.current));
      return;
    }
    if (!oiContainer || !cvdContainer) {
      return;
    }

    chart.timeScale().applyOptions({ visible: false });
    applyVolumeScaleMargins(chart, candleSeries, Boolean(volumeSeriesRef.current));

    const oiPane = createFlowPaneChart(
      oiContainer,
      themeMode,
      '#f59e0b',
      false,
      intervalRef
    );
    const cvdPane = createFlowPaneChart(
      cvdContainer,
      themeMode,
      '#60a5fa',
      true,
      intervalRef
    );
    oiChartRef.current = oiPane.chart;
    cvdChartRef.current = cvdPane.chart;
    oiSeriesRef.current = oiPane.series;
    cvdSeriesRef.current = cvdPane.series;
    oiPane.series.setData(
      alignFlowToCandles(candlesRef.current, oiPointsRef.current)
    );
    cvdPane.series.setData(
      alignFlowToCandles(candlesRef.current, cvdPointsRef.current)
    );

    const syncRange = (source: 'price' | 'oi' | 'cvd') => {
      if (flowSyncingRef.current) return;
      const sourceChart =
        source === 'price' ? chart : source === 'oi' ? oiPane.chart : cvdPane.chart;
      const range = sourceChart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      flowSyncingRef.current = true;
      if (source !== 'price') chart.timeScale().setVisibleLogicalRange(range);
      if (source !== 'oi') oiPane.chart.timeScale().setVisibleLogicalRange(range);
      if (source !== 'cvd') cvdPane.chart.timeScale().setVisibleLogicalRange(range);
      flowSyncingRef.current = false;
    };

    const onPriceRange = () => syncRange('price');
    const onOiRange = () => syncRange('oi');
    const onCvdRange = () => syncRange('cvd');
    chart.timeScale().subscribeVisibleLogicalRangeChange(onPriceRange);
    oiPane.chart.timeScale().subscribeVisibleLogicalRangeChange(onOiRange);
    cvdPane.chart.timeScale().subscribeVisibleLogicalRangeChange(onCvdRange);

    const notifyFromFlow = (param: { time?: Time; point?: { x: number; y: number } | undefined }, host: HTMLDivElement) => {
      const notifyCrosshairMove = onCrosshairMoveRef.current;
      const timeVal = param.time;
      if (
        !timeVal ||
        param.point === undefined ||
        param.point.x < 0 ||
        param.point.x > host.clientWidth ||
        param.point.y < 0 ||
        param.point.y > host.clientHeight
      ) {
        notifyCrosshairMove?.(null);
        chart.clearCrosshairPosition();
        return;
      }
      const timeMs = typeof timeVal === 'number' ? timeVal * 1000 : 0;
      const found = findNearestCandle(candlesRef.current, timeMs);
      notifyCrosshairMove?.(
        found && Math.abs(found.timestampMs - timeMs) < 1000 ? found : null
      );
      if (found && seriesRef.current) {
        chart.setCrosshairPosition(found.close, timeVal, seriesRef.current);
      }
      const otherChart = host === oiContainer ? cvdPane.chart : oiPane.chart;
      const otherSeries = host === oiContainer ? cvdPane.series : oiPane.series;
      const otherPoints = host === oiContainer ? cvdPointsRef.current : oiPointsRef.current;
      const otherValue = flowValueAtOrBefore(otherPoints, timeMs);
      if (otherValue != null) {
        otherChart.setCrosshairPosition(otherValue, timeVal, otherSeries);
      }
    };

    oiPane.chart.subscribeCrosshairMove((param) => notifyFromFlow(param, oiContainer));
    cvdPane.chart.subscribeCrosshairMove((param) => notifyFromFlow(param, cvdContainer));

    const resizePanes = () => {
      oiPane.chart.applyOptions({
        width: oiContainer.clientWidth,
        height: oiContainer.clientHeight,
      });
      cvdPane.chart.applyOptions({
        width: cvdContainer.clientWidth,
        height: cvdContainer.clientHeight,
      });
    };
    const resizeObserver = new ResizeObserver(resizePanes);
    resizeObserver.observe(oiContainer);
    resizeObserver.observe(cvdContainer);
    resizePanes();

    const priceRange = chart.timeScale().getVisibleLogicalRange();
    if (priceRange) {
      flowSyncingRef.current = true;
      oiPane.chart.timeScale().setVisibleLogicalRange(priceRange);
      cvdPane.chart.timeScale().setVisibleLogicalRange(priceRange);
      flowSyncingRef.current = false;
    }

    return () => {
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onPriceRange);
      oiPane.chart.remove();
      cvdPane.chart.remove();
      if (oiChartRef.current === oiPane.chart) oiChartRef.current = null;
      if (cvdChartRef.current === cvdPane.chart) cvdChartRef.current = null;
      if (oiSeriesRef.current === oiPane.series) oiSeriesRef.current = null;
      if (cvdSeriesRef.current === cvdPane.series) cvdSeriesRef.current = null;
    };
  }, [chartReady, showOiCvd]);

  useEffect(() => {
    if (!showOiCvd) return;
    const visibleRange = chartRef.current?.timeScale().getVisibleLogicalRange();
    oiSeriesRef.current?.setData(alignFlowToCandles(candles, oiPoints));
    cvdSeriesRef.current?.setData(alignFlowToCandles(candles, cvdPoints));
    if (visibleRange) {
      flowSyncingRef.current = true;
      oiChartRef.current?.timeScale().setVisibleLogicalRange(visibleRange);
      cvdChartRef.current?.timeScale().setVisibleLogicalRange(visibleRange);
      flowSyncingRef.current = false;
    }
  }, [candles, cvdPoints, oiPoints, showOiCvd]);

  // Theme update without rebuilding the chart or losing the viewport.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const theme = chartThemeColors(themeMode);
    chart.applyOptions({
      layout: {
        background: {
          type: ColorType.Solid,
          color: theme.background,
        },
        textColor: theme.text,
      },
      grid: {
        vertLines: { color: theme.grid },
        horzLines: { color: theme.grid },
      },
      rightPriceScale: {
        borderColor: theme.border,
      },
      timeScale: {
        borderColor: theme.border,
      },
    });
    for (const flowChart of [oiChartRef.current, cvdChartRef.current]) {
      if (!flowChart) continue;
      flowChart.applyOptions({
        layout: {
          background: {
            type: ColorType.Solid,
            color: theme.background,
          },
          textColor: theme.text,
        },
        grid: {
          vertLines: { color: theme.grid },
          horzLines: { color: theme.grid },
        },
        rightPriceScale: {
          borderColor: theme.border,
        },
        timeScale: {
          borderColor: theme.border,
        },
      });
    }
  }, [themeMode]);

  // Price scale mode update
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.priceScale('right').applyOptions({
        mode: isLogScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      });
    }
  }, [isLogScale]);

  // Data update
  useEffect(() => {
    const series = seriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    const seriesKey = `${symbol}:${interval}`;
    const isSeriesContextChange = prevSeriesKeyRef.current !== seriesKey;
    if (isSeriesContextChange) {
      prevSeriesKeyRef.current = seriesKey;
      lastAppliedFocusKeyRef.current = null;
      prevBarsCountRef.current = 0;
      prevFirstTimestampRef.current = null;
      prevLastTimestampRef.current = null;
      prevCandlesRef.current = [];
      lastNotifiedViewportAnchorRef.current = null;
      // Remember that the next non-empty setData must set a viewport. The first
      // render after a symbol/interval switch often arrives with candles=[], which
      // would otherwise consume isSeriesContextChange and leave LWC on the left.
      pendingViewportResetRef.current = true;
    }

    const rememberVisibleSpan = () => {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      const span = range.to - range.from;
      if (Number.isFinite(span) && span >= 10) {
        lastVisibleSpanRef.current = clampVisibleSpan(span);
      }
    };

    const applyRightAlignedViewport = (barCount: number) => {
      // Live tip: keep the newest bar at the same ~80% anchor as replay focus.
      chart.timeScale().setVisibleLogicalRange(
        logicalRangeForFocus(barCount - 1, lastVisibleSpanRef.current)
      );
    };

    const applyFocusTimeViewport = (
      _barCount: number,
      targetTimeMs: number
    ) => {
      const focusIndex = Math.max(
        0,
        findNearestCandleIndex(candles, targetTimeMs)
      );
      // Replay cut-in / explicit focus must stay at ~80% even when the focused
      // candle is also the last visible bar (future candles are masked).
      chart.timeScale().setVisibleLogicalRange(
        logicalRangeForFocus(focusIndex, lastVisibleSpanRef.current)
      );
      return focusIndex;
    };

    rememberVisibleSpan();

    if (!candles || candles.length === 0) {
      series.setData([]);
      volumeSeries?.setData([]);
      prevBarsCountRef.current = 0;
      prevFirstTimestampRef.current = null;
      prevLastTimestampRef.current = null;
      prevCandlesRef.current = [];
      return;
    }

    const firstCandle = candles[0];
    const lastCandle = candles[candles.length - 1];
    const previousCandles = prevCandlesRef.current;
    const canAppendIncrementally =
      prevBarsCountRef.current > 0 &&
      candles.length > prevBarsCountRef.current &&
      firstCandle.timestampMs === prevFirstTimestampRef.current &&
      candles[prevBarsCountRef.current - 1]?.timestampMs ===
        prevLastTimestampRef.current &&
      previousCandles.length === prevBarsCountRef.current &&
      previousCandles[0] === candles[0] &&
      previousCandles[previousCandles.length - 1] ===
        candles[previousCandles.length - 1];

    if (canAppendIncrementally) {
      const visibleRangeBeforeAppend =
        chart.timeScale().getVisibleLogicalRange();
      for (
        let index = prevBarsCountRef.current;
        index < candles.length;
        index += 1
      ) {
        const candle = candles[index];
        series.update({
          time: timestampMsToUtcTimestamp(candle.timestampMs),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        });
        volumeSeries?.update({
          time: timestampMsToUtcTimestamp(candle.timestampMs),
          value: candle.volume,
          color:
            candle.close >= candle.open
              ? 'rgba(8, 153, 129, 0.42)'
              : 'rgba(242, 54, 69, 0.42)',
          });
      }
      if (visibleRangeBeforeAppend) {
        chart.timeScale().setVisibleLogicalRange(visibleRangeBeforeAppend);
      }
      prevBarsCountRef.current = candles.length;
      prevLastTimestampRef.current = lastCandle.timestampMs;
      prevCandlesRef.current = candles;
      return;
    }

    if (
      candles.length === prevBarsCountRef.current &&
      firstCandle.timestampMs === prevFirstTimestampRef.current &&
      lastCandle.timestampMs === prevLastTimestampRef.current
    ) {
      if (previousCandles === candles) return;
      const historicalBarsUnchanged = previousCandles
        .slice(0, -1)
        .every((previous, index) => candlesEqual(previous, candles[index]));
      if (historicalBarsUnchanged) {
        const previousLastCandle = previousCandles[previousCandles.length - 1];
        if (!previousLastCandle || !candlesEqual(previousLastCandle, lastCandle)) {
          series.update({
            time: timestampMsToUtcTimestamp(lastCandle.timestampMs),
            open: lastCandle.open,
            high: lastCandle.high,
            low: lastCandle.low,
            close: lastCandle.close,
          });
          volumeSeries?.update({
            time: timestampMsToUtcTimestamp(lastCandle.timestampMs),
            value: lastCandle.volume,
            color:
              lastCandle.close >= lastCandle.open
                ? 'rgba(8, 153, 129, 0.42)'
                : 'rgba(242, 54, 69, 0.42)',
          });
        }
        prevCandlesRef.current = candles;
        return;
      }
    }

    // Full replacement is reserved for prepend, rewind, context switches,
    // and data sets that are not a simple forward append.
    const sortedData: CandlestickData[] = [];
    const volumeData: HistogramData[] = [];
    for (const c of candles) {
      sortedData.push({
        time: timestampMsToUtcTimestamp(c.timestampMs),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      });
      volumeData.push({
        time: timestampMsToUtcTimestamp(c.timestampMs),
        value: c.volume,
        color:
          c.close >= c.open
            ? 'rgba(8, 153, 129, 0.42)'
            : 'rgba(242, 54, 69, 0.42)',
      });
    }

    const prevLogicalRange = chart.timeScale().getVisibleLogicalRange();
    const firstTimestamp = firstCandle.timestampMs;
    const isPrepended =
      prevFirstTimestampRef.current !== null &&
      firstTimestamp < prevFirstTimestampRef.current &&
      sortedData.length > prevBarsCountRef.current;
    const addedCount = sortedData.length - prevBarsCountRef.current;

    series.setData(sortedData);
    volumeSeries?.setData(volumeData);

    const shouldResetViewport =
      pendingViewportResetRef.current || prevBarsCountRef.current === 0;
    const pendingFocusTimeMs = focusTimeMsRef.current;
    const pendingFocusRangeMs = focusRangeMsRef.current;

    if (shouldResetViewport) {
      pendingViewportResetRef.current = false;
      if (pendingFocusRangeMs) {
        // Range focus is applied by the dedicated focus effect once data covers
        // the trade window; avoid a conflicting right-align flash here.
      } else if (pendingFocusTimeMs !== null) {
        applyFocusTimeViewport(sortedData.length, pendingFocusTimeMs);
        lastAppliedFocusKeyRef.current = `${symbol}:${interval}:${pendingFocusTimeMs}:::${focusRevision}`;
      } else {
        applyRightAlignedViewport(sortedData.length);
      }
    } else if (isPrepended && prevLogicalRange && addedCount > 0) {
      // If prepended earlier candles, adjust logical range so view doesn't jump
      chart.timeScale().setVisibleLogicalRange({
        from: prevLogicalRange.from + addedCount,
        to: prevLogicalRange.to + addedCount,
      });
    } else if (prevLogicalRange) {
      // A trailing refresh can revise several already-cached D/W/4h bars
      // without changing the time range. Full setData is required for those
      // historical bars, but the user's viewport should not move.
      chart.timeScale().setVisibleLogicalRange(prevLogicalRange);
    }

    prevBarsCountRef.current = sortedData.length;
    prevFirstTimestampRef.current = firstTimestamp;
    prevLastTimestampRef.current = lastCandle.timestampMs;
    prevCandlesRef.current = candles;
  }, [candles, focusRevision, interval, symbol]);

  // Keep the replay cut-in candle visible after future candles are masked.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (focusTimeMs === null && focusRangeMs === null) {
      lastAppliedFocusKeyRef.current = null;
      return;
    }
    if (candles.length === 0) {
      return;
    }

    const focusKey = `${symbol}:${interval}:${focusTimeMs ?? ''}:${
      focusRangeMs?.from ?? ''
    }:${focusRangeMs?.to ?? ''}:${focusRevision}`;
    if (lastAppliedFocusKeyRef.current === focusKey) return;

    if (focusRangeMs) {
      const rangeFrom = Math.min(focusRangeMs.from, focusRangeMs.to);
      const rangeTo = Math.max(focusRangeMs.from, focusRangeMs.to);
      const intervalMs = TIMEFRAME_SECONDS_MAP[interval] * 1000;
      const firstTimestamp = candles[0].timestampMs;
      const lastTimestamp =
        candles[candles.length - 1].timestampMs + intervalMs;

      // A trade switch can render once with the previous trade's candles.
      // Wait for the new data range instead of marking that stale focus as done.
      if (rangeFrom < firstTimestamp || rangeTo > lastTimestamp) {
        return;
      }

      const candleIndexAt = (timestampMs: number) => {
        let low = 0;
        let high = candles.length - 1;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (candles[middle].timestampMs <= timestampMs) low = middle;
          else high = middle - 1;
        }
        return low;
      };
      const resolvedFrom = candleIndexAt(rangeFrom);
      const resolvedTo = candleIndexAt(rangeTo);
      const tradeSpan = Math.max(1, resolvedTo - resolvedFrom + 1);
      const padding = Math.max(12, Math.round(tradeSpan * 0.2));
      const visibleSpan = tradeSpan + padding * 2;
      const tradeCenter = (resolvedFrom + resolvedTo) / 2;
      const frame = window.requestAnimationFrame(() => {
        chart.timeScale().setVisibleLogicalRange({
          from: tradeCenter - visibleSpan / 2,
          to: tradeCenter + visibleSpan / 2,
        });
        lastAppliedFocusKeyRef.current = focusKey;
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const resolvedFocusTimeMs = focusTimeMs ?? candles[0].timestampMs;
    const focusIndex = Math.max(
      0,
      findNearestCandleIndex(candles, resolvedFocusTimeMs)
    );

    const currentRange = chart.timeScale().getVisibleLogicalRange();
    if (currentRange) {
      const span = currentRange.to - currentRange.from;
      if (Number.isFinite(span) && span >= 10) {
        lastVisibleSpanRef.current = clampVisibleSpan(span);
      }
    }
    const frame = window.requestAnimationFrame(() => {
      chart.timeScale().setVisibleLogicalRange(
        logicalRangeForFocus(focusIndex, lastVisibleSpanRef.current)
      );
      lastAppliedFocusKeyRef.current = focusKey;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    candles,
    focusRangeMs,
    focusRevision,
    focusTimeMs,
    interval,
    symbol,
  ]);

  // System Markers Update
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setMarkers(systemMarkers);
  }, [systemMarkers]);

  return (
    <div
      className="chart-canvas-stack"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        className="chart-canvas-price-pane"
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
        }}
      >
        <div
          ref={containerRef}
          style={{
            position: 'absolute',
            inset: 0,
          }}
        />
        {chartReady &&
          chartRef.current &&
          (showUsSessionBands || showWeekendBands) && (
            <UsSessionBandsOverlay
              chart={chartRef.current}
              candles={candles}
              interval={interval}
              themeMode={themeMode}
              showUsSessionBands={showUsSessionBands}
              showWeekendBands={showWeekendBands}
            />
          )}
        {chartReady && chartRef.current && seriesRef.current && (
          <ChartDrawingOverlay
            chart={chartRef.current}
            series={seriesRef.current}
            candles={candles}
            drawings={drawings}
            activeTool={activeDrawingTool}
            selectedDrawingId={selectedDrawingId}
            magnetEnabled={magnetEnabled}
            videoId={drawingVideoId}
            symbol={symbol}
            interval={interval}
            onSelectDrawing={onSelectDrawing}
            onSaveDrawing={onSaveDrawing}
            onDeleteDrawing={onDeleteDrawing}
            onToggleLockDrawing={onToggleLockDrawing}
            onDrawingComplete={onDrawingComplete}
          />
        )}
      </div>
      {showOiCvd && (
        <>
          <div
            className="chart-flow-pane"
            style={{ height: FLOW_PANE_HEIGHT, flexShrink: 0 }}
          >
            <span className="chart-flow-pane-label" style={{ color: '#f59e0b' }}>
              OI
            </span>
            <div ref={oiContainerRef} className="chart-flow-pane-chart" />
          </div>
          <div
            className="chart-flow-pane"
            style={{ height: FLOW_CVD_PANE_HEIGHT, flexShrink: 0 }}
          >
            <span className="chart-flow-pane-label" style={{ color: '#60a5fa' }}>
              CVD
            </span>
            <div ref={cvdContainerRef} className="chart-flow-pane-chart" />
          </div>
        </>
      )}
    </div>
  );
}

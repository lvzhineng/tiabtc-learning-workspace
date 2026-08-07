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
  type SeriesMarker,
  type UTCTimestamp,
  type Time,
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
  onDrawingComplete?: () => void;
  showVolume?: boolean;
}

function findNearestCandle(
  candles: Candlestick[],
  targetTimeMs: number
): Candlestick | null {
  if (candles.length === 0) return null;
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
    ? left
    : right;
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
  onDrawingComplete = () => {},
  showVolume = false,
}: ChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const prevBarsCountRef = useRef<number>(0);
  const prevFirstTimestampRef = useRef<number | null>(null);
  const prevLastTimestampRef = useRef<number | null>(null);
  const prevSeriesKeyRef = useRef<string>('');
  const isFetchingEarlierRef = useRef<boolean>(isLoadingEarlier);
  const isFetchingLaterRef = useRef<boolean>(isLoadingLater);
  const candlesRef = useRef<Candlestick[]>(candles);
  const onCrosshairMoveRef = useRef(onCrosshairMove);
  const onLoadEarlierRef = useRef(onLoadEarlier);
  const onLoadLaterRef = useRef(onLoadLater);
  const onSelectDrawingRef = useRef(onSelectDrawing);
  const onDoubleClickTimeRef = useRef(onDoubleClickTime);
  const activeDrawingToolRef = useRef(activeDrawingTool);
  const selectedDrawingIdRef = useRef(selectedDrawingId);
  const intervalRef = useRef(interval);
  const lastAppliedFocusKeyRef = useRef<string | null>(null);
  const focusTimeMsRef = useRef(focusTimeMs);
  const focusRangeMsRef = useRef(focusRangeMs);
  const [chartReady, setChartReady] = useState(false);

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
        rightOffset: 12,
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
      if (!notifyCrosshairMove) return;
      if (
        !param ||
        !param.time ||
        param.point === undefined ||
        param.point.x < 0 ||
        param.point.x > container.clientWidth ||
        param.point.y < 0 ||
        param.point.y > container.clientHeight
      ) {
        notifyCrosshairMove(null);
        return;
      }

      const timeVal = param.time;
      const timeMs = typeof timeVal === 'number' ? timeVal * 1000 : 0;
      const found = findNearestCandle(candlesRef.current, timeMs);
      notifyCrosshairMove(
        found && Math.abs(found.timestampMs - timeMs) < 1000 ? found : null
      );
    });

    // Logical range change for autoloading earlier candles
    chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange) => {
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
    };
  }, []); // Run once on mount

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
    }

    if (!candles || candles.length === 0) {
      series.setData([]);
      volumeSeries?.setData([]);
      prevBarsCountRef.current = 0;
      prevFirstTimestampRef.current = null;
      prevLastTimestampRef.current = null;
      return;
    }

    const firstCandle = candles[0];
    const lastCandle = candles[candles.length - 1];
    const canAppendIncrementally =
      prevBarsCountRef.current > 0 &&
      candles.length > prevBarsCountRef.current &&
      firstCandle.timestampMs === prevFirstTimestampRef.current &&
      candles[prevBarsCountRef.current - 1]?.timestampMs ===
        prevLastTimestampRef.current;

    if (canAppendIncrementally) {
      const visibleRangeBeforeAppend =
        chart.timeScale().getVisibleLogicalRange();
      for (const candle of candles.slice(prevBarsCountRef.current)) {
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
      return;
    }

    if (
      candles.length === prevBarsCountRef.current &&
      firstCandle.timestampMs === prevFirstTimestampRef.current &&
      lastCandle.timestampMs === prevLastTimestampRef.current
    ) {
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
      return;
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

    // A symbol or interval switch has no shared logical index with the
    // previous series. Position the newly loaded range explicitly instead of
    // reusing the previous series' viewport indices. When a focus target is
    // pending, skip right-align so the focus effect can center without a flash.
    const hasPendingFocus =
      focusTimeMsRef.current !== null || focusRangeMsRef.current !== null;
    if (
      (isSeriesContextChange || prevBarsCountRef.current === 0) &&
      !hasPendingFocus
    ) {
      const visibleSpan = prevLogicalRange
        ? Math.max(30, prevLogicalRange.to - prevLogicalRange.from)
        : 120;
      const rightPadding = 12;
      chart.timeScale().setVisibleLogicalRange({
        from: sortedData.length - visibleSpan + rightPadding,
        to: sortedData.length - 1 + rightPadding,
      });
    }

    // If prepended earlier candles, adjust logical range so view doesn't jump
    if (isPrepended && prevLogicalRange && addedCount > 0) {
      chart.timeScale().setVisibleLogicalRange({
        from: prevLogicalRange.from + addedCount,
        to: prevLogicalRange.to + addedCount,
      });
    }

    prevBarsCountRef.current = sortedData.length;
    prevFirstTimestampRef.current = firstTimestamp;
    prevLastTimestampRef.current = lastCandle.timestampMs;
  }, [candles, interval, symbol]);

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

    const resolvedFocusTimeMs =
      focusTimeMs ?? candles[0].timestampMs;
    let focusIndex = 0;
    let nearestDistanceMs = Number.POSITIVE_INFINITY;
    candles.forEach((candle, index) => {
      const distanceMs = Math.abs(
        candle.timestampMs - resolvedFocusTimeMs
      );
      if (distanceMs < nearestDistanceMs) {
        focusIndex = index;
        nearestDistanceMs = distanceMs;
      }
    });

    const currentRange = chart.timeScale().getVisibleLogicalRange();
    const visibleSpan = currentRange
      ? Math.max(30, currentRange.to - currentRange.from)
      : 120;
    const rightPadding = 12;
    const frame = window.requestAnimationFrame(() => {
      chart.timeScale().setVisibleLogicalRange({
        from: focusIndex - visibleSpan + rightPadding,
        to: focusIndex + rightPadding,
      });
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
      style={{
        width: '100%',
        height: '100%',
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
          onDrawingComplete={onDrawingComplete}
        />
      )}
    </div>
  );
}

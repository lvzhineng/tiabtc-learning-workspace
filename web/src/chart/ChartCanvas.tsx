import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  PriceScaleMode,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
} from 'lightweight-charts';
import type { Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { shouldLoadEarlierByLogicalRange } from './chart-autoload';
import { timestampMsToUtcTimestamp } from './chart-time';

interface ChartCanvasProps {
  candles: Candlestick[];
  symbol: string;
  interval: ReviewTimeframe;
  isLogScale?: boolean;
  onCrosshairMove?: (candle: Candlestick | null) => void;
  onLoadEarlier?: () => void;
  isLoadingEarlier?: boolean;
}

export function ChartCanvas({
  candles,
  isLogScale = false,
  onCrosshairMove,
  onLoadEarlier,
  isLoadingEarlier = false,
}: ChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const prevBarsCountRef = useRef<number>(0);
  const isFetchingEarlierRef = useRef<boolean>(isLoadingEarlier);

  useEffect(() => {
    isFetchingEarlierRef.current = isLoadingEarlier;
  }, [isLoadingEarlier]);

  // Chart initialization & lifecycle
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#0f1218' },
        textColor: '#787b86',
      },
      grid: {
        vertLines: { color: '#1e222d' },
        horzLines: { color: '#1e222d' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#787b86',
          width: 1,
          style: 3, // dashed
        },
        horzLine: {
          color: '#787b86',
          width: 1,
          style: 3,
        },
      },
      rightPriceScale: {
        borderColor: '#2a2e39',
        mode: isLogScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        autoScale: true,
      },
      timeScale: {
        borderColor: '#2a2e39',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 6,
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

    chartRef.current = chart;
    seriesRef.current = series;

    // Crosshair listener
    chart.subscribeCrosshairMove((param) => {
      if (!onCrosshairMove) return;
      if (
        !param ||
        !param.time ||
        param.point === undefined ||
        param.point.x < 0 ||
        param.point.x > container.clientWidth ||
        param.point.y < 0 ||
        param.point.y > container.clientHeight
      ) {
        onCrosshairMove(null);
        return;
      }

      const timeVal = param.time;
      const timeMs = typeof timeVal === 'number' ? timeVal * 1000 : 0;
      const found = candles.find((c) => Math.abs(c.timestampMs - timeMs) < 1000);
      onCrosshairMove(found || null);
    });

    // Logical range change for autoloading earlier candles
    chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange) => {
      if (
        onLoadEarlier &&
        !isFetchingEarlierRef.current &&
        shouldLoadEarlierByLogicalRange(logicalRange, 40)
      ) {
        onLoadEarlier();
      }
    });

    // ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries.length || !entries[0].contentRect) return;
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []); // Run once on mount

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
    const chart = chartRef.current;
    if (!series || !chart) return;

    if (!candles || candles.length === 0) {
      series.setData([]);
      prevBarsCountRef.current = 0;
      return;
    }

    // Sort & deduplicate by timestamp
    const sortedMap = new Map<number, CandlestickData>();
    for (const c of candles) {
      sortedMap.set(c.timestampMs, {
        time: timestampMsToUtcTimestamp(c.timestampMs),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      });
    }

    const sortedData = Array.from(sortedMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([, data]) => data);

    const prevLogicalRange = chart.timeScale().getVisibleLogicalRange();
    const isPrepended = sortedData.length > prevBarsCountRef.current && prevBarsCountRef.current > 0;
    const addedCount = sortedData.length - prevBarsCountRef.current;

    series.setData(sortedData);

    // If prepended earlier candles, adjust logical range so view doesn't jump
    if (isPrepended && prevLogicalRange && addedCount > 0) {
      chart.timeScale().setVisibleLogicalRange({
        from: prevLogicalRange.from + addedCount,
        to: prevLogicalRange.to + addedCount,
      });
    }

    prevBarsCountRef.current = sortedData.length;
  }, [candles]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
      }}
    />
  );
}

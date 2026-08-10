import { useEffect, useRef } from 'react';
import type { IChartApi, Time } from 'lightweight-charts';
import type { Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';
import {
  timestampMsToUtcTimestamp,
  utcTimestampToTimestampMs,
} from '@/chart/chart-time';
import {
  listUsRegularSessions,
  type UsSessionBand,
} from '@/chart/us-session';

/** Session bands are only meaningful inside a single day of bars. */
const SESSION_BAND_TIMEFRAMES = new Set<ReviewTimeframe>([
  '1',
  '5',
  '15',
  '60',
  '240',
]);

type Props = {
  chart: IChartApi;
  candles: Candlestick[];
  interval: ReviewTimeframe;
  themeMode: 'dark' | 'light';
};

function fillColor(themeMode: 'dark' | 'light'): string {
  return themeMode === 'light'
    ? 'rgba(37, 99, 235, 0.07)'
    : 'rgba(96, 165, 250, 0.11)';
}

function timestampToChartCoordinate(
  chart: IChartApi,
  candles: Candlestick[],
  timestampMs: number
): number | null {
  const directCoordinate = chart.timeScale().timeToCoordinate(
    timestampMsToUtcTimestamp(timestampMs)
  );
  if (directCoordinate !== null) return directCoordinate;
  if (candles.length < 2) return null;

  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].timestampMs < timestampMs) low = middle + 1;
    else high = middle;
  }

  const rightIndex = Math.min(candles.length - 1, Math.max(1, low));
  const leftIndex = rightIndex - 1;
  const leftCandle = candles[leftIndex];
  const rightCandle = candles[rightIndex];
  const leftCoordinate = chart.timeScale().timeToCoordinate(
    timestampMsToUtcTimestamp(leftCandle.timestampMs)
  );
  const rightCoordinate = chart.timeScale().timeToCoordinate(
    timestampMsToUtcTimestamp(rightCandle.timestampMs)
  );
  if (leftCoordinate === null || rightCoordinate === null) return null;

  const timeSpan = rightCandle.timestampMs - leftCandle.timestampMs;
  if (timeSpan <= 0) return leftCoordinate;
  const ratio = (timestampMs - leftCandle.timestampMs) / timeSpan;
  return leftCoordinate + (rightCoordinate - leftCoordinate) * ratio;
}

type SessionBandCache = {
  fromMs: number;
  toMs: number;
  bands: UsSessionBand[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function buildSessionBandCache(
  visible: { fromMs: number; toMs: number }
): SessionBandCache {
  const visibleSpanMs = Math.max(DAY_MS, visible.toMs - visible.fromMs);
  const paddingMs = Math.max(7 * DAY_MS, visibleSpanMs);
  const fromMs = visible.fromMs - paddingMs;
  const toMs = visible.toMs + paddingMs;
  const bands = listUsRegularSessions(fromMs, toMs);

  return { fromMs, toMs, bands };
}

function visibleTimeRangeMs(
  chart: IChartApi,
  candles: Candlestick[]
): { fromMs: number; toMs: number } | null {
  const visible = chart.timeScale().getVisibleRange();
  if (
    visible &&
    typeof visible.from === 'number' &&
    typeof visible.to === 'number'
  ) {
    return {
      fromMs: utcTimestampToTimestampMs(visible.from as Time),
      toMs: utcTimestampToTimestampMs(visible.to as Time),
    };
  }
  if (candles.length === 0) return null;
  return {
    fromMs: candles[0].timestampMs,
    toMs: candles[candles.length - 1].timestampMs,
  };
}

/**
 * Imperative canvas overlay: pan/zoom only repaints pixels (no React state).
 * Session bands are computed for the visible window only.
 */
export function UsSessionBandsOverlay({
  chart,
  candles,
  interval,
  themeMode,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const candlesRef = useRef(candles);
  const themeModeRef = useRef(themeMode);
  const intervalRef = useRef(interval);
  const schedulePaintRef = useRef<(() => void) | null>(null);

  candlesRef.current = candles;
  themeModeRef.current = themeMode;
  intervalRef.current = interval;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let frame: number | null = null;
    let sessionBandCache: SessionBandCache | null = null;
    const timeScale = chart.timeScale();
    const host = canvas.parentElement;
    let cssWidth = host?.clientWidth ?? chart.chartElement().clientWidth;
    let cssHeight = host?.clientHeight ?? chart.chartElement().clientHeight;
    let dpr = window.devicePixelRatio || 1;

    const resizeCanvas = () => {
      const pixelWidth = Math.max(1, Math.floor(cssWidth * dpr));
      const pixelHeight = Math.max(1, Math.floor(cssHeight * dpr));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    };
    resizeCanvas();

    const paint = () => {
      frame = null;
      if (disposed) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const currentDpr = window.devicePixelRatio || 1;
      if (currentDpr !== dpr) {
        dpr = currentDpr;
        resizeCanvas();
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const currentInterval = intervalRef.current;
      const currentCandles = candlesRef.current;
      if (
        !SESSION_BAND_TIMEFRAMES.has(currentInterval) ||
        currentCandles.length === 0
      ) {
        return;
      }

      const visible = visibleTimeRangeMs(chart, currentCandles);
      if (!visible) return;

      if (
        !sessionBandCache ||
        visible.fromMs < sessionBandCache.fromMs ||
        visible.toMs > sessionBandCache.toMs
      ) {
        sessionBandCache = buildSessionBandCache(visible);
      }
      const bands = sessionBandCache.bands;
      if (bands.length === 0) return;

      ctx.fillStyle = fillColor(themeModeRef.current);
      const scaleWidth = timeScale.width();
      for (const band of bands) {
        if (band.toMs < visible.fromMs || band.fromMs > visible.toMs) continue;
        const left = timestampToChartCoordinate(
          chart,
          currentCandles,
          band.fromMs
        );
        const right = timestampToChartCoordinate(
          chart,
          currentCandles,
          band.toMs
        );
        if (left === null || right === null) continue;

        const x = Math.min(left, right);
        const width = Math.abs(right - left);
        if (!(width > 0.5)) continue;
        if (x + width < 0 || x > scaleWidth) continue;
        ctx.fillRect(x, 0, width, cssHeight);
      }
    };

    const schedulePaint = () => {
      if (disposed || frame !== null) return;
      frame = window.requestAnimationFrame(paint);
    };
    schedulePaintRef.current = schedulePaint;

    const resizeObserver = host
      ? new ResizeObserver(([entry]) => {
          if (!entry) return;
          cssWidth = entry.contentRect.width;
          cssHeight = entry.contentRect.height;
          resizeCanvas();
          schedulePaint();
        })
      : null;
    if (host) resizeObserver?.observe(host);

    schedulePaint();
    timeScale.subscribeVisibleLogicalRangeChange(schedulePaint);
    timeScale.subscribeSizeChange(schedulePaint);

    return () => {
      disposed = true;
      schedulePaintRef.current = null;
      resizeObserver?.disconnect();
      timeScale.unsubscribeVisibleLogicalRangeChange(schedulePaint);
      timeScale.unsubscribeSizeChange(schedulePaint);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
    };
  }, [chart]);

  useEffect(() => {
    schedulePaintRef.current?.();
  }, [candles, themeMode, interval]);

  if (!SESSION_BAND_TIMEFRAMES.has(interval)) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className="us-session-bands-overlay"
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 2,
        pointerEvents: 'none',
      }}
    />
  );
}

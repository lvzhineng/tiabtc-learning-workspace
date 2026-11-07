import { useEffect, useRef } from 'react';
import type { Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import {
  timeframeMs,
  timestampMsToUtcTimestamp,
  utcTimestampToTimestampMs,
} from '@/chart/chart-time';

type Props = {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  /** Only candles already revealed by replay should be passed here. */
  candles: Candlestick[];
  interval: ReviewTimeframe;
  sessionStartMs: number;
  sessionEndMs: number;
  every: number;
  themeMode: 'dark' | 'light';
  isLogScale?: boolean;
};

function lowerBound(candles: Candlestick[], timestampMs: number): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (candles[middle].timestampMs < timestampMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(candles: Candlestick[], timestampMs: number): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (candles[middle].timestampMs <= timestampMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Draws session bar numbers as an inert SVG layer so chart exports include
 * them without adding persisted drawing objects.
 */
export function BarCountOverlay({
  chart,
  series,
  candles,
  interval,
  sessionStartMs,
  sessionEndMs,
  every,
  themeMode,
  isLogScale = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const candlesRef = useRef(candles);
  const intervalRef = useRef(interval);
  const sessionStartMsRef = useRef(sessionStartMs);
  const sessionEndMsRef = useRef(sessionEndMs);
  const everyRef = useRef(every);
  const themeModeRef = useRef(themeMode);
  candlesRef.current = candles;
  intervalRef.current = interval;
  sessionStartMsRef.current = sessionStartMs;
  sessionEndMsRef.current = sessionEndMs;
  everyRef.current = every;
  themeModeRef.current = themeMode;

  const schedulePaintRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const host = svg?.parentElement;
    if (!svg || !host) return;

    let disposed = false;
    let frame: number | null = null;
    const timeScale = chart.timeScale();

    const paint = () => {
      frame = null;
      if (disposed) return;
      svg.replaceChildren();

      const currentCandles = candlesRef.current;
      const stepMs = timeframeMs(intervalRef.current);
      const countEvery = Math.floor(everyRef.current);
      const sessionStart = sessionStartMsRef.current;
      const sessionEnd = sessionEndMsRef.current;
      if (
        currentCandles.length === 0 ||
        !Number.isFinite(stepMs) ||
        stepMs <= 0 ||
        !Number.isFinite(countEvery) ||
        countEvery <= 0 ||
        !Number.isFinite(sessionStart) ||
        !Number.isFinite(sessionEnd) ||
        sessionEnd <= sessionStart
      ) {
        return;
      }

      const visibleRange = timeScale.getVisibleRange();
      const visibleLogicalRange = timeScale.getVisibleLogicalRange();
      let startIndex = 0;
      let endIndex = currentCandles.length;
      if (visibleRange) {
        const fromMs = utcTimestampToTimestampMs(visibleRange.from);
        const toMs = utcTimestampToTimestampMs(visibleRange.to);
        startIndex = lowerBound(currentCandles, fromMs);
        endIndex = upperBound(currentCandles, toMs);
      } else if (visibleLogicalRange) {
        // Fallback for the first frame before Lightweight Charts resolves a
        // time range. The chart series and candles share their data ordering.
        startIndex = Math.max(0, Math.floor(visibleLogicalRange.from) - 1);
        endIndex = Math.min(
          currentCandles.length,
          Math.ceil(visibleLogicalRange.to) + 2
        );
      }

      const plotWidth = timeScale.width();
      const paneHeight = chart.paneSize().height;
      if (plotWidth <= 0 || paneHeight <= 0) return;

      const textColor =
        themeModeRef.current === 'light'
          ? 'rgba(71, 85, 105, 0.78)'
          : 'rgba(203, 213, 225, 0.78)';
      const textOutline =
        themeModeRef.current === 'light'
          ? 'rgba(255, 255, 255, 0.72)'
          : 'rgba(15, 23, 42, 0.78)';
      const labels = document.createDocumentFragment();
      let previousRightEdge = Number.NEGATIVE_INFINITY;

      for (let index = startIndex; index < endIndex; index += 1) {
        const candle = currentCandles[index];
        if (
          candle.timestampMs < sessionStart ||
          candle.timestampMs >= sessionEnd
        ) {
          continue;
        }

        const barNumber =
          Math.floor((candle.timestampMs - sessionStart) / stepMs) + 1;
        if (barNumber <= 0 || barNumber % countEvery !== 0) continue;

        const x = timeScale.timeToCoordinate(
          timestampMsToUtcTimestamp(candle.timestampMs)
        );
        const lowY = series.priceToCoordinate(candle.low);
        if (
          x === null ||
          lowY === null ||
          !Number.isFinite(x) ||
          !Number.isFinite(lowY) ||
          x < 0 ||
          x > plotWidth
        ) {
          continue;
        }

        const label = String(barNumber);
        const estimatedWidth = label.length * 5.4;
        const leftEdge = x - estimatedWidth / 2;
        const rightEdge = x + estimatedWidth / 2;
        // Preserve the original number sequence while omitting labels that
        // would collide at compressed zoom levels.
        if (leftEdge < previousRightEdge + 1) continue;

        const y = lowY + 12;
        if (y < 0 || y > paneHeight - 2) continue;

        const text = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'text'
        );
        text.setAttribute('x', String(x));
        text.setAttribute('y', String(y));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', textColor);
        text.setAttribute('stroke', textOutline);
        text.setAttribute('stroke-width', '2.5');
        text.setAttribute('paint-order', 'stroke');
        text.setAttribute('font-family', 'Arial, sans-serif');
        text.setAttribute('font-size', '9');
        text.setAttribute('font-weight', '500');
        text.setAttribute('font-variant-numeric', 'tabular-nums');
        text.textContent = label;
        labels.appendChild(text);
        previousRightEdge = rightEdge;
      }

      svg.appendChild(labels);
    };

    const schedulePaint = () => {
      if (disposed || frame !== null) return;
      frame = window.requestAnimationFrame(paint);
    };
    schedulePaintRef.current = schedulePaint;

    const resizeObserver = new ResizeObserver(schedulePaint);
    resizeObserver.observe(host);
    timeScale.subscribeVisibleLogicalRangeChange(schedulePaint);
    timeScale.subscribeSizeChange(schedulePaint);
    series.subscribeDataChanged(schedulePaint);
    // Price-axis dragging changes label Y coordinates without changing the
    // visible time range.
    host.addEventListener('pointermove', schedulePaint, { passive: true });
    host.addEventListener('wheel', schedulePaint, { passive: true });
    schedulePaint();

    return () => {
      disposed = true;
      schedulePaintRef.current = null;
      resizeObserver.disconnect();
      timeScale.unsubscribeVisibleLogicalRangeChange(schedulePaint);
      timeScale.unsubscribeSizeChange(schedulePaint);
      series.unsubscribeDataChanged(schedulePaint);
      host.removeEventListener('pointermove', schedulePaint);
      host.removeEventListener('wheel', schedulePaint);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
    };
  }, [chart, series]);

  useEffect(() => {
    schedulePaintRef.current?.();
  }, [
    candles,
    interval,
    sessionStartMs,
    sessionEndMs,
    every,
    themeMode,
    isLogScale,
  ]);

  return (
    <svg
      ref={svgRef}
      className="bar-count-overlay"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 3,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    />
  );
}

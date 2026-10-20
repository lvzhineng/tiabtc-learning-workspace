import { useEffect, useRef } from 'react';
import type { Candlestick } from '@/domain/candle';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

interface CandleCountdownOverlayProps {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  candle: Candlestick;
  remainingMs: number;
  themeMode: 'dark' | 'light';
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatRemainingTime(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  if (days > 0) {
    return `${days}天 ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  }
  if (totalHours > 0) {
    return `${pad2(totalHours)}:${pad2(minutes)}:${pad2(seconds)}`;
  }
  return `${pad2(totalMinutes)}:${pad2(seconds)}`;
}

/** Shows replay-time remaining duration beside the current price scale. */
export function CandleCountdownOverlay({
  chart,
  series,
  candle,
  remainingMs,
  themeMode,
}: CandleCountdownOverlayProps) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const candleRef = useRef(candle);
  candleRef.current = candle;

  useEffect(() => {
    const label = labelRef.current;
    const host = label?.parentElement;
    if (!label || !host) return;

    let frame: number | null = null;
    const updatePosition = () => {
      frame = null;
      const currentLabel = labelRef.current;
      if (!currentLabel) return;

      const priceY = series.priceToCoordinate(candleRef.current.close);
      const paneHeight = chart.paneSize().height;
      const hostWidth = host.clientWidth;
      if (
        priceY === null ||
        !Number.isFinite(priceY) ||
        paneHeight <= 0 ||
        hostWidth <= 0 ||
        priceY < 0 ||
        priceY > paneHeight
      ) {
        currentLabel.style.visibility = 'hidden';
        return;
      }

      const labelWidth = currentLabel.offsetWidth;
      const labelHeight = currentLabel.offsetHeight;
      const priceScaleLeft = chart.timeScale().width();
      const left = Math.min(
        priceScaleLeft + 4,
        hostWidth - labelWidth - 2
      );
      const top = Math.min(
        paneHeight - labelHeight - 2,
        Math.max(2, priceY + 12)
      );
      currentLabel.style.left = `${Math.max(0, left)}px`;
      currentLabel.style.top = `${Math.max(0, top)}px`;
      currentLabel.style.visibility = 'visible';
    };
    const schedulePositionUpdate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(updatePosition);
    };
    const resizeObserver = new ResizeObserver(schedulePositionUpdate);

    resizeObserver.observe(host);
    chart.timeScale().subscribeVisibleLogicalRangeChange(schedulePositionUpdate);
    chart.timeScale().subscribeSizeChange(schedulePositionUpdate);
    series.subscribeDataChanged(schedulePositionUpdate);
    // Price-axis dragging changes the vertical coordinate without emitting a
    // time-scale event, so pointer movement also refreshes the anchor.
    host.addEventListener('pointermove', schedulePositionUpdate, {
      passive: true,
    });
    host.addEventListener('wheel', schedulePositionUpdate, { passive: true });
    schedulePositionUpdate();

    return () => {
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(
        schedulePositionUpdate
      );
      chart.timeScale().unsubscribeSizeChange(schedulePositionUpdate);
      series.unsubscribeDataChanged(schedulePositionUpdate);
      host.removeEventListener('pointermove', schedulePositionUpdate);
      host.removeEventListener('wheel', schedulePositionUpdate);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [chart, series, candle.close, remainingMs]);

  const isUpCandle = candle.close >= candle.open;
  const color = isUpCandle ? '#089981' : '#f23645';

  return (
    <span
      ref={labelRef}
      title="按复盘时间计算距当前周期收盘"
      aria-label={`距当前周期收盘 ${formatRemainingTime(remainingMs)}`}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        zIndex: 5,
        visibility: 'hidden',
        padding: '0 5px',
        borderRadius: 2,
        background: color,
        boxShadow:
          themeMode === 'light'
            ? '0 1px 3px rgba(15, 23, 42, 0.18)'
            : '0 1px 3px rgba(0, 0, 0, 0.35)',
        color: '#ffffff',
        fontFamily: 'inherit',
        fontSize: 10,
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: '18px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}
    >
      {formatRemainingTime(remainingMs)}
    </span>
  );
}

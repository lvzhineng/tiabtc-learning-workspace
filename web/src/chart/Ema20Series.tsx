import { useEffect, useRef, type RefObject } from 'react';
import type { IChartApi, ISeriesApi, LineData, AutoscaleInfo } from 'lightweight-charts';
import type { Candlestick } from '@/domain/candle';
import { timestampMsToUtcTimestamp } from './chart-time';
import { calculateEma, type EmaPoint } from './ema';

type Props = {
  chart: IChartApi; chartOwner: RefObject<IChartApi | null>;
  candles: Candlestick[]; contextKey: string;
  excludeFromAutoscale?: boolean;
};
export function Ema20Series({ chart, chartOwner, candles, contextKey, excludeFromAutoscale = false }: Props) {
  const lineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const previousRef = useRef<{ key: string; candles: Candlestick[]; points: EmaPoint[] } | null>(null);
  const excludeFromAutoscaleRef = useRef(excludeFromAutoscale);
  excludeFromAutoscaleRef.current = excludeFromAutoscale;

  useEffect(() => {
    const line = chart.addLineSeries({
      color: '#f59e0b', lineWidth: 2, title: 'EMA20',
      priceScaleId: 'right', priceLineVisible: false,
      lastValueVisible: false, crosshairMarkerVisible: false,
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => excludeFromAutoscaleRef.current ? null : base(),
    });
    lineRef.current = line;
    previousRef.current = null;
    return () => {
      lineRef.current = null;
      previousRef.current = null;
      // The parent removes the entire chart first when its workspace unmounts.
      if (chartOwner.current === chart) chart.removeSeries(line);
    };
  }, [chart, chartOwner]);

  useEffect(() => { lineRef.current?.applyOptions({}); }, [excludeFromAutoscale]);

  useEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    const previous = previousRef.current;
    const canAppend = previous && previous.key === contextKey && previous.candles.length > 0 &&
      candles.length > previous.candles.length && candles[0] === previous.candles[0] &&
      candles[previous.candles.length - 1] === previous.candles[previous.candles.length - 1];
    let points: EmaPoint[];
    if (canAppend) {
      points = previous.points;
      let value = points[points.length - 1].value;
      for (let index = previous.candles.length; index < candles.length; index += 1) {
        value += (2 / 21) * (candles[index].close - value);
        const point = { timestampMs: candles[index].timestampMs, value };
        points.push(point);
        line.update({ time: timestampMsToUtcTimestamp(point.timestampMs), value });
      }
    } else {
      // Rewind, interval/symbol changes and historical replacements recalculate
      // from the currently visible candles, never the hidden replay buffer.
      points = calculateEma(candles);
      line.setData(points.map((point): LineData => ({
        time: timestampMsToUtcTimestamp(point.timestampMs), value: point.value,
      })));
    }
    previousRef.current = { key: contextKey, candles, points };
    // Only ChartCanvas restores the viewport. In StrictMode this effect runs
    // again before its pending range is applied; restoring the old EMA range
    // here would overwrite the main chart's initial focus with right alignment.
  }, [chart, candles, contextKey]);

  return <span aria-label="EMA20 指数移动平均线" style={{
    position: 'absolute', left: 12, top: 8, zIndex: 3, pointerEvents: 'none',
    color: '#f59e0b', fontSize: 11,
  }}>EMA20</span>;
}

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { AutoscaleInfo, IChartApi, ISeriesApi, LineData, MouseEventParams, Time } from 'lightweight-charts';
import type { Candlestick } from '@/domain/candle';
import { candlePriceFormat, candlePricePrecision } from './chart-price';
import { timestampMsToUtcTimestamp, utcTimestampToTimestampMs } from './chart-time';
import { calculateEma, EMA_COLORS, EMA_PERIODS, type EmaPeriod } from './ema';
import { loadEmaPreferences, saveEmaPreferences, type IndicatorScope } from './ema-preferences';
import { EmaIndicatorLegend } from './EmaIndicatorLegend';

type RecordState = { line: ISeriesApi<'Line'>; values: Map<number, number>; last: number | null };
type Values = Record<EmaPeriod, number | null>;
const emptyValues = (): Values => ({ 20: null, 60: null, 120: null });
const EMPTY_CANDLES: Candlestick[] = [];

export function EmaIndicators({ chart, chartOwner, candles, contextKey, scope,
  warmupCandles = EMPTY_CANDLES, ready = true, loading = false, warning, pricePrecision,
  excludeFromAutoscale = false,
}: {
  chart: IChartApi; chartOwner: RefObject<IChartApi | null>; candles: Candlestick[];
  contextKey: string; scope: IndicatorScope; warmupCandles?: Candlestick[];
  ready?: boolean; loading?: boolean; warning?: string | null; pricePrecision?: number;
  excludeFromAutoscale?: boolean;
}) {
  const [preferences, setPreferences] = useState(() => loadEmaPreferences(scope));
  const [values, setValues] = useState<Values>(emptyValues);
  const effectivePrecision = useMemo(() => pricePrecision ?? candlePricePrecision(candles), [pricePrecision, candles]);
  const recordsRef = useRef(new Map<EmaPeriod, RecordState>());
  const hoverTimeRef = useRef<number | null>(null);
  const excludeRef = useRef(excludeFromAutoscale);
  excludeRef.current = excludeFromAutoscale;
  const previousRef = useRef<{ key: string; candles: Candlestick[]; warmup: Candlestick[] } | null>(null);

  const refreshValuesRef = useRef(() => {});
  refreshValuesRef.current = () => {
    const next = emptyValues();
    for (const period of EMA_PERIODS) {
      const record = recordsRef.current.get(period);
      next[period] = record ? hoverTimeRef.current === null ? record.last
        : record.values.get(hoverTimeRef.current) ?? null : null;
    }
    setValues((previous) => EMA_PERIODS.every((period) => previous[period] === next[period]) ? previous : next);
  };

  useEffect(() => { saveEmaPreferences(scope, preferences); }, [scope, preferences]);

  useEffect(() => {
    const records = new Map<EmaPeriod, RecordState>();
    for (const period of EMA_PERIODS) {
      const line = chart.addLineSeries({
        color: EMA_COLORS[period], lineWidth: 2, title: `EMA ${period}`,
        priceScaleId: 'right', priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false, visible: false,
        autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => excludeRef.current ? null : base(),
      });
      records.set(period, { line, values: new Map(), last: null });
    }
    recordsRef.current = records;
    previousRef.current = null;
    const handleCrosshair = (event: MouseEventParams<Time>) => {
      hoverTimeRef.current = event.point && typeof event.time === 'number'
        ? utcTimestampToTimestampMs(event.time) : null;
      refreshValuesRef.current();
    };
    chart.subscribeCrosshairMove(handleCrosshair);
    return () => {
      recordsRef.current = new Map();
      previousRef.current = null;
      if (chartOwner.current === chart) {
        chart.unsubscribeCrosshairMove(handleCrosshair);
        for (const record of records.values()) chart.removeSeries(record.line);
      }
    };
  }, [chart, chartOwner]);

  useEffect(() => {
    for (const period of EMA_PERIODS) recordsRef.current.get(period)?.line.applyOptions({
      visible: ready && preferences.visibility[period],
      ...(candles.length ? { priceFormat: candlePriceFormat(candles, effectivePrecision) } : {}),
    });
  }, [chart, ready, preferences.visibility, candles, effectivePrecision, excludeFromAutoscale]);

  useEffect(() => {
    const previous = previousRef.current;
    if (previous?.key !== contextKey) hoverTimeRef.current = null;
    const canAppend = previous && previous.key === contextKey && previous.warmup === warmupCandles &&
      previous.candles.length > 0 && candles.length > previous.candles.length &&
      candles[0] === previous.candles[0] &&
      candles[previous.candles.length - 1] === previous.candles[previous.candles.length - 1] &&
      previous.candles.every((bar, index) => candles[index] === bar);
    // Seed from closed history preceding the plotted sequence. Warmup values
    // never add timestamps to the chart or reveal the replay's future buffer.
    const warmup = candles.length ? warmupCandles.filter((bar) => bar.timestampMs < candles[0].timestampMs) : EMPTY_CANDLES;
    for (const period of EMA_PERIODS) {
      const record = recordsRef.current.get(period);
      if (!record) continue;
      if (canAppend && record.last !== null) {
        let value = record.last;
        for (let index = previous.candles.length; index < candles.length; index++) {
          value += (2 / (period + 1)) * (candles[index].close - value);
          record.values.set(candles[index].timestampMs, value);
          record.line.update({ time: timestampMsToUtcTimestamp(candles[index].timestampMs), value });
        }
        record.last = value;
      } else {
        const seed = calculateEma(warmup, period).at(-1)?.value;
        const points = calculateEma(candles, period, seed);
        record.values = new Map(points.map((point) => [point.timestampMs, point.value]));
        record.last = points.at(-1)?.value ?? null;
        record.line.setData(points.map((point): LineData => ({ time: timestampMsToUtcTimestamp(point.timestampMs), value: point.value })));
      }
    }
    previousRef.current = { key: contextKey, candles, warmup: warmupCandles };
    refreshValuesRef.current();
  }, [chart, candles, contextKey, warmupCandles]);

  const hiddenWarmupCount = useMemo(() => candles.length
    ? warmupCandles.filter((bar) => bar.timestampMs < candles[0].timestampMs).length : 0, [warmupCandles, candles]);
  return <EmaIndicatorLegend visibility={preferences.visibility} values={ready ? values : emptyValues()}
    precision={effectivePrecision} collapsed={preferences.collapsed} loading={loading} warning={warning}
    warmupCount={hiddenWarmupCount + candles.length}
    onToggle={(period) => setPreferences((current) => ({ ...current, visibility: { ...current.visibility, [period]: !current.visibility[period] } }))}
    onToggleAll={() => setPreferences((current) => {
      const visible = !EMA_PERIODS.every((period) => current.visibility[period]);
      return { ...current, visibility: { 20: visible, 60: visible, 120: visible } };
    })}
    onToggleCollapsed={() => setPreferences((current) => ({ ...current, collapsed: !current.collapsed }))} />;
}

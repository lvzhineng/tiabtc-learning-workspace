import { useEffect, useMemo, useState } from 'react';
import { fetchUsSessionCandles } from '@/api/cfd-api';
import { isCompleteMinuteSession, type Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { aggregateUsSession } from '@/features/replay/us-day-replay';
import { getPreviousUsEquitySession } from '@/features/replay/us-equity-session';

const EMPTY_CANDLES: Candlestick[] = [];
type Result = { key: string; candles: Candlestick[]; warning: string | null };

/** One previous trading session, loaded independently so today's replay can start immediately. */
export function usePreviousDayCandles(symbol: string, interval: ReviewTimeframe, date: string | null, enabled: boolean) {
  const session = useMemo(() => date ? getPreviousUsEquitySession(date) : null, [date]);
  const key = session ? `${symbol}:${session.date}` : null;
  const [result, setResult] = useState<Result | null>(null);
  const [emaResult, setEmaResult] = useState<Result | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!enabled || !key || !session) return;
    const controller = new AbortController();
    void fetchUsSessionCandles(symbol, session.fromMs, session.toMs, controller.signal).then((batch) => {
      if (controller.signal.aborted) return;
      const complete = isCompleteMinuteSession(batch.candles, session);
      const warning = batch.warning || (!complete ? '前一交易日行情不完整，暂不显示前日K线、高低点与EMA。' : null);
      setResult({ key, candles: warning ? EMPTY_CANDLES : batch.candles, warning });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setResult({ key, candles: EMPTY_CANDLES,
        warning: `前日行情加载失败：${cause instanceof Error ? cause.message : '请重试'}` });
    });
    return () => controller.abort();
  }, [enabled, key, session, symbol, retryToken]);

  const current = key && result?.key === key ? result : null;
  const candles = useMemo(() => aggregateUsSession(current?.candles ?? EMPTY_CANDLES, interval), [current, interval]);
  const emaKey = key ? `${key}:${interval}` : null;
  useEffect(() => {
    if (!enabled || !emaKey || !session || !current || current.warning) return;
    const controller = new AbortController();
    let history = candles;
    void (async () => {
      let date = session.date;
      let warning: string | null = null;
      // Long EMAs need 120 bars of the selected timeframe, including shortened
      // sessions. Never use overnight quotes or this replay day's future bars.
      for (let sessions = 1; history.length < 120 && sessions < 10; sessions++) {
        const previous = getPreviousUsEquitySession(date);
        if (!previous) break;
        const batch = await fetchUsSessionCandles(symbol, previous.fromMs, previous.toMs, controller.signal);
        if (controller.signal.aborted) return;
        if (batch.warning || !isCompleteMinuteSession(batch.candles, previous)) {
          warning = '较早交易日行情不完整，部分长周期 EMA 预热不足；可重试加载。';
          break;
        }
        history = [...aggregateUsSession(batch.candles, interval), ...history];
        date = previous.date;
      }
      if (!controller.signal.aborted) setEmaResult({ key: emaKey, candles: history.slice(-120),
        warning: warning || (history.length < 120 ? '已有历史不足120根，长周期 EMA 仍在预热。' : null) });
    })().catch((cause: unknown) => {
      if (!controller.signal.aborted) setEmaResult({ key: emaKey, candles: history.slice(-120),
        warning: `EMA 预热历史加载失败：${cause instanceof Error ? cause.message : '请重试'}` });
    });
    return () => controller.abort();
  }, [enabled, emaKey, session, current, candles, interval, symbol]);

  const emaCurrent = emaKey && emaResult?.key === emaKey ? emaResult : null;
  return { candles, loading: Boolean(key && !current), warning: current?.warning ?? null,
    emaCandles: emaCurrent?.candles ?? EMPTY_CANDLES,
    emaLoading: Boolean(key && (!current || (!current.warning && !emaCurrent))),
    emaWarning: emaCurrent?.warning ?? null,
    retry: () => { setResult(null); setEmaResult(null); setRetryToken((value) => value + 1); } };
}

import { useEffect, useState } from 'react';
import { fetchChartFlow, type ChartCvdPoint, type ChartFlowPoint } from '@/api/market-api';
import type { ReviewTimeframe } from '@/domain/timeframe';

const WARMING_POLL_MS = 10_000;

export type ChartFlowData = {
  oiPoints: ChartFlowPoint[];
  cvdPoints: ChartCvdPoint[];
  warming: boolean;
  warning: string | null;
};

const EMPTY_FLOW: ChartFlowData = {
  oiPoints: [],
  cvdPoints: [],
  warming: false,
  warning: null,
};

export function useChartFlowData(
  enabled: boolean,
  symbol: string,
  interval: ReviewTimeframe,
  fromMs: number | null,
  toMs: number | null
): ChartFlowData {
  const [flow, setFlow] = useState<ChartFlowData>(EMPTY_FLOW);

  useEffect(() => {
    if (
      !enabled ||
      fromMs == null ||
      toMs == null ||
      fromMs <= 0 ||
      toMs <= 0 ||
      fromMs > toMs
    ) {
      setFlow(EMPTY_FLOW);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    let pollTimer: number | null = null;

    const load = () => {
      void fetchChartFlow(symbol, interval, fromMs, toMs, controller.signal)
        .then((batch) => {
          if (cancelled || controller.signal.aborted) return;
          setFlow({
            oiPoints: batch.oi,
            cvdPoints: batch.cvd,
            warming: batch.warming,
            warning: batch.warning,
          });
          if (batch.warming && pollTimer === null) {
            pollTimer = window.setInterval(load, WARMING_POLL_MS);
          }
          if (!batch.warming && pollTimer !== null) {
            window.clearInterval(pollTimer);
            pollTimer = null;
          }
        })
        .catch((error) => {
          if (cancelled || controller.signal.aborted) return;
          setFlow({
            ...EMPTY_FLOW,
            warning:
              error instanceof Error ? error.message : '加载 OI/CVD 失败',
          });
        });
    };

    load();
    return () => {
      cancelled = true;
      controller.abort();
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
    };
  }, [enabled, fromMs, interval, symbol, toMs]);

  return enabled ? flow : EMPTY_FLOW;
}

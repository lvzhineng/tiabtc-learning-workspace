import { requestJson } from './http';
import { parseCandleRows, type RawCandle } from './candle-parser';
import type { CandleBatch } from './market-api';
import type { ReviewTimeframe } from '@/domain/timeframe';

export const CFD_SYMBOLS = [
  { symbol: 'XAUUSD', name: '黄金', quote: 'USD' },
  { symbol: 'NAS100', name: '纳斯达克100', quote: 'USD' },
  { symbol: 'JPN225', name: '日经225', quote: 'JPY' },
] as const;

type Response = {
  candles: Omit<RawCandle, 'volume'>[];
  volumeAvailable: false;
  source: 'gate-cfd';
  warning?: string | null;
};
const cache = new Map<string, { batch: CandleBatch; at: number }>();
const requests = new Map<string, Promise<CandleBatch>>();

export async function fetchCfdSymbols(): Promise<string[]> {
  const data = await requestJson<{ symbols: { symbol: string }[] }>('/api/cfd/symbols');
  return data.symbols.map((item) => item.symbol);
}

function waitForRequest(request: Promise<CandleBatch>, signal?: AbortSignal): Promise<CandleBatch> {
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(new DOMException('请求已取消', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('请求已取消', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    void request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function fetchCandles(symbol: string, interval: ReviewTimeframe, params: Record<string, string>, signal?: AbortSignal): Promise<CandleBatch> {
  const path = `/api/cfd/candles?${new URLSearchParams({ symbol, interval, ...params })}`;
  const cached = cache.get(path);
  if (cached && Date.now() - cached.at < 30_000) return waitForRequest(Promise.resolve(cached.batch), signal);
  let request = requests.get(path);
  if (!request) {
    request = requestJson<Response>(path).then((data) => {
      // ChartCanvas's shared OHLCV model needs a numeric volume. This adapter
      // placeholder is never displayed: CFD has no volume capability.
      const batch: CandleBatch = {
        candles: parseCandleRows(data.candles.map((row) => ({ ...row, volume: 0 })), symbol, interval),
        warning: data.warning || null,
      };
      if (!batch.warning) {
        cache.delete(path);
        cache.set(path, { batch, at: Date.now() });
        while (cache.size > 48) cache.delete(cache.keys().next().value!);
      }
      return batch;
    }).finally(() => requests.delete(path));
    requests.set(path, request);
  }
  return waitForRequest(request, signal);
}

export function fetchChartCandles(symbol: string, interval: ReviewTimeframe, anchor: number, signal?: AbortSignal): Promise<CandleBatch> {
  return fetchCandles(symbol, interval, { anchor: String(anchor) }, signal);
}
export function fetchEarlierCandles(symbol: string, interval: ReviewTimeframe, before: number, limit = 1000, signal?: AbortSignal): Promise<CandleBatch> {
  return fetchCandles(symbol, interval, { before: String(before), limit: String(limit) }, signal);
}
export function fetchLaterCandles(symbol: string, interval: ReviewTimeframe, after: number, limit = 1000, cutoff?: number, signal?: AbortSignal): Promise<CandleBatch> {
  return fetchCandles(symbol, interval, { after: String(after), limit: String(limit), ...(cutoff ? { cutoff: String(cutoff) } : {}) }, signal);
}
export function fetchReplayCandles(symbol: string, interval: ReviewTimeframe, replayCursor: number, limit = 500, signal?: AbortSignal): Promise<CandleBatch> {
  return fetchCandles(symbol, interval, { replayCursor: String(replayCursor), limit: String(limit) }, signal);
}

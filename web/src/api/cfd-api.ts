import { requestJson } from './http';
import { parseCandleRows, type RawCandle } from './candle-parser';
import type { CandleBatch } from './market-api';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { isCompleteMinuteSession } from '@/domain/candle';

export type CfdSymbol = {
  symbol: string;
  name: string;
  description?: string;
  categoryId: number;
  categoryName: string;
  pricePrecision?: number;
  status?: string;
  isBase?: boolean;
};

// Only a startup fallback; the picker uses the public Gate directory.
export const CFD_SYMBOLS: CfdSymbol[] = [
  { symbol: 'XAUUSD', name: '黄金', categoryId: 1, categoryName: '金属', isBase: true, pricePrecision: 2 },
  { symbol: 'XAGUSD', name: '白银', categoryId: 1, categoryName: '金属', isBase: true, pricePrecision: 3 },
  { symbol: 'NAS100', name: '纳斯达克100', categoryId: 3, categoryName: '指数', isBase: true, pricePrecision: 2 },
  { symbol: 'US500', name: '标普500', categoryId: 3, categoryName: '指数', isBase: true, pricePrecision: 2 },
  { symbol: 'JPN225', name: '日经225', categoryId: 3, categoryName: '指数', isBase: true, pricePrecision: 2 },
];

export function isCfdSymbol(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(value);
}

export type CfdCatalog = { symbols: CfdSymbol[]; warning: string | null; stale: boolean };
let catalogRequest: Promise<CfdCatalog> | null = null;

export function fetchCfdCatalog(refresh = false): Promise<CfdCatalog> {
  if (!catalogRequest) {
    catalogRequest = requestJson<{ symbols: unknown[]; warning?: string; stale?: boolean }>(
      `/api/cfd/symbols${refresh ? '?refresh=1' : ''}`
    ).then((data) => {
      if (!Array.isArray(data.symbols)) throw new Error('全球市场品种目录格式无效');
      const unique = new Map<string, CfdSymbol>();
      for (const raw of data.symbols) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        if (!isCfdSymbol(item.symbol)) continue;
        const preset = CFD_SYMBOLS.find((entry) => entry.symbol === item.symbol);
        unique.set(item.symbol, {
          symbol: item.symbol,
          name: typeof item.name === 'string' ? item.name : preset?.name ?? item.symbol,
          description: typeof item.description === 'string' ? item.description : undefined,
          categoryId: typeof item.categoryId === 'number' && Number.isInteger(item.categoryId) ? item.categoryId : preset?.categoryId ?? -1,
          categoryName: typeof item.categoryName === 'string' ? item.categoryName : preset?.categoryName ?? '其他',
          pricePrecision: typeof item.pricePrecision === 'number' && Number.isInteger(item.pricePrecision)
            && item.pricePrecision >= 0 && item.pricePrecision <= 8 ? item.pricePrecision : preset?.pricePrecision,
          status: typeof item.status === 'string' ? item.status : undefined,
          isBase: item.isBase !== false,
        });
      }
      if (!unique.size) throw new Error('全球市场品种目录为空');
      return { symbols: [...unique.values()], warning: data.warning || null, stale: data.stale === true };
    }).finally(() => { catalogRequest = null; });
  }
  return catalogRequest;
}

type Response = {
  candles: Omit<RawCandle, 'volume'>[];
  volumeAvailable: false;
  source: 'gate-cfd';
  warning?: string | null;
};
const cache = new Map<string, { batch: CandleBatch; at: number; ttlMs?: number }>();
const requests = new Map<string, Promise<CandleBatch>>();

export async function fetchCfdSymbols(): Promise<string[]> {
  const data = await fetchCfdCatalog();
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
  if (signal?.aborted) return Promise.reject(new DOMException('请求已取消', 'AbortError'));
  const path = `/api/cfd/candles?${new URLSearchParams({ symbol, interval, ...params })}`;
  const cached = cache.get(path);
  const cacheTtl = cached?.ttlMs ?? 30_000;
  if (cached && Date.now() - cached.at < cacheTtl) return waitForRequest(Promise.resolve(cached.batch), signal);
  let request = requests.get(path);
  if (!request) {
    request = requestJson<Response>(path).then((data) => {
      // ChartCanvas's shared OHLCV model needs a numeric volume. This adapter
      // placeholder is never displayed: CFD has no volume capability.
      const batch: CandleBatch = {
        candles: parseCandleRows(data.candles.map((row) => ({ ...row, volume: 0 })), symbol, interval),
        warning: data.warning || null,
      };
      const session = { fromMs: Number(params.after) + 1, toMs: Number(params.cutoff) };
      const sessionMinutes = (session.toMs - session.fromMs) / 60_000;
      const isSessionWindow = interval === '1' && params.limit === '500' && [210, 390].includes(sessionMinutes);
      const completeSession = isSessionWindow && session.toMs <= Date.now() &&
        isCompleteMinuteSession(batch.candles, session);
      // Never cache a partial session: the visible retry must reach the source.
      if (!batch.warning && (!isSessionWindow || completeSession)) {
        const ttlMs = completeSession ? 30 * 60_000 : 30_000;
        cache.delete(path);
        cache.set(path, { batch, at: Date.now(), ttlMs });
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

/** Fetch exactly one closed US regular session; never extend into the next day. */
export async function fetchUsSessionCandles(symbol: string, fromMs: number, toMs: number, signal?: AbortSignal): Promise<CandleBatch> {
  const batch = await fetchLaterCandles(symbol, '1', fromMs - 1, 500, toMs, signal);
  return { ...batch, candles: batch.candles.filter((bar) =>
    bar.timestampMs >= fromMs && bar.timestampMs + 60_000 <= toMs) };
}

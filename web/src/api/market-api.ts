import { requestJson } from './http';
import type { Candlestick } from '@/domain/candle';
import { parseCandleRows, type RawCandle } from './candle-parser';
import {
  TIMEFRAME_SECONDS_MAP,
  type ReviewTimeframe,
} from '@/domain/timeframe';
import {
  rememberCandleWindow,
  sliceCachedCandleWindow,
  boundedTradeWindowMs,
  TRUNCATED_WINDOW_HINT,
} from './candle-window-cache';

type RawCandleResponse = {
  candles: RawCandle[];
  source?: 'sqlite' | 'bybit';
  coverage?: { first: number | null; last: number | null; count: number };
  warning?: string;
  error?: string;
  truncated?: boolean;
};

type RawSymbol = {
  symbol: string;
  name: string;
  custom?: boolean;
};

type SymbolsResponse = {
  symbols: RawSymbol[];
};

export type PerpetualSymbolSearchItem = RawSymbol & {
  base: string;
  quote: 'USDT';
  added: boolean;
};

export type PerpetualSymbolSearchResponse = {
  symbols: PerpetualSymbolSearchItem[];
  offlineMode: boolean;
  warning?: string;
};

export type CandleBatch = {
  candles: Candlestick[];
  warning: string | null;
  truncated?: boolean;
  coverage?: { first: number | null; last: number | null; count: number };
};

type ConfigResponse = {
  offlineMode: boolean;
};

const CANDLE_CACHE_MAX_ENTRIES = 48;
const LIVE_CANDLE_CACHE_TTL_MS = 30_000;
type CandleCacheEntry = {
  batch: CandleBatch;
  cachedAt: number;
};
const candleCache = new Map<string, CandleCacheEntry>();
const candleRequests = new Map<string, Promise<CandleBatch>>();

function rememberCandles(key: string, batch: CandleBatch): void {
  // An empty response can mean offline cache miss or that the next live bar is
  // not closed yet. Keeping it forever would hide data after either condition
  // changes.
  if (batch.candles.length === 0 || batch.warning) {
    candleCache.delete(key);
    return;
  }
  candleCache.delete(key);
  candleCache.set(key, { batch, cachedAt: Date.now() });
  while (candleCache.size > CANDLE_CACHE_MAX_ENTRIES) {
    const oldestKey = candleCache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    candleCache.delete(oldestKey);
  }
}

function waitForCandleRequest(
  request: Promise<CandleBatch>,
  signal?: AbortSignal
): Promise<CandleBatch> {
  if (!signal) return request;
  if (signal.aborted) {
    return Promise.reject(new DOMException('请求已取消', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('请求已取消', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    void request.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}

function requestCandles(
  path: string,
  symbol: string,
  interval: ReviewTimeframe,
  signal?: AbortSignal,
  cacheTtlMs = Number.POSITIVE_INFINITY
): Promise<CandleBatch> {
  const cached = candleCache.get(path);
  if (cached && Date.now() - cached.cachedAt <= cacheTtlMs) {
    candleCache.delete(path);
    candleCache.set(path, cached);
    return waitForCandleRequest(Promise.resolve(cached.batch), signal);
  }
  if (cached) {
    candleCache.delete(path);
  }

  let request = candleRequests.get(path);
  if (!request) {
    request = requestJson<RawCandleResponse>(path)
      .then((data) => {
        const truncated = Boolean(data.truncated);
        const warning =
          typeof data.warning === 'string' && data.warning.trim()
            ? data.warning.trim()
            : null;
        const batch = {
          candles: parseCandleRows(data.candles, symbol, interval),
          warning,
          truncated,
          coverage: data.coverage,
        } satisfies CandleBatch;
        rememberCandles(path, batch);
        return batch;
      })
      .finally(() => {
        candleRequests.delete(path);
      });
    candleRequests.set(path, request);
  }
  return waitForCandleRequest(request, signal);
}

export async function fetchSymbols(): Promise<string[]> {
  const data = await requestJson<SymbolsResponse>('/api/symbols');
  return (data.symbols || []).map((item) => item.symbol);
}

export async function addCustomSymbol(symbol: string): Promise<string> {
  const data = await requestJson<RawSymbol>('/api/symbols', {
    method: 'POST',
    body: JSON.stringify({ symbol }),
  });
  return data.symbol;
}

export async function searchPerpetualSymbols(
  query: string,
  signal?: AbortSignal,
  limit = 20
): Promise<PerpetualSymbolSearchResponse> {
  const params = new URLSearchParams({
    q: query,
    limit: limit.toString(),
  });
  return requestJson<PerpetualSymbolSearchResponse>(
    `/api/symbols/search?${params}`,
    { signal }
  );
}

export async function fetchChartConfig(): Promise<ConfigResponse> {
  return requestJson<ConfigResponse>('/api/chart/config');
}

export async function fetchChartCandles(
  symbol: string,
  interval: ReviewTimeframe,
  anchorTimeMs: number,
  signal?: AbortSignal
): Promise<CandleBatch> {
  const params = new URLSearchParams({
    symbol,
    interval,
    anchor: anchorTimeMs.toString(),
  });
  return requestCandles(
    `/api/chart/candles?${params}`,
    symbol,
    interval,
    signal,
    LIVE_CANDLE_CACHE_TTL_MS
  );
}

export async function fetchBitlangTradeCandles(
  symbol: string,
  interval: ReviewTimeframe,
  entryTimeMs: number,
  exitTimeMs: number,
  signal?: AbortSignal
): Promise<CandleBatch> {
  const window = boundedTradeWindowMs(entryTimeMs, exitTimeMs, interval);
  const cached = sliceCachedCandleWindow(
    'bitlang',
    symbol,
    interval,
    window.fromMs,
    window.toMs
  );
  if (cached) {
    return waitForCandleRequest(
      Promise.resolve({
        candles: cached.candles,
        warning: window.truncated ? TRUNCATED_WINDOW_HINT : null,
        truncated: window.truncated,
      }),
      signal
    );
  }
  const params = new URLSearchParams({
    symbol,
    interval,
    entry: entryTimeMs.toString(),
    exit: exitTimeMs.toString(),
  });
  const batch = await requestCandles(
    `/api/bitlang/candles?${params}`,
    symbol,
    interval,
    signal
  );
  if (!batch.warning) {
    rememberCandleWindow('bitlang', symbol, interval, batch.candles, 'bybit');
  }
  return {
    ...batch,
    warning:
      batch.warning || (batch.truncated ? TRUNCATED_WINDOW_HINT : null),
  };
}

export async function fetchBitlangEarlierCandles(
  symbol: string,
  interval: ReviewTimeframe,
  beforeMs: number,
  limit = 500,
  signal?: AbortSignal
): Promise<CandleBatch> {
  const intervalMs = TIMEFRAME_SECONDS_MAP[interval] * 1000;
  const exitTimeMs = beforeMs - intervalMs;
  const entryTimeMs = Math.max(
    1_230_768_000_000,
    exitTimeMs - intervalMs * limit
  );
  if (entryTimeMs >= exitTimeMs) return { candles: [], warning: null };
  const params = new URLSearchParams({
    symbol,
    interval,
    entry: entryTimeMs.toString(),
    exit: exitTimeMs.toString(),
  });
  const batch = await requestCandles(
    `/api/bitlang/candles?${params}`,
    symbol,
    interval,
    signal
  );
  if (!batch.warning) {
    rememberCandleWindow('bitlang', symbol, interval, batch.candles, 'bybit');
  }
  return batch;
}

export async function fetchBitlangLaterCandles(
  symbol: string,
  interval: ReviewTimeframe,
  afterMs: number,
  limit = 500,
  signal?: AbortSignal
): Promise<CandleBatch> {
  const intervalMs = TIMEFRAME_SECONDS_MAP[interval] * 1000;
  const entryTimeMs = afterMs + intervalMs;
  const exitTimeMs = Math.min(
    Date.now(),
    entryTimeMs + intervalMs * limit
  );
  if (entryTimeMs >= exitTimeMs) return { candles: [], warning: null };
  const params = new URLSearchParams({
    symbol,
    interval,
    entry: entryTimeMs.toString(),
    exit: exitTimeMs.toString(),
  });
  const batch = await requestCandles(
    `/api/bitlang/candles?${params}`,
    symbol,
    interval,
    signal
  );
  if (!batch.warning) {
    rememberCandleWindow('bitlang', symbol, interval, batch.candles, 'bybit');
  }
  return batch;
}

export async function fetchEarlierCandles(
  symbol: string,
  interval: ReviewTimeframe,
  beforeMs: number,
  limit = 1000,
  signal?: AbortSignal
): Promise<CandleBatch> {
  const params = new URLSearchParams({
    symbol,
    interval,
    before: beforeMs.toString(),
    limit: limit.toString(),
  });
  return requestCandles(`/api/chart/candles?${params}`, symbol, interval, signal);
}

export async function fetchLaterCandles(
  symbol: string,
  interval: ReviewTimeframe,
  afterMs: number,
  limit = 1000,
  cutoffMs?: number,
  signal?: AbortSignal
): Promise<CandleBatch> {
  const params = new URLSearchParams({
    symbol,
    interval,
    after: afterMs.toString(),
    limit: limit.toString(),
  });
  if (cutoffMs) {
    params.set('cutoff', cutoffMs.toString());
  }
  return requestCandles(
    `/api/chart/candles?${params}`,
    symbol,
    interval,
    signal,
    LIVE_CANDLE_CACHE_TTL_MS
  );
}

export async function fetchReplayCandles(
  symbol: string,
  interval: ReviewTimeframe,
  replayCursorMs: number,
  limit = 1000,
  signal?: AbortSignal
): Promise<CandleBatch> {
  const params = new URLSearchParams({
    symbol,
    interval,
    replayCursor: replayCursorMs.toString(),
    limit: limit.toString(),
  });
  // A replay window can include the live tail. Do not retain a partial response
  // forever when a background market refresh was still catching up.
  return requestCandles(
    `/api/chart/candles?${params}`,
    symbol,
    interval,
    signal,
    LIVE_CANDLE_CACHE_TTL_MS
  );
}
// Private account market requests intentionally live in position-review-api.ts.

import { requestJson } from './http';
import type { Candlestick } from '@/domain/candle';
import type { ReviewTimeframe } from '@/domain/timeframe';

type RawCandleTuple = [number, number, number, number, number, number];

type RawCandleResponse = {
  symbol: string;
  interval: string;
  candles: RawCandleTuple[];
  error?: string;
};

type SymbolsResponse = {
  symbols: string[];
};

type ConfigResponse = {
  offlineMode: boolean;
};

function parseRawCandles(response: RawCandleResponse): Candlestick[] {
  if (!response.candles || !Array.isArray(response.candles)) {
    return [];
  }
  return response.candles.map(([ts, open, high, low, close, volume]) => ({
    symbol: response.symbol,
    interval: response.interval as ReviewTimeframe,
    timestampMs: ts,
    open,
    high,
    low,
    close,
    volume,
  }));
}

export async function fetchSymbols(): Promise<string[]> {
  const data = await requestJson<SymbolsResponse>('/api/symbols');
  return data.symbols || [];
}

export async function addCustomSymbol(symbol: string): Promise<string[]> {
  const data = await requestJson<SymbolsResponse>('/api/symbols', {
    method: 'POST',
    body: JSON.stringify({ symbol }),
  });
  return data.symbols || [];
}

export async function fetchChartConfig(): Promise<ConfigResponse> {
  return requestJson<ConfigResponse>('/api/chart/config');
}

export async function updateChartConfig(config: { offlineMode: boolean }): Promise<ConfigResponse> {
  return requestJson<ConfigResponse>('/api/chart/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export async function fetchChartCandles(
  symbol: string,
  interval: ReviewTimeframe,
  anchorTimeMs: number,
  signal?: AbortSignal
): Promise<Candlestick[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    anchor: anchorTimeMs.toString(),
  });
  const data = await requestJson<RawCandleResponse>(`/api/chart/candles?${params}`, { signal });
  return parseRawCandles(data);
}

export async function fetchEarlierCandles(
  symbol: string,
  interval: ReviewTimeframe,
  beforeMs: number,
  limit = 1000,
  signal?: AbortSignal
): Promise<Candlestick[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    before: beforeMs.toString(),
    limit: limit.toString(),
  });
  const data = await requestJson<RawCandleResponse>(`/api/chart/candles?${params}`, { signal });
  return parseRawCandles(data);
}

export async function fetchLaterCandles(
  symbol: string,
  interval: ReviewTimeframe,
  afterMs: number,
  limit = 1000,
  cutoffMs?: number,
  signal?: AbortSignal
): Promise<Candlestick[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    after: afterMs.toString(),
    limit: limit.toString(),
  });
  if (cutoffMs) {
    params.set('cutoff', cutoffMs.toString());
  }
  const data = await requestJson<RawCandleResponse>(`/api/chart/candles?${params}`, { signal });
  return parseRawCandles(data);
}

export async function fetchReplayCandles(
  symbol: string,
  interval: ReviewTimeframe,
  replayCursorMs: number,
  limit = 1000,
  signal?: AbortSignal
): Promise<Candlestick[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    replayCursor: replayCursorMs.toString(),
    limit: limit.toString(),
  });
  const data = await requestJson<RawCandleResponse>(`/api/chart/candles?${params}`, { signal });
  return parseRawCandles(data);
}

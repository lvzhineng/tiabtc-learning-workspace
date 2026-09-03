import type { Candlestick } from '@/domain/candle';
import {
  TIMEFRAME_SECONDS_MAP,
  type ReviewTimeframe,
} from '@/domain/timeframe';

export const MAX_CANDLES_PER_WINDOW = 3000;
export const TRUNCATED_WINDOW_HINT =
  '持仓跨度超过单次 K 线上限，已截取开仓附近窗口，可左右拖动加载';

const MAX_SHARDS = 48;
const MAX_CANDLES_PER_SHARD = 4000;

type Shard = {
  key: string;
  candles: Candlestick[];
  venue: string | null;
};

const shardCache = new Map<number, Shard>();
let nextShardId = 1;

function seriesKey(
  source: string,
  symbol: string,
  interval: ReviewTimeframe,
  venue?: string | null
): string {
  if (source === 'position') {
    const candleVenue = (venue || 'bybit').toLowerCase();
    return `${source}:${candleVenue}:${symbol}:${interval}`;
  }
  return `${source}:${symbol}:${interval}`;
}

export function positionCandleCacheVenue(
  symbol: string,
  positionVenue?: string | null
): string {
  const compact = String(symbol || '').trim().toUpperCase();
  if (compact === 'BTCUSDT' || compact === 'ETHUSDT') return 'bybit';
  const venue = String(positionVenue || '').trim().toLowerCase();
  if (venue === 'bitget' || venue === 'gate') return venue;
  return 'bybit';
}

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

function mergeCandles(
  current: Candlestick[],
  incoming: Candlestick[]
): Candlestick[] {
  if (!incoming.length) return current;
  if (!current.length) return incoming.slice();
  const merged = new Map(current.map((candle) => [candle.timestampMs, candle]));
  for (const candle of incoming) {
    merged.set(candle.timestampMs, candle);
  }
  return [...merged.values()].sort(
    (left, right) => left.timestampMs - right.timestampMs
  );
}

function splitIntoShards(candles: Candlestick[]): Candlestick[][] {
  if (candles.length <= MAX_CANDLES_PER_SHARD) return [candles];
  const parts: Candlestick[][] = [];
  for (let index = 0; index < candles.length; index += MAX_CANDLES_PER_SHARD) {
    parts.push(candles.slice(index, index + MAX_CANDLES_PER_SHARD));
  }
  return parts;
}

function overlappingShardIds(key: string, incoming: Candlestick[]): number[] {
  if (!incoming.length) return [];
  const fromMs = incoming[0].timestampMs;
  const toMs = incoming[incoming.length - 1].timestampMs;
  const ids: number[] = [];
  for (const [id, shard] of shardCache) {
    if (shard.key !== key || shard.candles.length === 0) continue;
    const shardFrom = shard.candles[0].timestampMs;
    const shardTo = shard.candles[shard.candles.length - 1].timestampMs;
    if (shardTo < fromMs || shardFrom > toMs) continue;
    ids.push(id);
  }
  return ids;
}

function evictOldestShards(): void {
  while (shardCache.size > MAX_SHARDS) {
    const oldestId = shardCache.keys().next().value;
    if (typeof oldestId !== 'number') break;
    shardCache.delete(oldestId);
  }
}

function insertShard(shard: Shard): void {
  const id = nextShardId;
  nextShardId += 1;
  shardCache.set(id, shard);
}

export function boundedTradeWindowMs(
  entryMs: number,
  exitMs: number,
  interval: ReviewTimeframe,
  nowMs = Date.now()
): { fromMs: number; toMs: number; truncated: boolean } {
  const intervalMs = TIMEFRAME_SECONDS_MAP[interval] * 1000;
  const cappedExit = Math.min(exitMs, nowMs);
  const holdingBars = Math.max(
    1,
    Math.ceil((cappedExit - entryMs) / intervalMs)
  );
  const paddingBars = holdingBars < 400 ? 200 : 50;
  const start = entryMs - intervalMs * paddingBars;
  const end = Math.min(nowMs, cappedExit + intervalMs * paddingBars);
  const spanBars = Math.max(1, Math.ceil((end - start) / intervalMs) + 1);
  if (spanBars <= MAX_CANDLES_PER_WINDOW) {
    return { fromMs: start, toMs: end, truncated: false };
  }
  const pad = Math.min(paddingBars, 40);
  const fromMs = entryMs - intervalMs * pad;
  const toMs = Math.min(
    nowMs,
    fromMs + intervalMs * (MAX_CANDLES_PER_WINDOW - 1)
  );
  return { fromMs, toMs, truncated: true };
}

export function clipTradeFocusRange(
  entryMs: number,
  exitMs: number,
  candles: Candlestick[],
  interval: ReviewTimeframe
): { from: number; to: number } | null {
  if (!candles.length) return null;
  const intervalMs = TIMEFRAME_SECONDS_MAP[interval] * 1000;
  const coveredFrom = candles[0].timestampMs;
  const coveredTo = candles[candles.length - 1].timestampMs + intervalMs;
  const from = Math.max(entryMs, coveredFrom);
  const to = Math.min(exitMs, coveredTo);
  if (from >= to) return { from: coveredFrom, to: coveredTo };
  return { from, to };
}

export function rememberCandleWindow(
  source: string,
  symbol: string,
  interval: ReviewTimeframe,
  incoming: Candlestick[],
  venue?: string | null
): void {
  if (!incoming.length) return;
  const key = seriesKey(source, symbol, interval, venue);
  const overlapIds = overlappingShardIds(key, incoming);
  let combined = incoming.slice();
  let combinedVenue = venue ?? null;
  for (const id of overlapIds) {
    const shard = shardCache.get(id);
    if (!shard) continue;
    combined = mergeCandles(shard.candles, combined);
    combinedVenue = venue ?? shard.venue ?? combinedVenue;
  }
  for (const id of overlapIds) {
    shardCache.delete(id);
  }
  for (const part of splitIntoShards(combined)) {
    insertShard({
      key,
      candles: part,
      venue: combinedVenue,
    });
  }
  evictOldestShards();
}

export function sliceCachedCandleWindow(
  source: string,
  symbol: string,
  interval: ReviewTimeframe,
  fromMs: number,
  toMs: number,
  padBars = 200,
  venue?: string | null
): { candles: Candlestick[]; venue: string | null } | null {
  const key = seriesKey(source, symbol, interval, venue);
  const intervalMs = TIMEFRAME_SECONDS_MAP[interval] * 1000;
  const start = fromMs - intervalMs * padBars;
  const end = toMs + intervalMs * padBars;
  const matching: Shard[] = [];
  const matchingIds: number[] = [];
  for (const [id, shard] of shardCache) {
    if (shard.key !== key || shard.candles.length === 0) continue;
    const shardFrom = shard.candles[0].timestampMs;
    const shardTo = shard.candles[shard.candles.length - 1].timestampMs;
    if (shardTo < start || shardFrom > end) continue;
    matching.push(shard);
    matchingIds.push(id);
  }
  if (!matching.length) return null;

  let merged: Candlestick[] = [];
  let resolvedVenue: string | null = null;
  for (const shard of matching) {
    merged = mergeCandles(merged, shard.candles);
    resolvedVenue = resolvedVenue ?? shard.venue;
  }
  if (!merged.length) return null;

  if (merged[0].timestampMs > fromMs) return null;
  if (merged[merged.length - 1].timestampMs + intervalMs < toMs) return null;

  const firstAtOrAfterFrom = lowerBound(merged, fromMs);
  const coverageStart = Math.max(0, firstAtOrAfterFrom - 1);
  const firstAtOrAfterTo = lowerBound(merged, toMs);
  const coverageEnd = Math.min(merged.length - 1, firstAtOrAfterTo);
  for (let index = coverageStart + 1; index <= coverageEnd; index += 1) {
    if (merged[index].timestampMs - merged[index - 1].timestampMs > intervalMs) {
      return null;
    }
  }

  const sliceStart = lowerBound(merged, start);
  const sliceEnd = lowerBound(merged, end + 1);
  const sliced = merged.slice(sliceStart, sliceEnd);
  if (!sliced.length) return null;
  for (const id of matchingIds) {
    const shard = shardCache.get(id);
    if (!shard) continue;
    shardCache.delete(id);
    shardCache.set(id, shard);
  }
  return { candles: sliced, venue: resolvedVenue };
}

export function candleVenueLabel(venue: string | null | undefined): string {
  if (venue === 'bitget') return 'K 线来源 Bitget';
  if (venue === 'gate') return 'K 线来源 Gate';
  return 'K 线来源 Bybit';
}

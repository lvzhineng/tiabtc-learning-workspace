import type { ReviewTimeframe } from '@/domain/timeframe';
import { REVIEW_TIMEFRAMES } from '@/domain/timeframe';
import { readLocalUiState, writeLocalUiState } from '@/ui/persistence/local-ui-state';

export type ReplayBookmark = { symbol: string; timeframe: ReviewTimeframe; timestampMs: number };
export const MAX_REPLAY_BOOKMARKS = 100;
const key = (market: 'perpetual' | 'cfd') => `tiabtc-${market}-replay-bookmarks-v1`;

export function loadReplayBookmarks(market: 'perpetual' | 'cfd'): ReplayBookmark[] {
  const saved = readLocalUiState(key(market)).bookmarks;
  if (!Array.isArray(saved)) return [];
  return saved.filter((item): item is ReplayBookmark => {
    if (!item || typeof item !== 'object') return false;
    const symbolValid = market === 'cfd'
      ? ['XAUUSD', 'NAS100', 'JPN225'].includes(item.symbol)
      : typeof item.symbol === 'string' && /^[A-Z0-9]{1,24}USDT$/.test(item.symbol);
    return symbolValid && REVIEW_TIMEFRAMES.includes(item.timeframe) && Number.isFinite(item.timestampMs)
      && item.timestampMs >= 1_500_000_000_000 && item.timestampMs <= Date.now();
  }).slice(-MAX_REPLAY_BOOKMARKS).map(({ symbol, timeframe, timestampMs }) => ({ symbol, timeframe, timestampMs }));
}

export function addReplayBookmark(current: ReplayBookmark[], bookmark: ReplayBookmark): ReplayBookmark[] {
  return [...current.filter((item) => item.symbol !== bookmark.symbol || item.timeframe !== bookmark.timeframe
    || item.timestampMs !== bookmark.timestampMs), bookmark].slice(-MAX_REPLAY_BOOKMARKS);
}

export function saveReplayBookmarks(market: 'perpetual' | 'cfd', bookmarks: ReplayBookmark[]): void {
  writeLocalUiState(key(market), { bookmarks: bookmarks.slice(-MAX_REPLAY_BOOKMARKS) });
}

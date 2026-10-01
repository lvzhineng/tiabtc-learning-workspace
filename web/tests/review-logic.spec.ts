import { test, expect } from '@playwright/test';
import { MAX_ACTIVE_CANDLES, mergeCandleWindow, preserveCandleViewport } from '../src/chart/candle-retention';
import { filterVisibleCandles, getPrevCursorTimeMs, getNextCursorTimeMs } from '../src/features/replay/free-replay-logic';
import { reviewCardHtml } from '../src/chart/review-card';
import { compareReviewPeriods } from '../src/features/position-dashboard/period-comparison';
import { recordPerformance, performanceSamples } from '../src/ui/performance-records';
import type { Candlestick } from '../src/domain/candle';
import type { ReviewPosition } from '../src/features/position-review/position-review-types';

const base = Date.UTC(2024, 0, 1);
const bars = (from: number, count: number): Candlestick[] => Array.from({ length: count }, (_, index) => ({
  symbol: 'BTCUSDT', interval: '1', timestampMs: base + (from + index) * 60_000,
  open: 100, high: 102, low: 99, close: 101, volume: 10,
}));

test('150,000 bars of extension remain bounded and preserve fractional viewport timestamps', () => {
  let current = bars(0, MAX_ACTIVE_CANDLES);
  for (let end = MAX_ACTIVE_CANDLES; end < 150_000; end += 1000) {
    const previous = current;
    const range = { from: previous.length - 180.5, to: previous.length - 60.5 };
    current = mergeCandleWindow(previous, bars(end, 1000), 'after');
    expect(current.length).toBe(MAX_ACTIVE_CANDLES);
    const kept = preserveCandleViewport(previous, current, range);
    expect(current[Math.floor(kept.from)].timestampMs).toBe(previous[Math.floor(range.from)].timestampMs);
    expect(kept.to - kept.from).toBe(range.to - range.from);
    expect(kept.from % 1).toBe(range.from % 1);
  }
});

test('prepend at capacity preserves visible bars and replaces overlapping revised candles', () => {
  const previous = bars(1000, MAX_ACTIVE_CANDLES);
  const revised = { ...previous[0], close: 100.5 };
  const next = mergeCandleWindow(previous, [...bars(0, 1000), revised], 'before');
  const kept = preserveCandleViewport(previous, next, { from: 100.25, to: 220.25 });
  expect(next.length).toBe(MAX_ACTIVE_CANDLES);
  expect(next[1000].close).toBe(100.5);
  expect(next[Math.floor(kept.from)].timestampMs).toBe(previous[100].timestampMs);
});

test('replay trim retains cursor, hides future OHLC and rewind recovers previous candle', () => {
  const cursor = base + 11_950 * 60_000;
  const retained = mergeCandleWindow(bars(0, 12_000), bars(12_000, 1000), 'after', cursor);
  expect(retained.length).toBe(MAX_ACTIVE_CANDLES);
  const visible = filterVisibleCandles(retained, cursor, '1');
  expect(visible.at(-1)!.timestampMs + 60_000).toBe(cursor);
  expect(visible.every((bar) => bar.timestampMs + 60_000 <= cursor)).toBe(true);
  const edge = retained[0].timestampMs + 60_000;
  const reloaded = mergeCandleWindow(retained, bars((edge - base) / 60_000 - 1001, 1000), 'before', edge);
  expect(getPrevCursorTimeMs(reloaded, edge, base, '1')).toBe(edge - 60_000);
});

test('CFD next cursor follows actual candles across a weekend', () => {
  const friday = bars(0, 1)[0];
  const monday = { ...friday, timestampMs: friday.timestampMs + 3 * 86_400_000 };
  expect(getNextCursorTimeMs([friday, monday], friday.timestampMs + 60_000, '1')).toBe(monday.timestampMs + 60_000);
});

test('exported review card escapes notes, tags and source text and rejects remote images', () => {
  const card = { title: '<script>x</script>', details: ['<b>'], note: '</pre><script>bad()</script>', tags: ['<img onerror=x>'] };
  const html = reviewCardHtml(card, 'data:image/png;base64,AAAA');
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  expect(() => reviewCardHtml(card, 'https://example.com/image.png')).toThrow();
});

test('period comparison separates adjacent windows and excludes open/future positions', () => {
  const day = 86_400_000;
  const make = (days: number, pnl: number, status = 'closed') => ({ status, entryTimeMs: base + days * day,
    exitTimeMs: base + days * day, netPnl: pnl, side: 'long' }) as ReviewPosition;
  const result = compareReviewPeriods([make(29, 10), make(20, -5), make(31, 100), make(29, 50, 'open')], base + 30 * day, 7);
  expect(result.current.totalPnl).toBe(10);
  expect(result.previous.totalPnl).toBe(-5);
  expect(result.current.closedCount).toBe(1);
});

test('performance ring bounds samples and callers cannot mutate the retained records', () => {
  for (let index = 0; index < 300; index++) recordPerformance({ operation: 'test', durationMs: index });
  const snapshot = performanceSamples();
  expect(snapshot.length).toBe(200);
  snapshot[0].durationMs = -1;
  expect(performanceSamples()[0].durationMs).toBe(100);
});

import { fetchUsSessionCandles } from '@/api/cfd-api';
import { pickRandomUsDay, type UsDayLookback, type UsDayReplay } from './us-day-replay';
import { getPreviousUsEquitySession } from './us-equity-session';

const SLOT_TTL_MS = 10 * 60_000;

type PrefetchSlot = {
  key: string;
  expiresAt: number;
  status: 'pending' | 'ready';
  promise: Promise<UsDayReplay>;
  controller: AbortController;
  progress: string;
  listeners: Set<(message: string) => void>;
};

let slot: PrefetchSlot | null = null;

function slotKey(symbol: string, lookback: UsDayLookback): string {
  return `${symbol}:${lookback}`;
}

function isFresh(candidate: PrefetchSlot): boolean {
  return Date.now() < candidate.expiresAt;
}

function discard(candidate: PrefetchSlot): void {
  if (candidate.status === 'pending') candidate.controller.abort();
  if (slot === candidate) slot = null;
}

function publish(candidate: PrefetchSlot, message: string): void {
  candidate.progress = message;
  for (const listener of candidate.listeners) listener(message);
}

function preparePreviousDay(symbol: string, session: UsDayReplay): void {
  const previous = getPreviousUsEquitySession(session.date);
  // Every session displays the preceding day, regardless of timeframe or EMA visibility.
  if (previous) void fetchUsSessionCandles(symbol, previous.fromMs, previous.toMs).catch(() => {});
}

function expiredSlot(): void {
  if (slot && !isFresh(slot)) discard(slot);
}

/** Prepare one day and return its expiry so the UI never advertises a stale slot. */
export function prepareUsDay(
  symbol: string,
  lookback: UsDayLookback
): Promise<number> {
  expiredSlot();
  const key = slotKey(symbol, lookback);

  if (slot?.key === key) {
    const current = slot;
    return current.promise.then(() => current.expiresAt);
  }
  // A symbol/range change takes priority; do not silently skip its preparation.
  if (slot) discard(slot);

  const controller = new AbortController();
  const candidate: PrefetchSlot = {
    key,
    expiresAt: Date.now() + SLOT_TTL_MS,
    status: 'pending',
    controller,
    progress: '',
    listeners: new Set(),
    promise: pickRandomUsDay(symbol, controller.signal, lookback,
      (message) => publish(candidate, message), 3
    ).then((session) => {
      if (slot === candidate && !controller.signal.aborted) {
        candidate.status = 'ready';
        candidate.expiresAt = Date.now() + SLOT_TTL_MS;
        preparePreviousDay(symbol, session);
      }
      return session;
    }).catch((error: unknown) => {
      if (slot === candidate) slot = null;
      throw error;
    }),
  };
  slot = candidate;
  // A background-only rejection must always be observed, even if no view takes it.
  void candidate.promise.catch(() => {});
  return candidate.promise.then(() => candidate.expiresAt);
}

function waitForSlot(
  candidate: PrefetchSlot,
  signal: AbortSignal,
  onProgress?: (message: string) => void
): Promise<UsDayReplay> {
  if (signal.aborted) return Promise.reject(new DOMException('请求已取消', 'AbortError'));
  if (candidate.progress) onProgress?.(candidate.progress);
  const listener = (message: string) => onProgress?.(message);
  candidate.listeners.add(listener);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
      candidate.listeners.delete(listener);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('请求已取消', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    candidate.promise.then(
      (session) => {
        cleanup();
        resolve(session);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
    if (signal.aborted) abort();
  });
}

/** Consume a prepared day once, or perform a bounded foreground lookup. */
export async function takeUsDay(
  symbol: string,
  lookback: UsDayLookback,
  signal: AbortSignal,
  onProgress: (message: string) => void = () => {}
): Promise<UsDayReplay> {
  expiredSlot();
  const key = slotKey(symbol, lookback);
  const candidate = slot;

  if (candidate && candidate.key === key && isFresh(candidate)) {
    try {
      const session = await waitForSlot(candidate, signal, onProgress);
      if (signal.aborted) throw new DOMException('请求已取消', 'AbortError');
      if (slot === candidate && candidate.status === 'ready' && isFresh(candidate)) {
        slot = null;
        return session;
      }
    } catch (error) {
      if (signal.aborted) throw error;
      // A failed/aborted background lookup falls through to the normal picker.
    }
  } else if (candidate && candidate.key !== key) {
    // Foreground selection takes priority; abort only stops the background scan's next candidate.
    discard(candidate);
  }

  if (signal.aborted) throw new DOMException('请求已取消', 'AbortError');
  return pickRandomUsDay(symbol, signal, lookback, onProgress);
}

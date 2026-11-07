import { requestJson } from './http';
import type { PersistedDrawing } from '@/domain/drawing';
import type { ReviewTimeframe } from '@/domain/timeframe';
import type { VideoReviewContext } from '@/domain/review-context';
import type { TradingSession } from '@/chart/trading-sessions';
import type { StoredFreeReplay } from '@/features/review-workspace/review-ui-state';
import { toPersistedDrawing, type RawScopedDrawing } from './drawing-response';
import { formatChartTime } from '@/chart/chart-time';

export type ReviewMarket = 'perpetual' | 'cfd';
export type ReviewSessionState = {
  symbol: string;
  timeframe: ReviewTimeframe;
  timestampMs: number;
  visibleSpan: number;
  replay: StoredFreeReplay | null;
  isLogScale: boolean;
  sessionBands: TradingSession[];
  showWeekendBands: boolean;
  videoContext: VideoReviewContext | null;
};
export type ReviewSessionSummary = {
  id: string;
  title: string;
  market: ReviewMarket;
  symbol: string;
  timeframe: ReviewTimeframe;
  timestampMs: number;
  drawingCount: number;
  createdAt: string;
  updatedAt: string;
};
export type ReviewSession = Omit<ReviewSessionSummary, 'timeframe' | 'timestampMs'> & { state: ReviewSessionState };

const pathFor = (id: string) => `/api/review-sessions/${encodeURIComponent(id)}`;
const rawDrawing = ({ id, symbol, interval, toolType, points, options }: PersistedDrawing) =>
  ({ id, symbol, interval, toolType, points, options });

export async function fetchReviewSessions(market: ReviewMarket): Promise<ReviewSessionSummary[]> {
  const data = await requestJson<{ sessions: ReviewSessionSummary[] }>(
    `/api/review-sessions?${new URLSearchParams({ market })}`
  );
  return data.sessions;
}

export function fetchReviewSession(id: string): Promise<ReviewSession> {
  return requestJson(pathFor(id));
}

export function createReviewSession(
  market: ReviewMarket, state: ReviewSessionState, drawings: PersistedDrawing[] = []
): Promise<ReviewSession> {
  return requestJson('/api/review-sessions', {
    method: 'POST', body: JSON.stringify({
      market, title: `${state.symbol} · ${formatChartTime(state.timestampMs)}`,
      state, drawings: drawings.map(rawDrawing),
    }),
  });
}

export function updateReviewSession(
  id: string, changes: { title?: string; state?: ReviewSessionState }
): Promise<ReviewSession> {
  return requestJson(pathFor(id), {
    method: 'PUT', body: JSON.stringify(changes), keepalive: true,
  });
}

/** Same interface as drawing-api; all mutations remain inside this archive. */
export function reviewSessionDrawingApi(id: string, onMutation?: (delta: 1 | -1) => void) {
  const path = `${pathFor(id)}/drawings`;
  const pending = new Set<Promise<unknown>>();
  const mutate = <T>(request: () => Promise<T>): Promise<T> => {
    onMutation?.(1);
    const operation = request().finally(() => {
      pending.delete(operation);
      onMutation?.(-1);
    });
    pending.add(operation);
    return operation;
  };
  return {
    async flushMutations() { await Promise.all([...pending]); },
    async fetchDrawings(_scope: string, symbol: string, interval: ReviewTimeframe, signal?: AbortSignal) {
      const data = await requestJson<{ drawings: RawScopedDrawing[] }>(path, { signal });
      return data.drawings.map((row) => toPersistedDrawing(row, id, symbol, interval));
    },
    async saveDrawing(drawing: PersistedDrawing) {
      const data = await mutate(() => requestJson<RawScopedDrawing>(path, {
        method: 'POST', body: JSON.stringify(rawDrawing(drawing)),
      }));
      return toPersistedDrawing(data, id, drawing.symbol, drawing.interval);
    },
    async replaceDrawings(_scope: string, symbol: string, interval: ReviewTimeframe, drawings: PersistedDrawing[]) {
      const data = await mutate(() => requestJson<{ drawings: RawScopedDrawing[] }>(path, {
        method: 'PUT', body: JSON.stringify({ drawings: drawings.map(rawDrawing) }),
      }));
      return data.drawings.map((row) => toPersistedDrawing(row, id, symbol, interval));
    },
    async deleteDrawing(drawingId: string, _scope: string, _symbol: string, _interval: ReviewTimeframe) {
      await mutate(() => requestJson(`${path}?${new URLSearchParams({ id: drawingId })}`, { method: 'DELETE' }));
    },
    async clearAllDrawingsForSymbol(_scope: string, _symbol: string, _interval: ReviewTimeframe) {
      await mutate(() => requestJson(path, { method: 'DELETE' }));
    },
  };
}

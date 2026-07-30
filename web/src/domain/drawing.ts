import type { ReviewTimeframe } from './timeframe';

export type PersistedDrawing = {
  id: string;
  videoId: string;
  symbol: string;
  interval: ReviewTimeframe;
  toolType: string;
  tool: unknown;
  createdAt?: string;
  updatedAt?: string;
};

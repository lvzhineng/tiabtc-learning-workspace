import type { ReviewTimeframe } from './timeframe';

export type PersistedDrawing = {
  id: string;
  videoId: string;
  symbol: string;
  interval: ReviewTimeframe;
  toolType: string;
  points: Array<{
    timestamp: number;
    price: number;
  }>;
  options: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

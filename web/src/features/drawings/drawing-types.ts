export type LegacyToolType =
  | 'TrendLine'
  | 'HorizontalLine'
  | 'HorizontalRay'
  | 'VerticalLine'
  | 'FibRetracement'
  | 'Ray'
  | 'ExtendedLine'
  | 'Arrow'
  | 'Rectangle'
  | 'ParallelChannel';

export type EnhancedToolType =
  | 'short-position'
  | 'long-position'
  | 'date-price-range'
  | 'path'
  | 'text-annotation'
  | 'fixed-range-volume-profile'
  | 'arrow-mark-up'
  | 'arrow-mark-down'
  | 'brush'
  | 'rotated-rectangle';

export type ActiveToolType = 'select' | LegacyToolType | EnhancedToolType;

export type DrawingPoint = {
  timestampMs: number;
  price: number;
};

export type DrawingToolState = {
  id: string;
  videoId: string;
  symbol: string;
  interval: string;
  toolType: string;
  points: DrawingPoint[];
  text?: string;
  locked?: boolean;
  color?: string;
  lineWidth?: number;
  extra?: Record<string, unknown>;
};

export const ANCHOR_COUNTS: Record<string, number> = {
  TrendLine: 2,
  HorizontalLine: 1,
  HorizontalRay: 1,
  VerticalLine: 1,
  FibRetracement: 2,
  Ray: 2,
  ExtendedLine: 2,
  Arrow: 2,
  Rectangle: 2,
  ParallelChannel: 3,
  'short-position': 3,
  'long-position': 3,
  'date-price-range': 2,
  path: 2,
  'text-annotation': 1,
  'fixed-range-volume-profile': 2,
  'arrow-mark-up': 1,
  'arrow-mark-down': 1,
  brush: 2,
  'rotated-rectangle': 3,
};

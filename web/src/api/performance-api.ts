import { requestJson } from './http';
import type { PerformanceSample } from '@/ui/performance-records';

export type BackendPerformanceSample = PerformanceSample & { positionCount?: number; fillCount?: number; scopeCount?: number };

export function fetchPerformance(): Promise<{ capacity: number; samples: BackendPerformanceSample[] }> {
  return requestJson('/api/performance');
}

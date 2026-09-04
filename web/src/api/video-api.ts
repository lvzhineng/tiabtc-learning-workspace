import { requestJson } from './http';

export type LearningStateRecord = {
  status: 'unlearned' | 'learning' | 'learned';
  updatedAt?: string;
  note?: string;
  bookmarked?: boolean;
};

export type LearningStateResponse = {
  records: Record<string, LearningStateRecord>;
};

export async function fetchLearningState(signal?: AbortSignal): Promise<Record<string, LearningStateRecord>> {
  const data = await requestJson<LearningStateResponse>('/api/state', { signal });
  return data.records || {};
}

export async function updateLearningState(
  videoId: string,
  record: LearningStateRecord | null
): Promise<void> {
  const encodedId = encodeURIComponent(videoId);
  await requestJson<{ ok: boolean }>(`/api/state/${encodedId}`, {
    method: 'PUT',
    body: record ? JSON.stringify(record) : '',
  });
}

export type VideoCatalogRefreshResult = {
  ok: boolean;
  total: number;
  added: number;
  latestDate: string | null;
};

export async function refreshVideoCatalog(): Promise<VideoCatalogRefreshResult> {
  return requestJson<VideoCatalogRefreshResult>('/api/videos/refresh', {
    method: 'POST',
    body: '{}',
  });
}

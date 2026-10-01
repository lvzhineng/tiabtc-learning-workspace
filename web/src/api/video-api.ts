import { requestJson } from './http';
import type { VideoItem } from '@/features/learning/learning-types';

let videosRequest: Promise<VideoItem[]> | null = null;

export function loadVideos(force = false): Promise<VideoItem[]> {
  if (force) videosRequest = null;
  if (!videosRequest) {
    const suffix = force ? `?t=${Date.now()}` : '';
    videosRequest = fetch(`/videos.json${suffix}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<VideoItem[]>;
      })
      .catch((error) => {
        videosRequest = null;
        throw error;
      });
  }
  return videosRequest;
}

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

export type VideoCatalogSource = {
  url: string;
  kind: string;
  label: string;
  channelId?: string;
  playlistId?: string;
  template: boolean;
  total: number;
  latestDate: string | null;
};

export type VideoCatalogRefreshResult = {
  ok: boolean;
  total: number;
  added: number;
  removed?: number;
  replaced?: boolean;
  latestDate: string | null;
  warning?: string;
  source?: VideoCatalogSource;
};

export async function fetchVideoCatalogSource(
  signal?: AbortSignal
): Promise<VideoCatalogSource> {
  return requestJson<VideoCatalogSource>('/api/videos/source', { signal });
}

export async function refreshVideoCatalog(payload?: {
  sourceUrl?: string;
  template?: 'tia';
}): Promise<VideoCatalogRefreshResult> {
  return requestJson<VideoCatalogRefreshResult>('/api/videos/refresh', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

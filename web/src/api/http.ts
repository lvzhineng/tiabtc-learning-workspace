import { recordPerformance } from '@/ui/performance-records';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    if (!response.ok) {
      let errorMsg = `HTTP Error ${response.status}: ${response.statusText}`;
      try {
        const data = await response.json();
        if (data?.error) {
          errorMsg = data.error;
        }
      } catch {
        // ignore json parse error
      }
      throw new ApiError(response.status, errorMsg);
    }

    return await response.json() as T;
  } finally {
    const path = url.split('?')[0];
    // Learning IDs are dynamic paths; normalize them before recording.
    const operation = path.startsWith('/api/state/') ? '/api/state/:id' : path;
    if (operation !== '/api/performance') {
      recordPerformance({ operation: `${init?.method || 'GET'} ${operation}`, durationMs: performance.now() - started });
    }
  }
}

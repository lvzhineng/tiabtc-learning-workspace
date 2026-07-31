import { useState, useEffect, useCallback, useRef } from 'react';
import type { UserLearningState, LearningStatus } from './learning-types';
import { fetchLearningState, updateLearningState } from '@/api/video-api';

export function useLearningState() {
  const [stateMap, setStateMap] = useState<Record<string, UserLearningState>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const stateMapRef = useRef<Record<string, UserLearningState>>({});
  const persistedStateRef = useRef<Record<string, UserLearningState>>({});
  const saveChainsRef = useRef<Record<string, Promise<void>>>({});
  const debounceTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const pendingDebouncedRecordsRef = useRef<
    Record<string, UserLearningState>
  >({});
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchLearningState(controller.signal)
      .then((records) => {
        const nextRecords = records || {};
        stateMapRef.current = nextRecords;
        persistedStateRef.current = nextRecords;
        setStateMap(nextRecords);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.warn('加载学习状态失败:', err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      if (saveStatusTimerRef.current) {
        clearTimeout(saveStatusTimerRef.current);
      }
      for (const [videoId, timer] of Object.entries(
        debounceTimersRef.current
      )) {
        clearTimeout(timer);
        const pendingRecord =
          pendingDebouncedRecordsRef.current[videoId];
        if (pendingRecord) {
          const previousSave =
            saveChainsRef.current[videoId] || Promise.resolve();
          void previousSave
            .catch(() => undefined)
            .then(() => updateLearningState(videoId, pendingRecord))
            .catch((saveError) =>
              console.error('卸载前保存学习状态失败:', saveError)
            );
        }
      }
    };
  }, []);

  const persistRecord = useCallback(
    async (videoId: string, updated: UserLearningState) => {
      setSaveStatus('保存中...');
      const previousSave =
        saveChainsRef.current[videoId] || Promise.resolve();
      const currentSave = previousSave
        .catch(() => undefined)
        .then(() => updateLearningState(videoId, updated));
      saveChainsRef.current[videoId] = currentSave;
      try {
        await currentSave;
        persistedStateRef.current = {
          ...persistedStateRef.current,
          [videoId]: updated,
        };
        setSaveStatus('自动已保存');
        if (saveStatusTimerRef.current) {
          clearTimeout(saveStatusTimerRef.current);
        }
        saveStatusTimerRef.current = setTimeout(() => {
          setSaveStatus(null);
          saveStatusTimerRef.current = null;
        }, 2000);
      } catch (saveError) {
        if (stateMapRef.current[videoId]?.updatedAt === updated.updatedAt) {
          const rolledBack = { ...stateMapRef.current };
          const persisted = persistedStateRef.current[videoId];
          if (persisted === undefined) delete rolledBack[videoId];
          else rolledBack[videoId] = persisted;
          stateMapRef.current = rolledBack;
          setStateMap(rolledBack);
        }
        setSaveStatus('保存失败');
        console.error('更新学习状态异常:', saveError);
      } finally {
        if (saveChainsRef.current[videoId] === currentSave) {
          delete saveChainsRef.current[videoId];
        }
      }
    },
    []
  );

  const updateState = useCallback(
    (
      videoId: string,
      updates: Partial<UserLearningState>,
      debounceMs = 0
    ) => {
      const existing = stateMapRef.current[videoId] || {
        status: 'unlearned' as LearningStatus,
        updatedAt: new Date().toISOString(),
      };

      const updated: UserLearningState = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      // Optimistic local update
      const nextStateMap = {
        ...stateMapRef.current,
        [videoId]: updated,
      };
      stateMapRef.current = nextStateMap;
      setStateMap(nextStateMap);
      if (saveStatusTimerRef.current) {
        clearTimeout(saveStatusTimerRef.current);
        saveStatusTimerRef.current = null;
      }

      const pendingTimer = debounceTimersRef.current[videoId];
      if (pendingTimer) clearTimeout(pendingTimer);
      if (debounceMs > 0) {
        setSaveStatus('等待保存...');
        pendingDebouncedRecordsRef.current[videoId] = updated;
        debounceTimersRef.current[videoId] = setTimeout(() => {
          delete debounceTimersRef.current[videoId];
          delete pendingDebouncedRecordsRef.current[videoId];
          void persistRecord(videoId, updated);
        }, debounceMs);
      } else {
        delete debounceTimersRef.current[videoId];
        delete pendingDebouncedRecordsRef.current[videoId];
        void persistRecord(videoId, updated);
      }
    },
    [persistRecord]
  );

  const toggleBookmark = useCallback(
    (videoId: string) => {
      const current = Boolean(stateMapRef.current[videoId]?.bookmarked);
      updateState(videoId, { bookmarked: !current });
    },
    [updateState]
  );

  const setStatus = useCallback(
    (videoId: string, status: LearningStatus) => {
      updateState(videoId, { status });
    },
    [updateState]
  );

  const setNote = useCallback(
    (videoId: string, note: string) => {
      updateState(videoId, { note }, 400);
    },
    [updateState]
  );

  return {
    stateMap,
    loading,
    saveStatus,
    updateState,
    toggleBookmark,
    setStatus,
    setNote,
  };
}

import { useState, useEffect, useCallback } from 'react';
import type { UserLearningState, LearningStatus } from './learning-types';
import { fetchLearningState, updateLearningState } from '@/api/video-api';

export function useLearningState() {
  const [stateMap, setStateMap] = useState<Record<string, UserLearningState>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    fetchLearningState()
      .then((records) => {
        setStateMap(records || {});
      })
      .catch((err) => {
        console.warn('加载学习状态失败:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const updateState = useCallback(
    async (videoId: string, updates: Partial<UserLearningState>) => {
      const existing = stateMap[videoId] || {
        status: 'unlearned' as LearningStatus,
        updatedAt: new Date().toISOString(),
      };

      const updated: UserLearningState = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      // Optimistic local update
      setStateMap((prev) => ({
        ...prev,
        [videoId]: updated,
      }));

      setSaveStatus('保存中...');
      try {
        await updateLearningState(videoId, updated);
        setSaveStatus('自动已保存');
        setTimeout(() => setSaveStatus(null), 2000);
      } catch (err) {
        setSaveStatus('保存失败');
        console.error('更新学习状态异常:', err);
      }
    },
    [stateMap]
  );

  const toggleBookmark = useCallback(
    (videoId: string) => {
      const current = Boolean(stateMap[videoId]?.bookmarked);
      updateState(videoId, { bookmarked: !current });
    },
    [stateMap, updateState]
  );

  const setStatus = useCallback(
    (videoId: string, status: LearningStatus) => {
      updateState(videoId, { status });
    },
    [updateState]
  );

  const setNotes = useCallback(
    (videoId: string, notes: string) => {
      updateState(videoId, { notes });
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
    setNotes,
  };
}

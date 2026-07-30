import { useEffect, useState, useMemo } from 'react';
import type { VideoItem, FilterParams } from './learning-types';
import { useLearningState } from './useLearningState';
import { computeLearningStats, filterAndSortVideos } from './learning-filter';
import { LearningStatsHeader } from './LearningStatsHeader';
import { LearningFilterBar } from './LearningFilterBar';
import { VideoTable } from './VideoTable';
import { RefreshCw } from 'lucide-react';
import '@/styles/learning.css';

interface Props {
  onOpenVideoReview: (video: VideoItem) => void;
}

const PAGE_SIZE = 30;

export function LearningWorkspace({ onOpenVideoReview }: Props) {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loadingVideos, setLoadingVideos] = useState<boolean>(true);

  const {
    stateMap,
    saveStatus,
    toggleBookmark,
    setStatus,
    setNotes,
  } = useLearningState();

  const [filters, setFilters] = useState<FilterParams>({
    searchQuery: '',
    yearFilter: 'all',
    monthFilter: 'all',
    quickFilter: 'all',
    sortOrder: 'asc',
  });

  const [currentPage, setCurrentPage] = useState<number>(1);

  // Fetch videos.json on mount
  useEffect(() => {
    fetch('/videos.json')
      .then((res) => res.json())
      .then((data: VideoItem[]) => {
        setVideos(data || []);
      })
      .catch((err) => {
        console.error('获取 videos.json 失败:', err);
      })
      .finally(() => {
        setLoadingVideos(false);
      });
  }, []);

  // Compute available years list
  const years = useMemo(() => {
    const set = new Set<string>();
    for (const v of videos) {
      if (v.date && v.date.length >= 4) {
        set.add(v.date.substring(0, 4));
      }
    }
    return Array.from(set).sort().reverse();
  }, [videos]);

  // Compute Overall Stats
  const stats = useMemo(() => {
    return computeLearningStats(videos, stateMap);
  }, [videos, stateMap]);

  // Filter & Sort Videos
  const filteredVideos = useMemo(() => {
    return filterAndSortVideos(videos, stateMap, filters);
  }, [videos, stateMap, filters]);

  // Reset page to 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  // Pagination Math
  const totalPages = Math.max(1, Math.ceil(filteredVideos.length / PAGE_SIZE));
  const currentPageClamped = Math.min(currentPage, totalPages);

  const paginatedVideos = useMemo(() => {
    const start = (currentPageClamped - 1) * PAGE_SIZE;
    return filteredVideos.slice(start, start + PAGE_SIZE);
  }, [filteredVideos, currentPageClamped]);

  return (
    <div className="learning-container">
      {/* Hero Header */}
      <section className="learning-hero">
        <div>
          <p className="learning-eyebrow">TIA BTC · SYSTEMATIC LEARNING</p>
          <h1 className="learning-title">顺序学习工作台 (React V2)</h1>
          <p className="learning-subtitle">
            从最早的视频开始按年月推进。书签、学习状态与笔记将实时持久化保存在 SQLite 本地数据库中。
          </p>
        </div>

        {saveStatus && (
          <div
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '13px',
              fontWeight: 600,
              background: 'rgba(8, 153, 129, 0.15)',
              color: 'var(--accent-green)',
              border: '1px solid var(--accent-green)',
            }}
          >
            {saveStatus}
          </div>
        )}
      </section>

      {/* Stats Header Cards */}
      <LearningStatsHeader stats={stats} />

      {/* Filter & Search Bar */}
      <LearningFilterBar filters={filters} years={years} onChange={setFilters} />

      {/* Loading indicator */}
      {loadingVideos ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)' }}>
          <RefreshCw size={24} className="spin" style={{ display: 'block', margin: '0 auto 12px' }} />
          <span>正在读取 1426 条视频清单数据...</span>
        </div>
      ) : (
        <>
          {/* Context Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '13px',
              color: 'var(--text-secondary)',
              marginBottom: '10px',
            }}
          >
            <div>
              显示范围: 共 <strong style={{ color: 'var(--text-primary)' }}>{filteredVideos.length}</strong> 个视频
            </div>
            <div>
              页码: <strong style={{ color: 'var(--text-primary)' }}>{currentPageClamped}</strong> / {totalPages} 页
            </div>
          </div>

          {/* Main Video Table */}
          <VideoTable
            videos={paginatedVideos}
            stateMap={stateMap}
            onToggleBookmark={toggleBookmark}
            onSetStatus={setStatus}
            onSetNotes={setNotes}
            onOpenVideoReview={onOpenVideoReview}
          />

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="learning-pagination">
              <button
                type="button"
                disabled={currentPageClamped <= 1}
                onClick={() => setCurrentPage(1)}
                style={{ cursor: currentPageClamped <= 1 ? 'not-allowed' : 'pointer' }}
              >
                首页
              </button>
              <button
                type="button"
                disabled={currentPageClamped <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{ cursor: currentPageClamped <= 1 ? 'not-allowed' : 'pointer' }}
              >
                上一页
              </button>

              <span style={{ fontSize: '13px', margin: '0 8px' }}>
                第 {currentPageClamped} / {totalPages} 页
              </span>

              <button
                type="button"
                disabled={currentPageClamped >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{ cursor: currentPageClamped >= totalPages ? 'not-allowed' : 'pointer' }}
              >
                下一页
              </button>
              <button
                type="button"
                disabled={currentPageClamped >= totalPages}
                onClick={() => setCurrentPage(totalPages)}
                style={{ cursor: currentPageClamped >= totalPages ? 'not-allowed' : 'pointer' }}
              >
                末页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

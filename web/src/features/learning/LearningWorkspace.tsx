import { useEffect, useState, useMemo, useRef } from 'react';
import type { VideoItem, FilterParams } from './learning-types';
import { useLearningState } from './useLearningState';
import { computeLearningStats, filterAndSortVideos } from './learning-filter';
import { LearningStatsHeader } from './LearningStatsHeader';
import { LearningFilterBar } from './LearningFilterBar';
import { VideoTable } from './VideoTable';
import { RefreshCw } from 'lucide-react';
import { refreshVideoCatalog } from '@/api/video-api';
import { toast } from '@/ui/feedback/toast';
import {
  readLocalUiState,
  storedInteger,
  storedString,
  writeLocalUiState,
} from '@/ui/persistence/local-ui-state';
import '@/styles/learning.css';

interface Props {
  onOpenVideoReview: (video: VideoItem) => void;
}

const PAGE_SIZE = 30;
const LEARNING_UI_STORAGE_KEY = 'tiabtc-learning-ui-v1';
let videosRequest: Promise<VideoItem[]> | null = null;

function loadLearningUiState(): { filters: FilterParams; page: number } {
  const stored = readLocalUiState(LEARNING_UI_STORAGE_KEY);
  const month = storedString(stored.monthFilter, 'all', undefined, 2);
  return {
    filters: {
      searchQuery: storedString(stored.searchQuery, ''),
      yearFilter: storedString(stored.yearFilter, 'all', undefined, 4),
      monthFilter:
        month === 'all' || /^(?:0?[1-9]|1[0-2])$/.test(month) ? month : 'all',
      quickFilter: storedString(
        stored.quickFilter,
        'all',
        ['all', 'unfinished', 'learned', 'bookmarked', 'noted']
      ) as FilterParams['quickFilter'],
      sortOrder: storedString(stored.sortOrder, 'asc', [
        'asc',
        'desc',
      ]) as FilterParams['sortOrder'],
    },
    page: storedInteger(stored.page, 1, 1),
  };
}

function loadVideos(force = false): Promise<VideoItem[]> {
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

export function LearningWorkspace({
  onOpenVideoReview,
}: Props) {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loadingVideos, setLoadingVideos] = useState<boolean>(true);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [initialUiState] = useState(loadLearningUiState);

  const {
    stateMap,
    saveStatus,
    toggleBookmark,
    setStatus,
    setNote,
  } = useLearningState();

  const [filters, setFilters] = useState<FilterParams>(initialUiState.filters);
  const [currentPage, setCurrentPage] = useState<number>(initialUiState.page);
  const filterSignature = JSON.stringify(filters);
  const previousFilterSignatureRef = useRef(filterSignature);

  useEffect(() => {
    let active = true;
    void loadVideos()
      .then((data: VideoItem[]) => {
        if (!active) return;
        setVideos(data || []);
      })
      .catch((err) => {
        if (!active) return;
        console.error('获取 videos.json 失败:', err);
      })
      .finally(() => {
        if (active) setLoadingVideos(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const v of videos) {
      if (v.date && v.date.length >= 4) {
        set.add(v.date.substring(0, 4));
      }
    }
    return Array.from(set).sort().reverse();
  }, [videos]);

  const stats = useMemo(() => {
    return computeLearningStats(videos, stateMap);
  }, [videos, stateMap]);

  const filteredVideos = useMemo(() => {
    return filterAndSortVideos(videos, stateMap, filters);
  }, [videos, stateMap, filters]);

  useEffect(() => {
    if (previousFilterSignatureRef.current === filterSignature) return;
    previousFilterSignatureRef.current = filterSignature;
    setCurrentPage(1);
  }, [filterSignature]);

  useEffect(() => {
    writeLocalUiState(LEARNING_UI_STORAGE_KEY, {
      ...filters,
      page: currentPage,
    });
  }, [currentPage, filters]);

  const totalPages = Math.max(1, Math.ceil(filteredVideos.length / PAGE_SIZE));
  const currentPageClamped = Math.min(currentPage, totalPages);

  useEffect(() => {
    if (!loadingVideos && currentPage !== currentPageClamped) {
      setCurrentPage(currentPageClamped);
    }
  }, [currentPage, currentPageClamped, loadingVideos]);

  const paginatedVideos = useMemo(() => {
    const start = (currentPageClamped - 1) * PAGE_SIZE;
    return filteredVideos.slice(start, start + PAGE_SIZE);
  }, [filteredVideos, currentPageClamped]);

  const latestCatalogDate = useMemo(() => {
    let latest = '';
    for (const video of videos) {
      if (video.date && video.date > latest) latest = video.date;
    }
    return latest;
  }, [videos]);

  const handleRefreshCatalog = async () => {
    if (refreshingCatalog) return;
    setRefreshingCatalog(true);
    try {
      const result = await refreshVideoCatalog();
      const nextVideos = await loadVideos(true);
      setVideos(nextVideos || []);
      if (result.added > 0) {
        toast.success(
          `已新增 ${result.added} 条，清单共 ${result.total} 个视频` +
            (result.latestDate ? `，最新 ${result.latestDate}` : '')
        );
      } else {
        toast.success(
          `清单已是最新，共 ${result.total} 个视频` +
            (result.latestDate ? `，最新 ${result.latestDate}` : '')
        );
      }
    } catch (cause) {
      const errMsg = cause instanceof Error ? cause.message : '刷新视频清单失败';
      toast.error(errMsg);
    } finally {
      setRefreshingCatalog(false);
    }
  };

  return (
    <div className="learning-container">
      <section className="learning-hero">
        <div>
          <p className="learning-eyebrow">TIA BTC · SYSTEMATIC LEARNING</p>
          <h1 className="learning-title">顺序学习工作台</h1>
          <p className="learning-subtitle">
            从最早的视频开始按年月推进。书签、学习状态与笔记会实时保存在本地学习状态中。
          </p>
        </div>

        <div className="learning-hero-aside">
          {saveStatus && (
            <div className="learning-save-pill">{saveStatus}</div>
          )}
          <button
            type="button"
            className="ui-btn learning-refresh-btn"
            onClick={() => void handleRefreshCatalog()}
            disabled={refreshingCatalog || loadingVideos}
            title="从 TiaBTC YouTube 频道拉取新视频并重建清单"
          >
            <RefreshCw size={14} className={refreshingCatalog ? 'spin' : undefined} />
            <span>{refreshingCatalog ? '正在刷新清单…' : '刷新清单'}</span>
          </button>
        </div>
      </section>

      <LearningStatsHeader stats={stats} />
      <LearningFilterBar filters={filters} years={years} onChange={setFilters} />

      {loadingVideos ? (
        <div className="learning-loading-state">
          <RefreshCw size={24} className="spin" />
          <span>正在读取视频清单数据...</span>
        </div>
      ) : (
        <>
          <div className="learning-context-bar">
            <div>
              显示范围: 共 <strong>{filteredVideos.length}</strong> 个视频
              {latestCatalogDate ? (
                <span className="learning-catalog-meta">
                  {' '}
                  · 清单最新 {latestCatalogDate}
                </span>
              ) : null}
            </div>
            <div>
              页码: <strong>{currentPageClamped}</strong> / {totalPages} 页
            </div>
          </div>

          <VideoTable
            videos={paginatedVideos}
            stateMap={stateMap}
            onToggleBookmark={toggleBookmark}
            onSetStatus={setStatus}
            onSetNote={setNote}
            onOpenVideoReview={onOpenVideoReview}
          />

          {totalPages > 1 && (
            <div className="learning-pagination">
              <button
                type="button"
                disabled={currentPageClamped <= 1}
                onClick={() => setCurrentPage(1)}
              >
                首页
              </button>
              <button
                type="button"
                disabled={currentPageClamped <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </button>

              <span className="learning-pagination-label">
                第 {currentPageClamped} / {totalPages} 页
              </span>

              <button
                type="button"
                disabled={currentPageClamped >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                下一页
              </button>
              <button
                type="button"
                disabled={currentPageClamped >= totalPages}
                onClick={() => setCurrentPage(totalPages)}
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

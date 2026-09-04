import { useEffect, useState, useMemo, useRef } from 'react';
import type { VideoItem, FilterParams } from './learning-types';
import { useLearningState } from './useLearningState';
import { computeLearningStats, filterAndSortVideos } from './learning-filter';
import { LearningStatsHeader } from './LearningStatsHeader';
import { LearningFilterBar } from './LearningFilterBar';
import { VideoTable } from './VideoTable';
import { RefreshCw } from 'lucide-react';
import {
  fetchVideoCatalogSource,
  refreshVideoCatalog,
  type VideoCatalogSource,
} from '@/api/video-api';
import { TIA_TEMPLATE_URL } from '@/api/workspace-settings-api';
import { confirmDialog } from '@/ui/feedback/confirm';
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
  const [sourceUrl, setSourceUrl] = useState('');
  const [catalogSource, setCatalogSource] = useState<VideoCatalogSource | null>(
    null
  );
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
    void fetchVideoCatalogSource()
      .then((source) => {
        if (!active) return;
        setCatalogSource(source);
        if (source.url) setSourceUrl(source.url);
      })
      .catch(() => {
        // 清单仍可从 videos.json 读取；来源元数据失败时保持空白。
      });
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

  const applyCatalogResult = async (
    result: Awaited<ReturnType<typeof refreshVideoCatalog>>
  ) => {
    const nextVideos = await loadVideos(true);
    setVideos(nextVideos || []);
    if (result.source) {
      setCatalogSource(result.source);
      if (result.source.url) setSourceUrl(result.source.url);
    }
    const latest = result.latestDate ? `，最新 ${result.latestDate}` : '';
    if (result.warning) toast.warning(result.warning);
    if (result.replaced) {
      const removed =
        result.removed && result.removed > 0
          ? `，移出 ${result.removed} 条旧来源视频`
          : '';
      toast.success(
        `已导入 ${result.added} 条新视频，清单共 ${result.total} 个${removed}${latest}`
      );
      return;
    }
    if (result.added > 0) {
      toast.success(
        `已新增 ${result.added} 条，清单共 ${result.total} 个视频${latest}`
      );
    } else {
      toast.success(`清单已是最新，共 ${result.total} 个视频${latest}`);
    }
  };

  const isSameCatalogSource = (url: string) => {
    const next = url.trim().toLowerCase();
    const current = (catalogSource?.url || '').trim().toLowerCase();
    if (!next || !current) return !catalogSource?.url;
    if (next === current) return true;
    if (catalogSource?.template && next.includes('@tiabtc')) return true;
    if (catalogSource?.channelId && next.includes(catalogSource.channelId.toLowerCase())) {
      return true;
    }
    if (
      catalogSource?.playlistId &&
      next.includes(catalogSource.playlistId.toLowerCase())
    ) {
      return true;
    }
    return false;
  };

  const handleImportCatalog = async (options?: {
    sourceUrl?: string;
    template?: 'tia';
    confirmSwitch?: boolean;
  }) => {
    if (refreshingCatalog) return;
    const nextUrl = (options?.sourceUrl ?? sourceUrl).trim();
    if (!options?.template && !nextUrl) {
      toast.error('请先粘贴 YouTube 频道或播放列表地址');
      return;
    }
    const switching =
      Boolean(options?.confirmSwitch) &&
      videos.length > 0 &&
      !options?.template &&
      !isSameCatalogSource(nextUrl);
    if (switching) {
      const ok = await confirmDialog({
        title: '用新来源重建学习清单？',
        message:
          '将按该频道或播放列表重建清单。已有条目的标题与发布时间会保留；不在新来源中的视频会移出清单（学习状态仍按视频 ID 保存在本地）。',
        confirmText: '导入',
        isDanger: true,
      });
      if (!ok) return;
    }
    setRefreshingCatalog(true);
    try {
      const result = await refreshVideoCatalog(
        options?.template
          ? { template: 'tia' }
          : { sourceUrl: nextUrl }
      );
      await applyCatalogResult(result);
    } catch (cause) {
      const errMsg = cause instanceof Error ? cause.message : '导入视频清单失败';
      toast.error(errMsg);
    } finally {
      setRefreshingCatalog(false);
    }
  };

  const handleRefreshCatalog = async () => {
    await handleImportCatalog({
      sourceUrl: catalogSource?.url || sourceUrl,
      template: catalogSource?.template ? 'tia' : undefined,
    });
  };

  const handleFillTiaTemplate = () => {
    setSourceUrl(TIA_TEMPLATE_URL);
  };

  return (
    <div className="learning-container">
      <section className="learning-hero">
        <div>
          <p className="learning-eyebrow">SEQUENTIAL LEARNING</p>
          <h1 className="learning-title">顺序学习工作台</h1>
          <p className="learning-subtitle">
            粘贴任意 YouTube 频道或播放列表，按发布时间推进学习，并从发布时间进入行情复盘。TiaBTC 是一键填入的示例模板，不是唯一目录。
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
            title="按当前来源增量拉取新视频；已有标题与发布时间不会被覆盖"
          >
            <RefreshCw size={14} className={refreshingCatalog ? 'spin' : undefined} />
            <span>{refreshingCatalog ? '正在更新清单…' : '刷新当前来源'}</span>
          </button>
        </div>
      </section>

      <section className="learning-import-panel">
        <div className="learning-import-row">
          <input
            className="ui-input learning-import-input"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="粘贴 YouTube 频道或播放列表地址"
            spellCheck={false}
            disabled={refreshingCatalog || loadingVideos}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleImportCatalog({ confirmSwitch: true });
              }
            }}
          />
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={() => void handleImportCatalog({ confirmSwitch: true })}
            disabled={refreshingCatalog || loadingVideos}
          >
            导入
          </button>
          <button
            type="button"
            className="ui-btn"
            onClick={handleFillTiaTemplate}
            disabled={refreshingCatalog || loadingVideos}
            title="填入 TiaBTC 公开频道地址，再点导入"
          >
            示例模板 / Tia
          </button>
        </div>
        <p className="learning-import-hint">
          当前来源：
          {catalogSource?.label || (videos.length ? 'TiaBTC 示例清单' : '尚未导入')}
          {catalogSource?.kind === 'playlist'
            ? ' · 播放列表'
            : catalogSource?.kind === 'channel'
              ? ' · 频道'
              : ''}
          {catalogSource?.template ? ' · 示例模板' : ''}
          。导入会拉取视频表并按发布时间排序；已有条目的标题与时间会保留。
        </p>
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

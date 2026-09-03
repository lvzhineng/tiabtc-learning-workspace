import { useCallback, useEffect, useState } from 'react';
import { fetchSymbols, fetchChartConfig } from '@/api/market-api';
import {
  Activity,
  RefreshCw,
  BookOpen,
  BarChart2,
  ListChecks,
  Moon,
  Sun,
  Tags,
  Keyboard,
} from 'lucide-react';
import { ShortcutHelpModal } from '@/ui/feedback/ShortcutHelpModal';
import { ChartWorkspace } from '@/features/review-workspace/ChartWorkspace';
import { LearningWorkspace } from '@/features/learning/LearningWorkspace';
import { BitlangTradeWorkspace } from '@/features/bitlang/BitlangTradeWorkspace';
import { PositionReviewWorkspace } from '@/features/position-review/PositionReviewWorkspace';
import type { VideoItem } from '@/features/learning/learning-types';
import type { VideoReviewContext } from '@/domain/review-context';
import { parseVideoPublishedTimeMs } from '@/chart/chart-time';

type WorkspaceTab = 'learning' | 'review' | 'bitlang' | 'positions';
export type ThemeMode = 'dark' | 'light';

function initialWorkspaceTab(): WorkspaceTab {
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (tab === 'dashboard') return 'positions';
  return tab === 'review' || tab === 'bitlang' || tab === 'positions' ? tab : 'learning';
}

function initialVideoReviewContext(): VideoReviewContext | null {
  const params = new URLSearchParams(window.location.search);
  const videoId = params.get('videoId');
  const title = params.get('videoTitle');
  const symbol = params.get('symbol');
  const anchorTimeMs = Number(params.get('anchorTimeMs'));
  if (
    params.get('tab') !== 'review' ||
    !videoId ||
    !title ||
    !symbol ||
    !Number.isFinite(anchorTimeMs) ||
    anchorTimeMs <= 0
  ) {
    return null;
  }
  return { mode: 'video', videoId, title, symbol, anchorTimeMs };
}

function initialThemeMode(): ThemeMode {
  try {
    const savedTheme =
      window.localStorage.getItem('tiabtc-theme-mode') ||
      window.localStorage.getItem('bitlang-theme-mode');
    return savedTheme === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function AppShell() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(
    initialWorkspaceTab
  );
  const [offlineMode, setOfflineMode] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialThemeMode);

  const [videoReviewContext, setVideoReviewContext] =
    useState<VideoReviewContext | null>(initialVideoReviewContext);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName.toUpperCase())
        ) {
          return;
        }
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const checkConnection = async () => {
    setLoading(true);
    setError(null);
    try {
      const [, config] = await Promise.all([
        fetchSymbols(),
        fetchChartConfig(),
      ]);
      setOfflineMode(config.offlineMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : '与后端通讯失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkConnection();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.body.dataset.theme = themeMode;
    try {
      window.localStorage.setItem('tiabtc-theme-mode', themeMode);
    } catch {
      // The theme still applies when storage is unavailable.
    }
  }, [themeMode]);

  const navigateToTab = useCallback((tab: WorkspaceTab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === 'learning') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
  }, []);

  const openReviewWindow = useCallback((context?: VideoReviewContext) => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'review');
    if (context) {
      url.searchParams.set('videoId', context.videoId);
      url.searchParams.set('videoTitle', context.title);
      url.searchParams.set('symbol', context.symbol);
      url.searchParams.set('anchorTimeMs', String(context.anchorTimeMs));
    } else {
      url.searchParams.delete('videoId');
      url.searchParams.delete('videoTitle');
      url.searchParams.delete('symbol');
      url.searchParams.delete('anchorTimeMs');
    }

    const popup = window.open(
      url.toString(),
      'tiabtc-review',
      'popup=yes,width=1440,height=960'
    );
    if (popup) {
      try {
        popup.focus();
      } catch {
        // Focus may fail across browsers; the window is still opened.
      }
      return;
    }

    // Popup blocked: fall back to the in-page review workspace.
    setVideoReviewContext(context ?? null);
    navigateToTab('review');
  }, [navigateToTab]);

  const handleOpenVideoReview = (video: VideoItem) => {
    const anchorTimeMs = parseVideoPublishedTimeMs(video.date, video.time);
    const ctx: VideoReviewContext = {
      mode: 'video',
      videoId: video.videoId,
      title: video.title,
      symbol: 'BTCUSDT',
      anchorTimeMs,
    };
    openReviewWindow(ctx);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <span className="app-title-mark" aria-hidden="true">
            <Activity size={16} />
          </span>
          <span className="app-title-text">TiaBTC Workspace</span>

          <nav className="app-nav" aria-label="工作台导航">
            <button
              type="button"
              className={`app-nav-btn ${activeTab === 'learning' ? 'active' : ''}`}
              onClick={() => navigateToTab('learning')}
            >
              <BookOpen size={14} />
              <span>顺序学习</span>
            </button>

            <button
              type="button"
              className={`app-nav-btn ${activeTab === 'review' ? 'active' : ''}`}
              onClick={() => openReviewWindow()}
            >
              <BarChart2 size={14} />
              <span>行情复盘</span>
            </button>

            <button
              type="button"
              className={`app-nav-btn ${activeTab === 'bitlang' ? 'active' : ''}`}
              onClick={() => navigateToTab('bitlang')}
            >
              <ListChecks size={14} />
              <span>bit浪浪实盘分析</span>
            </button>
            <button
              type="button"
              className={`app-nav-btn ${activeTab === 'positions' ? 'active' : ''}`}
              onClick={() => navigateToTab('positions')}
            >
              <Tags size={14} />
              <span>仓位复盘</span>
            </button>
          </nav>
        </div>

        <div className="app-header-actions">
          <button
            type="button"
            className="app-icon-btn"
            onClick={() => setShowShortcuts(true)}
            title="快捷键速查指南 (?)"
            aria-label="快捷键速查指南"
          >
            <Keyboard size={15} />
          </button>
          <button
            type="button"
            className="app-icon-btn"
            onClick={() =>
              setThemeMode((current) =>
                current === 'dark' ? 'light' : 'dark'
              )
            }
            title={themeMode === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
            aria-label={
              themeMode === 'dark' ? '切换到亮色主题' : '切换到暗色主题'
            }
          >
            {themeMode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <div className="app-status-badge">
            <span
              className={`app-status-dot ${
                error ? 'error' : offlineMode ? 'offline' : ''
              }`}
            />
            <span>
              {loading
                ? '连接中...'
                : error
                ? '后端通信异常'
                : offlineMode
                ? '离线缓存模式'
                : 'Bybit 在线服务'}
            </span>
          </div>
          <button
            type="button"
            className="app-icon-btn ghost"
            onClick={checkConnection}
            title="刷新连接"
            aria-label="刷新连接"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </header>

      <main className="app-body">
        {activeTab === 'learning' ? (
          <LearningWorkspace onOpenVideoReview={handleOpenVideoReview} />
        ) : activeTab === 'review' ? (
          <ChartWorkspace
            initialVideoContext={videoReviewContext}
            themeMode={themeMode}
          />
        ) : activeTab === 'positions' ? (
          <PositionReviewWorkspace themeMode={themeMode} />
        ) : (
          <BitlangTradeWorkspace themeMode={themeMode} />
        )}
      </main>

      <ShortcutHelpModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </div>
  );
}

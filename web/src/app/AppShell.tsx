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
} from 'lucide-react';
import { ChartWorkspace } from '@/features/review-workspace/ChartWorkspace';
import { LearningWorkspace } from '@/features/learning/LearningWorkspace';
import { BitlangTradeWorkspace } from '@/features/bitlang/BitlangTradeWorkspace';
import type { VideoItem } from '@/features/learning/learning-types';
import type { VideoReviewContext } from '@/domain/review-context';
import { parseVideoPublishedTimeMs } from '@/chart/chart-time';

type WorkspaceTab = 'learning' | 'review' | 'bitlang';
export type ThemeMode = 'dark' | 'light';

function initialWorkspaceTab(): WorkspaceTab {
  const tab = new URLSearchParams(window.location.search).get('tab');
  return tab === 'review' || tab === 'bitlang' ? tab : 'learning';
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

  const [videoReviewContext, setVideoReviewContext] = useState<VideoReviewContext | null>(null);

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
    window.history.replaceState(null, '', url);
  }, []);

  const handleOpenVideoReview = (video: VideoItem) => {
    const anchorTimeMs = parseVideoPublishedTimeMs(video.date, video.time);
    const ctx: VideoReviewContext = {
      mode: 'video',
      videoId: video.videoId,
      title: video.title,
      symbol: 'BTCUSDT',
      anchorTimeMs,
    };
    setVideoReviewContext(ctx);
    navigateToTab('review');
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <Activity size={20} color="var(--accent-blue)" />
          <span>TiaBTC Workspace</span>

          {/* Top Navigation Tabs */}
          <div style={{ display: 'flex', gap: '4px', marginLeft: '24px' }}>
            <button
              onClick={() => navigateToTab('learning')}
              style={{
                background: activeTab === 'learning' ? 'var(--accent-blue)' : 'var(--bg-dark-700)',
                color: activeTab === 'learning' ? '#fff' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <BookOpen size={14} />
              <span>顺序学习</span>
            </button>

            <button
              onClick={() => navigateToTab('review')}
              style={{
                background: activeTab === 'review' ? 'var(--accent-blue)' : 'var(--bg-dark-700)',
                color: activeTab === 'review' ? '#fff' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <BarChart2 size={14} />
              <span>行情复盘</span>
            </button>

            <button
              onClick={() => navigateToTab('bitlang')}
              style={{
                background: activeTab === 'bitlang' ? 'var(--accent-blue)' : 'var(--bg-dark-700)',
                color: activeTab === 'bitlang' ? '#fff' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <ListChecks size={14} />
              <span>bit浪浪实盘分析</span>
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() =>
              setThemeMode((current) =>
                current === 'dark' ? 'light' : 'dark'
              )
            }
            title={themeMode === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
            aria-label={
              themeMode === 'dark' ? '切换到亮色主题' : '切换到暗色主题'
            }
            style={{
              width: '30px',
              height: '30px',
              background: 'var(--bg-dark-700)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
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
            onClick={checkConnection}
            title="刷新连接"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </header>

      <main className="app-body">
        {activeTab === 'learning' ? (
          <LearningWorkspace
            onOpenVideoReview={handleOpenVideoReview}
            onOpenReview={() => navigateToTab('review')}
            onOpenBitlang={() => navigateToTab('bitlang')}
          />
        ) : activeTab === 'review' ? (
          <ChartWorkspace
            initialVideoContext={videoReviewContext}
            themeMode={themeMode}
          />
        ) : (
          <BitlangTradeWorkspace themeMode={themeMode} />
        )}
      </main>
    </div>
  );
}

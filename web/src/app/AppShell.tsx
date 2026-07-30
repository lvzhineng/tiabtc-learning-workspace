import { useEffect, useState } from 'react';
import { fetchSymbols, fetchChartConfig } from '@/api/market-api';
import { Activity, RefreshCw, BookOpen, BarChart2 } from 'lucide-react';
import { ChartWorkspace } from '@/features/review-workspace/ChartWorkspace';
import { LearningWorkspace } from '@/features/learning/LearningWorkspace';
import type { VideoItem } from '@/features/learning/learning-types';
import type { VideoReviewContext } from '@/domain/review-context';
import { parseVideoPublishedTimeMs } from '@/chart/chart-time';

export function AppShell() {
  const [activeTab, setActiveTab] = useState<'learning' | 'review'>('learning');
  const [, setSymbols] = useState<string[]>([]);
  const [offlineMode] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [videoReviewContext, setVideoReviewContext] = useState<VideoReviewContext | null>(null);

  const checkConnection = async () => {
    setLoading(true);
    setError(null);
    try {
      const [syms] = await Promise.all([
        fetchSymbols(),
        fetchChartConfig(),
      ]);
      setSymbols(syms);
    } catch (err) {
      setError(err instanceof Error ? err.message : '与后端通讯失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkConnection();
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
    setActiveTab('review');
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
              onClick={() => setActiveTab('learning')}
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
              onClick={() => setActiveTab('review')}
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
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
          <LearningWorkspace onOpenVideoReview={handleOpenVideoReview} />
        ) : (
          <ChartWorkspace initialVideoContext={videoReviewContext} />
        )}
      </main>
    </div>
  );
}

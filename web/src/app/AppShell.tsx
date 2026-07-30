import { useEffect, useState } from 'react';
import { fetchSymbols, fetchChartConfig } from '@/api/market-api';
import { Activity, RefreshCw } from 'lucide-react';
import { ChartWorkspace } from '@/features/review-workspace/ChartWorkspace';

export function AppShell() {
  const [, setSymbols] = useState<string[]>([]);
  const [offlineMode] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <Activity size={20} color="var(--accent-blue)" />
          <span>TiaBTC Review Workspace</span>
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
        <ChartWorkspace />
      </main>
    </div>
  );
}

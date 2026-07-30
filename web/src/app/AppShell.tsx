import { useEffect, useState, type ReactNode } from 'react';
import { fetchSymbols, fetchChartConfig } from '@/api/market-api';
import { Activity, Database, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';

interface AppShellProps {
  children?: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [offlineMode, setOfflineMode] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const checkConnection = async () => {
    setLoading(true);
    setError(null);
    try {
      const [syms, config] = await Promise.all([
        fetchSymbols(),
        fetchChartConfig(),
      ]);
      setSymbols(syms);
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <Activity size={20} color="var(--accent-blue)" />
          <span>TiaBTC Review Workspace (React V2)</span>
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
        {children || (
          <div className="app-content">
            <div className="app-card">
              <h2>
                <Database
                  size={20}
                  style={{ verticalAlign: 'middle', marginRight: '8px' }}
                />
                后端契约与服务连接状态
              </h2>
              <p>
                React 前端壳 (Phase 1) 已成功启动，并完成与 Python 后端 (
                <code>study_server.py</code>) 的契约连通校验。
              </p>

              <div className="info-grid">
                <div className="info-item">
                  <div className="info-label">后端连接</div>
                  <div className="info-value">
                    {loading ? (
                      '检测中...'
                    ) : error ? (
                      <span style={{ color: 'var(--accent-red)' }}>
                        <AlertTriangle size={14} /> 离线/异常
                      </span>
                    ) : (
                      <span style={{ color: 'var(--accent-green)' }}>
                        <CheckCircle2 size={14} /> 已连通 (8765)
                      </span>
                    )}
                  </div>
                </div>

                <div className="info-item">
                  <div className="info-label">数据源 (Data Source)</div>
                  <div className="info-value">Bybit Perpetual</div>
                </div>

                <div className="info-item">
                  <div className="info-label">可用 Symbols 数量</div>
                  <div className="info-value">{symbols.length} 个</div>
                </div>

                <div className="info-item">
                  <div className="info-label">Offline Mode</div>
                  <div className="info-value">
                    {offlineMode ? '已开启' : '未开启 (允许联网)'}
                  </div>
                </div>
              </div>

              {symbols.length > 0 && (
                <div
                  style={{
                    marginTop: '16px',
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Symbol 清单示例: {symbols.slice(0, 5).join(', ')}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

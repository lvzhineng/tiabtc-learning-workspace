import { useState } from 'react';
import { fetchPerformance, type BackendPerformanceSample } from '@/api/performance-api';
import { performanceSamples } from '@/ui/performance-records';

export function PerformancePanel() {
  const [samples, setSamples] = useState<BackendPerformanceSample[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      const backend = await fetchPerformance();
      setSamples([...backend.samples.slice(-10), ...performanceSamples().slice(-10)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '诊断读取失败');
      setSamples(performanceSamples().slice(-10));
    } finally {
      setBusy(false);
    }
  };
  return <section className="settings-section">
    <h4>性能诊断</h4>
    <p className="settings-hint">查看最近接口和仓位计算耗时。每端最多记录 200 条，仅保存在内存，不记录密钥、备注或请求参数。</p>
    <button type="button" className="ui-btn" disabled={busy} onClick={() => void refresh()}>{busy ? '读取中…' : '刷新性能记录'}</button>
    {error && <p role="status">{error}</p>}
    {samples.length > 0 && <table className="performance-table"><thead><tr><th>操作</th><th>耗时</th><th>数量</th></tr></thead>
      <tbody>{samples.map((sample, index) => <tr key={index}><td>{sample.operation}</td><td>{sample.durationMs.toFixed(1)} ms</td><td>{sample.positionCount !== undefined ? `${sample.positionCount} 仓位 / ${sample.fillCount ?? 0} 成交` : sample.count ?? '—'}</td></tr>)}</tbody>
    </table>}
  </section>;
}

import type { LearningStats } from './learning-types';

interface Props {
  stats: LearningStats;
}

export function LearningStatsHeader({ stats }: Props) {
  return (
    <div className="learning-stats-grid">
      <div className="learning-metric-card">
        <span className="learning-metric-label">全部视频</span>
        <strong className="learning-metric-value">{stats.totalCount}</strong>
      </div>

      <div className="learning-metric-card">
        <span className="learning-metric-label">已经学完</span>
        <strong className="learning-metric-value" style={{ color: 'var(--accent-green)' }}>
          {stats.learnedCount}
        </strong>
      </div>

      <div className="learning-metric-card">
        <span className="learning-metric-label">剩余视频</span>
        <strong className="learning-metric-value" style={{ color: 'var(--accent-orange)' }}>
          {stats.remainingCount}
        </strong>
      </div>

      <div className="learning-metric-card">
        <span className="learning-metric-label">我的书签</span>
        <strong className="learning-metric-value" style={{ color: 'var(--accent-blue)' }}>
          {stats.bookmarkCount}
        </strong>
      </div>

      <div className="learning-progress-card">
        <div className="learning-progress-head">
          <span className="learning-metric-label">总体完成进度</span>
          <strong style={{ fontSize: '20px', fontWeight: 800 }}>{stats.overallPercent}%</strong>
        </div>
        <div className="learning-progress-track">
          <div
            className="learning-progress-fill"
            style={{ width: `${Math.min(100, Math.max(0, stats.overallPercent))}%` }}
          />
        </div>
      </div>
    </div>
  );
}

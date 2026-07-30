import { useState } from 'react';
import type { VideoItem, UserLearningState, LearningStatus } from './learning-types';
import { ExternalLink, LineChart, Star, FileText } from 'lucide-react';

interface Props {
  videos: VideoItem[];
  stateMap: Record<string, UserLearningState>;
  onToggleBookmark: (videoId: string) => void;
  onSetStatus: (videoId: string, status: LearningStatus) => void;
  onSetNotes: (videoId: string, notes: string) => void;
  onOpenVideoReview: (video: VideoItem) => void;
}

export function VideoTable({
  videos,
  stateMap,
  onToggleBookmark,
  onSetStatus,
  onSetNotes,
  onOpenVideoReview,
}: Props) {
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});

  const toggleNoteExpanded = (videoId: string) => {
    setExpandedNotes((prev) => ({ ...prev, [videoId]: !prev[videoId] }));
  };

  if (!videos || videos.length === 0) {
    return (
      <div className="learning-table-wrap" style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
        没有找到符合条件的学习视频
      </div>
    );
  }

  return (
    <div className="learning-table-wrap">
      <table className="learning-table">
        <thead>
          <tr>
            <th style={{ width: '60px' }}>序号</th>
            <th style={{ width: '50px' }}>书签</th>
            <th style={{ width: '130px' }}>发布日期</th>
            <th>视频标题与学习笔记</th>
            <th style={{ width: '110px' }}>学习状态</th>
            <th style={{ width: '150px' }}>快捷操作</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => {
            const st = stateMap[v.videoId] || { status: 'unlearned', updatedAt: '' };
            const isBookmarked = Boolean(st.bookmarked);
            const notesText = st.notes || '';
            const isNotesExpanded = Boolean(expandedNotes[v.videoId]);

            const rowClass =
              st.status === 'learned'
                ? 'status-learned'
                : st.status === 'learning'
                ? 'status-learning'
                : '';

            return (
              <tr key={v.videoId} className={rowClass}>
                {/* Index */}
                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-muted)' }}>
                  #{v.index}
                </td>

                {/* Bookmark */}
                <td>
                  <button
                    type="button"
                    className={`bookmark-star ${isBookmarked ? 'active' : ''}`}
                    onClick={() => onToggleBookmark(v.videoId)}
                    title={isBookmarked ? '取消书签' : '添加书签'}
                  >
                    <Star size={16} fill={isBookmarked ? 'var(--accent-orange)' : 'none'} />
                  </button>
                </td>

                {/* Date & Time */}
                <td style={{ whiteSpace: 'nowrap' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{v.date}</div>
                  {v.time && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {v.time}
                    </div>
                  )}
                </td>

                {/* Title & Notes */}
                <td>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: 'var(--accent-blue)',
                        fontWeight: 700,
                        textDecoration: 'none',
                        lineHeight: 1.5,
                      }}
                    >
                      {v.title}
                    </a>
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="在 YouTube 中打开原视频"
                      style={{ color: 'var(--text-muted)', display: 'inline-flex', marginTop: '3px' }}
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>

                  {/* Notes Collapsible Section */}
                  <div style={{ marginTop: '6px' }}>
                    <button
                      type="button"
                      onClick={() => toggleNoteExpanded(v.videoId)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: notesText ? 'var(--accent-blue)' : 'var(--text-muted)',
                        fontSize: '12px',
                        cursor: 'pointer',
                        padding: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <FileText size={12} />
                      <span>{notesText ? '编辑笔记' : '+ 添加笔记'}</span>
                    </button>

                    {(isNotesExpanded || notesText) && (
                      <textarea
                        value={notesText}
                        onChange={(e) => onSetNotes(v.videoId, e.target.value)}
                        placeholder="输入对此视频的学习笔记、要点总结..."
                        rows={2}
                        style={{
                          display: 'block',
                          width: '100%',
                          maxWidth: '560px',
                          marginTop: '6px',
                          background: 'var(--bg-dark-900)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '6px 8px',
                          fontSize: '12px',
                          resize: 'vertical',
                          outline: 'none',
                        }}
                      />
                    )}
                  </div>
                </td>

                {/* Status Dropdown */}
                <td>
                  <select
                    value={st.status}
                    onChange={(e) => onSetStatus(v.videoId, e.target.value as LearningStatus)}
                    className="status-badge-select"
                    style={{
                      borderColor:
                        st.status === 'learned'
                          ? 'var(--accent-green)'
                          : st.status === 'learning'
                          ? 'var(--accent-blue)'
                          : 'var(--border-color)',
                    }}
                  >
                    <option value="unlearned">⚪ 未学</option>
                    <option value="learning">🔵 学习中</option>
                    <option value="learned">🟢 已学完</option>
                  </select>
                </td>

                {/* Actions: Open Review Workspace */}
                <td>
                  <button
                    type="button"
                    onClick={() => onOpenVideoReview(v)}
                    style={{
                      background: 'var(--accent-blue)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      padding: '5px 10px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <LineChart size={13} />
                    <span>复盘分析</span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

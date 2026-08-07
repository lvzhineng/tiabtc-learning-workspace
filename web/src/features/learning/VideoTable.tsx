import { useState } from 'react';
import type { VideoItem, UserLearningState, LearningStatus } from './learning-types';
import { ExternalLink, LineChart, Star, FileText } from 'lucide-react';

interface Props {
  videos: VideoItem[];
  stateMap: Record<string, UserLearningState>;
  onToggleBookmark: (videoId: string) => void;
  onSetStatus: (videoId: string, status: LearningStatus) => void;
  onSetNote: (videoId: string, note: string) => void;
  onOpenVideoReview: (video: VideoItem) => void;
}

export function VideoTable({
  videos,
  stateMap,
  onToggleBookmark,
  onSetStatus,
  onSetNote,
  onOpenVideoReview,
}: Props) {
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});

  const toggleNoteExpanded = (videoId: string) => {
    setExpandedNotes((prev) => ({ ...prev, [videoId]: !prev[videoId] }));
  };

  if (!videos || videos.length === 0) {
    return (
      <div className="learning-table-wrap learning-empty-state">
        没有找到符合条件的学习视频
      </div>
    );
  }

  return (
    <div className="learning-table-wrap">
      <table className="learning-table">
        <thead>
          <tr>
            <th className="learning-col-index">序号</th>
            <th className="learning-col-bookmark">书签</th>
            <th className="learning-col-date">发布日期</th>
            <th>视频标题与学习笔记</th>
            <th className="learning-col-status">学习状态</th>
            <th className="learning-col-actions">快捷操作</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => {
            const st = stateMap[v.videoId] || { status: 'unlearned', updatedAt: '' };
            const isBookmarked = Boolean(st.bookmarked);
            const noteText = st.note || '';
            const isNotesExpanded = Boolean(expandedNotes[v.videoId]);

            const rowClass =
              st.status === 'learned'
                ? 'status-learned'
                : st.status === 'learning'
                ? 'status-learning'
                : '';

            return (
              <tr key={v.videoId} className={rowClass}>
                <td className="learning-index">#{v.index}</td>

                <td>
                  <button
                    type="button"
                    className={`bookmark-star ${isBookmarked ? 'active' : ''}`}
                    onClick={() => onToggleBookmark(v.videoId)}
                    title={isBookmarked ? '取消书签' : '添加书签'}
                  >
                    <Star
                      size={16}
                      fill={isBookmarked ? 'var(--accent-orange)' : 'none'}
                    />
                  </button>
                </td>

                <td>
                  <div className="learning-date-main">{v.date}</div>
                  {v.time && (
                    <div className="learning-date-time">{v.time}</div>
                  )}
                </td>

                <td>
                  <div className="learning-title-row">
                    <a
                      className="learning-video-link"
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => onSetStatus(v.videoId, 'learned')}
                    >
                      {v.title}
                    </a>
                    <a
                      className="learning-external-link"
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="在 YouTube 中打开原视频"
                      onClick={() => onSetStatus(v.videoId, 'learned')}
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>

                  <div className="learning-note-block">
                    <button
                      type="button"
                      className={`learning-note-toggle ${noteText ? 'has-note' : ''}`}
                      onClick={() => toggleNoteExpanded(v.videoId)}
                    >
                      <FileText size={12} />
                      <span>
                        {isNotesExpanded
                          ? '收起笔记'
                          : noteText
                          ? '编辑笔记'
                          : '+ 添加笔记'}
                      </span>
                    </button>

                    {isNotesExpanded && (
                      <textarea
                        className="learning-note-input"
                        value={noteText}
                        onChange={(e) => onSetNote(v.videoId, e.target.value)}
                        placeholder="输入对此视频的学习笔记、要点总结..."
                        rows={2}
                      />
                    )}
                  </div>
                </td>

                <td>
                  <select
                    value={st.status}
                    onChange={(e) =>
                      onSetStatus(v.videoId, e.target.value as LearningStatus)
                    }
                    className={`status-badge-select status-${st.status}`}
                  >
                    <option value="unlearned">未学</option>
                    <option value="learning">学习中</option>
                    <option value="learned">已学完</option>
                  </select>
                </td>

                <td>
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary"
                    onClick={() => onOpenVideoReview(v)}
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

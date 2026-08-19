import { memo, useEffect, useRef, useState } from 'react';
import type { VideoItem, UserLearningState, LearningStatus } from './learning-types';
import { ExternalLink, LineChart, Star, FileText } from 'lucide-react';

interface VideoTableProps {
  videos: VideoItem[];
  stateMap: Record<string, UserLearningState>;
  onToggleBookmark: (videoId: string) => void;
  onSetStatus: (videoId: string, status: LearningStatus) => void;
  onSetNote: (videoId: string, note: string) => void;
  onOpenVideoReview: (video: VideoItem) => void;
}

interface VideoRowProps {
  video: VideoItem;
  learningState: UserLearningState;
  isNotesExpanded: boolean;
  onToggleBookmark: (videoId: string) => void;
  onSetStatus: (videoId: string, status: LearningStatus) => void;
  onSetNote: (videoId: string, note: string) => void;
  onToggleNoteExpanded: (videoId: string) => void;
  onOpenVideoReview: (video: VideoItem) => void;
}

const VideoRow = memo(function VideoRow({
  video,
  learningState,
  isNotesExpanded,
  onToggleBookmark,
  onSetStatus,
  onSetNote,
  onToggleNoteExpanded,
  onOpenVideoReview,
}: VideoRowProps) {
  const isBookmarked = Boolean(learningState.bookmarked);
  const noteText = learningState.note || '';
  const [localNote, setLocalNote] = useState(noteText);
  const isFocusedRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external note updates if user is not actively typing
  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalNote(noteText);
    }
  }, [noteText]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleNoteChange = (text: string) => {
    setLocalNote(text);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      onSetNote(video.videoId, text);
    }, 400);
  };

  const handleNoteBlur = () => {
    isFocusedRef.current = false;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (localNote !== noteText) {
      onSetNote(video.videoId, localNote);
    }
  };

  const rowClass =
    learningState.status === 'learned'
      ? 'status-learned'
      : learningState.status === 'learning'
      ? 'status-learning'
      : '';

  return (
    <tr className={rowClass}>
      <td className="learning-index">#{video.index}</td>

      <td>
        <button
          type="button"
          className={`bookmark-star ${isBookmarked ? 'active' : ''}`}
          onClick={() => onToggleBookmark(video.videoId)}
          title={isBookmarked ? '取消书签' : '添加书签'}
        >
          <Star
            size={16}
            fill={isBookmarked ? 'var(--accent-orange)' : 'none'}
          />
        </button>
      </td>

      <td>
        <div className="learning-date-main">{video.date}</div>
        {video.time && (
          <div className="learning-date-time">{video.time}</div>
        )}
      </td>

      <td>
        <div className="learning-title-row">
          <a
            className="learning-video-link"
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onSetStatus(video.videoId, 'learned')}
          >
            {video.title}
          </a>
          <a
            className="learning-external-link"
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            title="在 YouTube 中打开原视频"
            onClick={() => onSetStatus(video.videoId, 'learned')}
          >
            <ExternalLink size={13} />
          </a>
        </div>

        <div className="learning-note-block">
          <button
            type="button"
            className={`learning-note-toggle ${noteText ? 'has-note' : ''}`}
            onClick={() => onToggleNoteExpanded(video.videoId)}
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
              value={localNote}
              onFocus={() => {
                isFocusedRef.current = true;
              }}
              onChange={(e) => handleNoteChange(e.target.value)}
              onBlur={handleNoteBlur}
              placeholder="输入对此视频的学习笔记、要点总结..."
              rows={2}
            />
          )}
        </div>
      </td>

      <td>
        <select
          value={learningState.status}
          onChange={(e) =>
            onSetStatus(video.videoId, e.target.value as LearningStatus)
          }
          className={`status-badge-select status-${learningState.status}`}
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
          onClick={() => onOpenVideoReview(video)}
        >
          <LineChart size={13} />
          <span>复盘分析</span>
        </button>
      </td>
    </tr>
  );
});

export function VideoTable({
  videos,
  stateMap,
  onToggleBookmark,
  onSetStatus,
  onSetNote,
  onOpenVideoReview,
}: VideoTableProps) {
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
            const isNotesExpanded = Boolean(expandedNotes[v.videoId]);

            return (
              <VideoRow
                key={v.videoId}
                video={v}
                learningState={st}
                isNotesExpanded={isNotesExpanded}
                onToggleBookmark={onToggleBookmark}
                onSetStatus={onSetStatus}
                onSetNote={onSetNote}
                onToggleNoteExpanded={toggleNoteExpanded}
                onOpenVideoReview={onOpenVideoReview}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


import { memo } from 'react';
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  X,
  Layers,
} from 'lucide-react';
import type { DrawingToolState } from './drawing-types';

interface DrawingObjectTreePanelProps {
  drawings: DrawingToolState[];
  selectedDrawingId: string | null;
  hiddenDrawingIds: Set<string>;
  onSelectDrawing: (id: string | null) => void;
  onToggleHideDrawing: (id: string) => void;
  onToggleLockDrawing: (id: string) => void;
  onDeleteDrawing: (id: string) => void;
  onClearAllDrawings: () => void;
  onClose: () => void;
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  TrendLine: '趋势线',
  HorizontalLine: '水平线',
  HorizontalRay: '水平射线',
  VerticalLine: '垂直线',
  FibRetracement: '斐波那契回撤',
  'half-retracement': '0.5 回撤',
  ExtendedLine: '延伸线',
  Arrow: '箭头线',
  Rectangle: '矩形',
  ParallelChannel: '平行通道',
  LongPosition: '多头仓位',
  ShortPosition: '空头仓位',
  'long-position': '多头仓位',
  'short-position': '空头仓位',
  'date-price-range': '日期价格范围',
  path: '路径 (Path)',
  'text-annotation': '文字标注',
  'fixed-range-volume-profile': '成交量分布图',
  'arrow-mark-up': '向上标记',
  'arrow-mark-down': '向下标记',
  brush: '笔刷',
  'rotated-rectangle': '旋转矩形',
};

export const DrawingObjectTreePanel = memo(function DrawingObjectTreePanel({
  drawings,
  selectedDrawingId,
  hiddenDrawingIds,
  onSelectDrawing,
  onToggleHideDrawing,
  onToggleLockDrawing,
  onDeleteDrawing,
  onClearAllDrawings,
  onClose,
}: DrawingObjectTreePanelProps) {
  return (
    <div
      className="drawing-object-tree-panel"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="tree-panel-header">
        <div className="tree-panel-title">
          <Layers size={14} />
          <span>图层对象树 ({drawings.length})</span>
        </div>
        <button
          type="button"
          className="tree-close-btn"
          onClick={onClose}
          title="关闭对象树"
        >
          <X size={14} />
        </button>
      </div>

      <div className="tree-panel-body">
        {drawings.length === 0 ? (
          <div className="tree-empty-state">当前图表暂无画图对象</div>
        ) : (
          <div className="tree-list">
            {drawings.map((drawing, index) => {
              const isSelected = drawing.id === selectedDrawingId;
              const isHidden = hiddenDrawingIds.has(drawing.id);
              const isLocked = Boolean(drawing.locked);
              const displayName =
                TOOL_DISPLAY_NAMES[drawing.toolType] || drawing.toolType;
              const label =
                drawing.text || `${displayName} #${drawings.length - index}`;

              return (
                <div
                  key={drawing.id}
                  className={`tree-item ${isSelected ? 'selected' : ''} ${isHidden ? 'is-hidden' : ''}`}
                  onClick={() => onSelectDrawing(drawing.id)}
                >
                  <div
                    className="tree-item-color"
                    style={{ backgroundColor: drawing.color || '#2962ff' }}
                  />

                  <div className="tree-item-label" title={label}>
                    {label}
                  </div>

                  <div className="tree-item-actions">
                    <button
                      type="button"
                      className={`tree-action-btn ${isHidden ? 'active-hidden' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleHideDrawing(drawing.id);
                      }}
                      title={isHidden ? '显示此画图' : '隐藏此画图'}
                    >
                      {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>

                    <button
                      type="button"
                      className={`tree-action-btn ${isLocked ? 'active-locked' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleLockDrawing(drawing.id);
                      }}
                      title={isLocked ? '解锁此画图' : '锁定此画图'}
                    >
                      {isLocked ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>

                    <button
                      type="button"
                      className="tree-action-btn delete-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteDrawing(drawing.id);
                      }}
                      title="删除此画图"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {drawings.length > 0 && (
        <div className="tree-panel-footer">
          <button
            type="button"
            className="tree-clear-btn"
            onClick={onClearAllDrawings}
          >
            <Trash2 size={12} />
            <span>清空当前图表全部画图</span>
          </button>
        </div>
      )}
    </div>
  );
});

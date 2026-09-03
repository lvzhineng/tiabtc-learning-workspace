import { memo } from 'react';
import {
  Lock,
  Unlock,
  Trash2,
} from 'lucide-react';
import type { DrawingToolState } from './drawing-types';
import { saveDrawingStyle } from './drawing-style-storage';

interface DrawingQuickActionBarProps {
  drawing: DrawingToolState;
  position: { x: number; y: number };
  onUpdateDrawing: (updated: DrawingToolState) => void;
  onDeleteDrawing: () => void;
  onToggleLock: () => void;
}

const PRESET_COLORS = [
  '#2962ff', // 经典蓝
  '#089981', // 涨绿
  '#f23645', // 跌红
  '#facc15', // 亮黄
  '#ab47bc', // 紫色
  '#e2e8f0', // 浅白/灰
];

const PRESET_WIDTHS = [1, 2, 3, 4];

export const DrawingQuickActionBar = memo(function DrawingQuickActionBar({
  drawing,
  position,
  onUpdateDrawing,
  onDeleteDrawing,
  onToggleLock,
}: DrawingQuickActionBarProps) {
  const currentColor = drawing.color || '#2962ff';
  const currentWidth = drawing.lineWidth || 2;
  const isDashed = drawing.extra?.lineStyle === 'dashed';
  const isLocked = Boolean(drawing.locked);

  const handleColorSelect = (color: string) => {
    saveDrawingStyle(drawing.toolType, { color });
    onUpdateDrawing({
      ...drawing,
      color,
    });
  };

  const handleWidthSelect = (width: number) => {
    saveDrawingStyle(drawing.toolType, { lineWidth: width });
    onUpdateDrawing({
      ...drawing,
      lineWidth: width,
    });
  };

  const handleStyleToggle = () => {
    const nextStyle = isDashed ? 'solid' : 'dashed';
    saveDrawingStyle(drawing.toolType, { lineStyle: nextStyle });
    onUpdateDrawing({
      ...drawing,
      extra: {
        ...(drawing.extra || {}),
        lineStyle: nextStyle,
      },
    });
  };

  // Keep inside chart bounds
  const left = Math.max(16, position.x);
  const top = Math.max(16, position.y - 46);

  return (
    <div
      className="drawing-quick-action-bar"
      style={{
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        transform: 'translateX(-50%)',
        zIndex: 20,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="quick-bar-colors">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`color-dot ${currentColor.toLowerCase() === c.toLowerCase() ? 'active' : ''}`}
            style={{ backgroundColor: c }}
            onClick={() => handleColorSelect(c)}
            title={`颜色 ${c}`}
          />
        ))}
      </div>

      <div className="quick-bar-divider" />

      <div className="quick-bar-widths">
        {PRESET_WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            className={`width-btn ${currentWidth === w ? 'active' : ''}`}
            onClick={() => handleWidthSelect(w)}
            title={`线宽 ${w}px`}
          >
            <span
              style={{
                width: '14px',
                height: `${w}px`,
                backgroundColor: 'currentColor',
                borderRadius: '1px',
              }}
            />
          </button>
        ))}
      </div>

      <div className="quick-bar-divider" />

      <button
        type="button"
        className={`quick-btn ${isDashed ? 'active' : ''}`}
        onClick={handleStyleToggle}
        title={isDashed ? '切换为实线' : '切换为虚线'}
      >
        <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.5px' }}>
          {isDashed ? '虚线' : '实线'}
        </span>
      </button>

      <div className="quick-bar-divider" />

      <button
        type="button"
        className={`quick-btn ${isLocked ? 'active text-orange' : ''}`}
        onClick={onToggleLock}
        title={isLocked ? '解锁图形' : '锁定图形'}
      >
        {isLocked ? <Lock size={13} /> : <Unlock size={13} />}
      </button>

      <button
        type="button"
        className="quick-btn delete-btn"
        onClick={onDeleteDrawing}
        title="删除此图形 (Delete)"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
});

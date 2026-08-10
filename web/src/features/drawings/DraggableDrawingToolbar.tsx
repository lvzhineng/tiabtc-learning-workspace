import React, { memo, useRef, useState } from 'react';
import type { ActiveToolType } from './drawing-types';
import type { PositionToolParams } from '@/features/paper-trading/paper-trade-types';
import {
  IconArrowDown,
  IconArrowUp,
  IconBrush,
  IconClear,
  IconDatePriceRange,
  IconFibRetracement,
  IconHalfRetracement,
  IconHorizontalRay,
  IconLock,
  IconLongPosition,
  IconMagnet,
  IconPaperTrading,
  IconParallelChannel,
  IconRectangle,
  IconRedo,
  IconRotatedRectangle,
  IconSelect,
  IconShortPosition,
  IconText,
  IconTrash,
  IconTrendLine,
  IconUndo,
  IconUnlock,
  IconVolumeProfile,
} from './drawing-toolbar-icons';
import '@/styles/toolbar.css';

interface DraggableDrawingToolbarProps {
  activeTool: ActiveToolType;
  magnetEnabled: boolean;
  selectedDrawingId: string | null;
  selectedLocked: boolean;
  selectedPositionInfo?: PositionToolParams | null;
  onSelectTool: (tool: ActiveToolType) => void;
  onToggleMagnet: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleLock: () => void;
  onDeleteSelected: () => void;
  onClearAll: () => void;
  onOpenPaperTrading?: () => void;
  onCreatePaperTradeFromPosition?: (params: PositionToolParams) => void;
}

const STORAGE_KEY = 'tiabtc-drawing-toolbar-pos-v2';

const QUICK_TOOLS: Array<{
  tool: ActiveToolType;
  title: string;
  Icon: React.ComponentType;
}> = [
  { tool: 'TrendLine', title: '趋势线 (Alt+T)', Icon: IconTrendLine },
  { tool: 'FibRetracement', title: '斐波那契回撤', Icon: IconFibRetracement },
  { tool: 'half-retracement', title: '0.5 回撤', Icon: IconHalfRetracement },
  { tool: 'ShortPosition', title: '空头仓位', Icon: IconShortPosition },
  { tool: 'LongPosition', title: '多头仓位', Icon: IconLongPosition },
  {
    tool: 'date-price-range',
    title: '日期和价格范围',
    Icon: IconDatePriceRange,
  },
  { tool: 'HorizontalRay', title: '水平射线 (Alt+J)', Icon: IconHorizontalRay },
  { tool: 'ParallelChannel', title: '平行通道', Icon: IconParallelChannel },
  { tool: 'Rectangle', title: '矩形', Icon: IconRectangle },
  { tool: 'text-annotation', title: '文字', Icon: IconText },
  {
    tool: 'fixed-range-volume-profile',
    title: '固定范围成交量分布图',
    Icon: IconVolumeProfile,
  },
  { tool: 'arrow-mark-up', title: '向上箭头', Icon: IconArrowUp },
  { tool: 'arrow-mark-down', title: '向下箭头', Icon: IconArrowDown },
  { tool: 'brush', title: '笔刷', Icon: IconBrush },
  {
    tool: 'rotated-rectangle',
    title: '旋转矩形',
    Icon: IconRotatedRectangle,
  },
];

export const DraggableDrawingToolbar = memo(function DraggableDrawingToolbar({
  activeTool,
  magnetEnabled,
  selectedDrawingId,
  selectedLocked,
  selectedPositionInfo,
  onSelectTool,
  onToggleMagnet,
  onUndo,
  onRedo,
  onToggleLock,
  onDeleteSelected,
  onClearAll,
  onOpenPaperTrading,
  onCreatePaperTradeFromPosition,
}: DraggableDrawingToolbarProps) {
  const [position, setPosition] = useState<{ left: number; top: number }>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.left === 'number' && typeof parsed.top === 'number') {
          return parsed;
        }
      }
    } catch (_) {
      // fallback
    }
    return { left: 16, top: 80 };
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    initLeft: number;
    initTop: number;
  } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initLeft: position.left,
      initTop: position.top,
    };
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const newLeft = Math.max(8, dragRef.current.initLeft + dx);
    const newTop = Math.max(8, dragRef.current.initTop + dy);
    setPosition({ left: newLeft, top: newTop });
  };

  const handlePointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    dragRef.current = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    } catch (_) {
      // ignore
    }
  };

  return (
    <div
      className="drawing-toolbar-floating"
      data-dragging={isDragging ? 'true' : 'false'}
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
      }}
    >
      <div
        className="toolbar-drag-handle"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title="按住拖拽画图工具栏"
      >
        <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
          <circle cx="3" cy="3" r="1" fill="#b2b5be" />
          <circle cx="7" cy="3" r="1" fill="#b2b5be" />
          <circle cx="3" cy="8" r="1" fill="#b2b5be" />
          <circle cx="7" cy="8" r="1" fill="#b2b5be" />
          <circle cx="3" cy="13" r="1" fill="#b2b5be" />
          <circle cx="7" cy="13" r="1" fill="#b2b5be" />
        </svg>
      </div>

      <div className="toolbar-button-group">
        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'select' ? 'active' : ''}`}
          onClick={() => onSelectTool('select')}
          title="选择指针 (Esc)"
        >
          <IconSelect />
        </button>

        {QUICK_TOOLS.map(({ tool, title, Icon }) => (
          <button
            key={tool}
            type="button"
            className={`toolbar-btn ${activeTool === tool ? 'active' : ''}`}
            onClick={() => onSelectTool(tool)}
            title={title}
          >
            <Icon />
          </button>
        ))}

        <button
          type="button"
          className={`toolbar-btn ${magnetEnabled ? 'active-toggle' : ''}`}
          onClick={onToggleMagnet}
          title={magnetEnabled ? '关闭磁吸' : '开启磁吸'}
        >
          <IconMagnet />
        </button>

        <button type="button" className="toolbar-btn" onClick={onUndo} title="撤销 (Ctrl+Z)">
          <IconUndo />
        </button>

        <button type="button" className="toolbar-btn" onClick={onRedo} title="重做 (Ctrl+Y)">
          <IconRedo />
        </button>

        {onOpenPaperTrading && (
          <button
            type="button"
            className="toolbar-btn"
            onClick={onOpenPaperTrading}
            title="打开模拟交易面板"
          >
            <IconPaperTrading />
          </button>
        )}

        {selectedDrawingId && (
          <button
            type="button"
            className={`toolbar-btn ${selectedLocked ? 'active' : ''}`}
            onClick={onToggleLock}
            title={selectedLocked ? '解锁选中画线' : '锁定选中画线'}
          >
            {selectedLocked ? <IconLock /> : <IconUnlock />}
          </button>
        )}

        <button
          type="button"
          className="toolbar-btn"
          disabled={!selectedDrawingId}
          onClick={onDeleteSelected}
          title="删除选中画线"
        >
          <IconTrash />
        </button>

        <button
          type="button"
          className="toolbar-btn"
          onClick={onClearAll}
          title="清空当前 Symbol 所有画线"
        >
          <IconClear />
        </button>

        {selectedPositionInfo && onCreatePaperTradeFromPosition && (
          <button
            type="button"
            className="toolbar-paper-trade-btn"
            onClick={() => onCreatePaperTradeFromPosition(selectedPositionInfo)}
            style={{
              background:
                selectedPositionInfo.type === 'LONG' ? '#089981' : '#f23645',
            }}
            title={`开仓: ${selectedPositionInfo.type} R:R=${selectedPositionInfo.rrRatio}R`}
          >
            模拟开仓 ({selectedPositionInfo.type === 'LONG' ? '多' : '空'}{' '}
            {selectedPositionInfo.rrRatio}R)
          </button>
        )}
      </div>
    </div>
  );
});

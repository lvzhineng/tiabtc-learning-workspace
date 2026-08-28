import React, {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ActiveToolType } from './drawing-types';
import type { PositionToolParams } from '@/features/paper-trading/paper-trade-types';
import {
  IconArrowDown,
  IconArrowUp,
  IconBrush,
  IconClear,
  IconDatePriceRange,
  IconEye,
  IconEyeOff,
  IconFibRetracement,
  IconHalfRetracement,
  IconHorizontalRay,
  IconLayers,
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
  disabled?: boolean;
  activeTool: ActiveToolType;
  magnetEnabled: boolean;
  selectedDrawingId: string | null;
  selectedLocked: boolean;
  selectedPositionInfo?: PositionToolParams | null;
  hideAllDrawings?: boolean;
  isObjectTreeOpen?: boolean;
  onSelectTool: (tool: ActiveToolType) => void;
  onToggleMagnet: () => void;
  onToggleHideAllDrawings?: () => void;
  onToggleObjectTree?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleLock: () => void;
  onDeleteSelected: () => void;
  onClearAll: () => void;
  clearAllTitle?: string;
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
  { tool: 'FibRetracement', title: '斐波那契回撤 (Alt+F)', Icon: IconFibRetracement },
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
  { tool: 'Rectangle', title: '矩形 (Alt+R)', Icon: IconRectangle },
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
  disabled = false,
  activeTool,
  magnetEnabled,
  selectedDrawingId,
  selectedLocked,
  selectedPositionInfo,
  hideAllDrawings = false,
  isObjectTreeOpen = false,
  onSelectTool,
  onToggleMagnet,
  onToggleHideAllDrawings,
  onToggleObjectTree,
  onUndo,
  onRedo,
  onToggleLock,
  onDeleteSelected,
  onClearAll,
  clearAllTitle = '清空当前 Symbol 所有画线',
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
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    initLeft: number;
    initTop: number;
  } | null>(null);

  const clampToParent = useCallback((next: { left: number; top: number }) => {
    const toolbar = toolbarRef.current;
    const parent = toolbar?.parentElement;
    if (!toolbar || !parent) {
      return { left: Math.max(8, next.left), top: Math.max(8, next.top) };
    }
    return {
      left: Math.min(
        Math.max(8, next.left),
        Math.max(8, parent.clientWidth - toolbar.offsetWidth - 8)
      ),
      top: Math.min(
        Math.max(8, next.top),
        Math.max(8, parent.clientHeight - toolbar.offsetHeight - 8)
      ),
    };
  }, []);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const parent = toolbar?.parentElement;
    if (!toolbar || !parent) return;
    const clampCurrentPosition = () => {
      setPosition((current) => {
        const clamped = clampToParent(current);
        if (clamped.left === current.left && clamped.top === current.top) {
          return current;
        }
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(clamped));
        } catch (_) {
          // ignore
        }
        return clamped;
      });
    };
    clampCurrentPosition();
    const observer = new ResizeObserver(clampCurrentPosition);
    observer.observe(parent);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [clampToParent]);

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
    setPosition(
      clampToParent({
        left: dragRef.current.initLeft + dx,
        top: dragRef.current.initTop + dy,
      })
    );
  };

  const handlePointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    dragRef.current = null;
    setPosition((current) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      } catch (_) {
        // ignore
      }
      return current;
    });
  };

  return (
    <div
      ref={toolbarRef}
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
          disabled={disabled}
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
            disabled={disabled}
            className={`toolbar-btn ${activeTool === tool ? 'active' : ''}`}
            onClick={() => onSelectTool(tool)}
            title={title}
          >
            <Icon />
          </button>
        ))}

        <button
          type="button"
          disabled={disabled}
          className={`toolbar-btn ${magnetEnabled ? 'active-toggle' : ''}`}
          onClick={onToggleMagnet}
          title={magnetEnabled ? '关闭磁吸' : '开启磁吸'}
        >
          <IconMagnet />
        </button>

        {onToggleHideAllDrawings && (
          <button
            type="button"
            disabled={disabled}
            className={`toolbar-btn ${hideAllDrawings ? 'active-toggle' : ''}`}
            onClick={onToggleHideAllDrawings}
            title={hideAllDrawings ? '显示所有画图 (Alt+V)' : '隐藏所有画图 (Alt+V)'}
          >
            {hideAllDrawings ? <IconEyeOff /> : <IconEye />}
          </button>
        )}

        {onToggleObjectTree && (
          <button
            type="button"
            disabled={disabled}
            className={`toolbar-btn ${isObjectTreeOpen ? 'active' : ''}`}
            onClick={onToggleObjectTree}
            title="画图图层对象树"
          >
            <IconLayers />
          </button>
        )}

        <button
          type="button"
          disabled={disabled}
          className="toolbar-btn"
          onClick={onUndo}
          title="撤销 (Ctrl+Z)"
        >
          <IconUndo />
        </button>

        <button
          type="button"
          disabled={disabled}
          className="toolbar-btn"
          onClick={onRedo}
          title="重做 (Ctrl+Y)"
        >
          <IconRedo />
        </button>

        {onOpenPaperTrading && (
          <button
            type="button"
            disabled={disabled}
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
            disabled={disabled}
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
          disabled={disabled || !selectedDrawingId}
          onClick={onDeleteSelected}
          title="删除选中画线 (Delete)"
        >
          <IconTrash />
        </button>

        <button
          type="button"
          disabled={disabled}
          className="toolbar-btn"
          onClick={onClearAll}
          title={clearAllTitle}
        >
          <IconClear />
        </button>

        {selectedPositionInfo && onCreatePaperTradeFromPosition && (
          <button
            type="button"
            disabled={disabled}
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

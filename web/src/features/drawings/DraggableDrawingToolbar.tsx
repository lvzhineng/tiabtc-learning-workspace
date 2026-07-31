import React, { memo, useRef, useState } from 'react';
import type { ActiveToolType } from './drawing-types';
import type { PositionToolParams } from '@/features/paper-trading/paper-trade-types';
import {
  Crosshair,
  Slash,
  Minus,
  Square,
  TrendingUp,
  TrendingDown,
  GitCommit,
  Ruler,
  Type,
  ArrowUp,
  ArrowDown,
  Brush as BrushIcon,
  Magnet,
  Undo,
  Redo,
  Lock,
  Unlock,
  Trash2,
  Eraser,
  Move,
  Target,
} from 'lucide-react';
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
  const dragRef = useRef<{ startX: number; startY: number; initLeft: number; initTop: number } | null>(null);

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
        <Move size={12} />
      </div>

      <div className="toolbar-button-group">
        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'select' ? 'active' : ''}`}
          onClick={() => onSelectTool('select')}
          title="选择指针 (Esc)"
        >
          <Crosshair size={15} />
        </button>

        <span className="toolbar-divider" />

        {/* 基础线性与图形 */}
        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'TrendLine' ? 'active' : ''}`}
          onClick={() => onSelectTool('TrendLine')}
          title="趋势线 (TrendLine)"
        >
          <Slash size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'HorizontalLine' ? 'active' : ''}`}
          onClick={() => onSelectTool('HorizontalLine')}
          title="水平支撑/阻力线 (HorizontalLine)"
        >
          <Minus size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'HorizontalRay' ? 'active' : ''}`}
          onClick={() => onSelectTool('HorizontalRay')}
          title="水平射线 (HorizontalRay)"
        >
          <Minus size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'VerticalLine' ? 'active' : ''}`}
          onClick={() => onSelectTool('VerticalLine')}
          title="垂直线 (VerticalLine)"
        >
          <Slash size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'Ray' ? 'active' : ''}`}
          onClick={() => onSelectTool('Ray')}
          title="射线 (Ray)"
        >
          <Slash size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'ExtendedLine' ? 'active' : ''}`}
          onClick={() => onSelectTool('ExtendedLine')}
          title="延长线 (ExtendedLine)"
        >
          <Slash size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'Arrow' ? 'active' : ''}`}
          onClick={() => onSelectTool('Arrow')}
          title="箭头线 (Arrow)"
        >
          <ArrowUp size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'ParallelChannel' ? 'active' : ''}`}
          onClick={() => onSelectTool('ParallelChannel')}
          title="平行通道 (ParallelChannel)"
        >
          <GitCommit size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'Rectangle' ? 'active' : ''}`}
          onClick={() => onSelectTool('Rectangle')}
          title="矩形结构框 (Rectangle)"
        >
          <Square size={15} />
        </button>

        <span className="toolbar-divider" />

        {/* 做多 / 做空 盈亏比与测量 */}
        <button
          type="button"
          className={`toolbar-btn btn-long ${activeTool === 'long-position' ? 'active' : ''}`}
          onClick={() => onSelectTool('long-position')}
          title="做多盈亏比 (Long Position)"
        >
          <TrendingUp size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn btn-short ${activeTool === 'short-position' ? 'active' : ''}`}
          onClick={() => onSelectTool('short-position')}
          title="做空盈亏比 (Short Position)"
        >
          <TrendingDown size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'FibRetracement' ? 'active' : ''}`}
          onClick={() => onSelectTool('FibRetracement')}
          title="斐波那契回调 (0.618/0.66)"
        >
          <GitCommit size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'date-price-range' ? 'active' : ''}`}
          onClick={() => onSelectTool('date-price-range')}
          title="日期价格区间测算 (Date & Price Range)"
        >
          <Ruler size={15} />
        </button>

        <span className="toolbar-divider" />

        {/* 标注与自由画笔 */}
        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'text-annotation' ? 'active' : ''}`}
          onClick={() => onSelectTool('text-annotation')}
          title="文字标注 (Text Annotation)"
        >
          <Type size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'arrow-mark-up' ? 'active' : ''}`}
          onClick={() => onSelectTool('arrow-mark-up')}
          title="看涨标记 (Up Arrow)"
        >
          <ArrowUp size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'arrow-mark-down' ? 'active' : ''}`}
          onClick={() => onSelectTool('arrow-mark-down')}
          title="看跌标记 (Down Arrow)"
        >
          <ArrowDown size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'brush' ? 'active' : ''}`}
          onClick={() => onSelectTool('brush')}
          title="自由画笔 (Brush)"
        >
          <BrushIcon size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'path' ? 'active' : ''}`}
          onClick={() => onSelectTool('path')}
          title="路径 (Path)"
        >
          <Slash size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'fixed-range-volume-profile' ? 'active' : ''}`}
          onClick={() => onSelectTool('fixed-range-volume-profile')}
          title="固定区间成交量分布 (Fixed Range Volume Profile)"
        >
          <Ruler size={15} />
        </button>

        <button
          type="button"
          className={`toolbar-btn ${activeTool === 'rotated-rectangle' ? 'active' : ''}`}
          onClick={() => onSelectTool('rotated-rectangle')}
          title="旋转矩形 (Rotated Rectangle)"
        >
          <Square size={15} />
        </button>

        <span className="toolbar-divider" />

        {/* 磁吸 */}
        <button
          type="button"
          className={`toolbar-btn ${magnetEnabled ? 'active-toggle' : ''}`}
          onClick={onToggleMagnet}
          title={magnetEnabled ? '关闭磁吸' : '开启磁吸吸附 (🧲)'}
        >
          <Magnet size={15} />
        </button>

        <span className="toolbar-divider" />

        {/* 撤销重做 */}
        <button type="button" className="toolbar-btn" onClick={onUndo} title="撤销 (Ctrl+Z)">
          <Undo size={15} />
        </button>

        <button type="button" className="toolbar-btn" onClick={onRedo} title="重做 (Ctrl+Y)">
          <Redo size={15} />
        </button>

        <span className="toolbar-divider" />

        {/* 模拟交易入口按钮 */}
        {onOpenPaperTrading && (
          <button
            type="button"
            className="toolbar-btn"
            onClick={onOpenPaperTrading}
            title="打开模拟交易面板"
            style={{ color: 'var(--accent-blue)' }}
          >
            <Target size={15} />
          </button>
        )}

        {/* 选中控制与删除 */}
        {selectedDrawingId && (
          <button
            type="button"
            className={`toolbar-btn ${selectedLocked ? 'active' : ''}`}
            onClick={onToggleLock}
            title={selectedLocked ? '解锁选中画线' : '锁定选中画线'}
          >
            {selectedLocked ? <Lock size={15} /> : <Unlock size={15} />}
          </button>
        )}

        <button
          type="button"
          className="toolbar-btn btn-danger"
          disabled={!selectedDrawingId}
          onClick={onDeleteSelected}
          title="删除选中画线"
        >
          <Trash2 size={15} />
        </button>

        <button
          type="button"
          className="toolbar-btn btn-danger"
          onClick={onClearAll}
          title="清空当前 Symbol 所有画线"
        >
          <Eraser size={15} />
        </button>

        {/* 模拟开仓联动触发按钮 */}
        {selectedPositionInfo && onCreatePaperTradeFromPosition && (
          <button
            type="button"
            onClick={() => onCreatePaperTradeFromPosition(selectedPositionInfo)}
            style={{
              marginTop: '4px',
              background: selectedPositionInfo.type === 'LONG' ? 'var(--accent-green)' : 'var(--accent-red)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 4px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title={`开仓: ${selectedPositionInfo.type} R:R=${selectedPositionInfo.rrRatio}R`}
          >
            🎯 模拟开仓 ({selectedPositionInfo.type === 'LONG' ? '多' : '空'} {selectedPositionInfo.rrRatio}R)
          </button>
        )}
      </div>
    </div>
  );
});

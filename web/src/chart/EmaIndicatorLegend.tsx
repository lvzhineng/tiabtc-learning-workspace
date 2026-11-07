import { useLayoutEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Info } from 'lucide-react';
import { EMA_COLORS, EMA_PERIODS, type EmaPeriod, type EmaVisibility } from './ema';
import { formatPrice } from './chart-price';
import './ema-indicator-legend.css';

export type EmaIndicatorLegendProps = {
  visibility: EmaVisibility;
  values: Record<EmaPeriod, number | null>;
  precision?: number;
  collapsed: boolean;
  onToggle: (period: EmaPeriod) => void;
  onToggleAll: () => void;
  onToggleCollapsed: () => void;
  loading?: boolean;
  warning?: string | null;
  warmupCount?: number;
};

function stopChartEvent(event: SyntheticEvent): void {
  event.stopPropagation();
}

export function EmaIndicatorLegend({
  visibility,
  values,
  precision = 2,
  collapsed,
  onToggle,
  onToggleAll,
  onToggleCollapsed,
  loading = false,
  warning,
  warmupCount,
}: EmaIndicatorLegendProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number>();
  const allVisible = EMA_PERIODS.every((period) => visibility[period]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const pane = root?.closest('.chart-canvas-price-pane');
    if (!root || !(pane instanceof HTMLElement)) return;
    const toolbar = pane.closest('.bitlang-chart, .review-chart-area')?.querySelector('.drawing-toolbar-floating');
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const base = Number.parseFloat(getComputedStyle(root).getPropertyValue('--ema-legend-base-top')) || 8;
      const bounds = root.getBoundingClientRect();
      const paneBounds = pane.getBoundingClientRect();
      const obstacle = toolbar?.getBoundingClientRect();
      let next = base;
      if (obstacle && bounds.left < obstacle.right && bounds.right > obstacle.left &&
        paneBounds.top + base < obstacle.bottom && paneBounds.top + base + bounds.height > obstacle.top) {
        const above = obstacle.top - paneBounds.top - bounds.height - 8;
        next = above >= base ? above : obstacle.bottom - paneBounds.top + 8;
      }
      next = Math.max(base, Math.min(next, paneBounds.height - bounds.height - 8));
      setTop((previous) => previous === next ? previous : next);
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    resize.observe(pane);
    if (toolbar) resize.observe(toolbar);
    const mutation = new MutationObserver(schedule);
    if (toolbar) mutation.observe(toolbar, { attributes: true, attributeFilter: ['style', 'data-dragging'] });
    measure();
    return () => { resize.disconnect(); mutation.disconnect(); if (frame !== null) cancelAnimationFrame(frame); };
  }, [collapsed, loading, Boolean(warning)]);

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      const activeElement = rootRef.current?.ownerDocument.activeElement;
      if (activeElement instanceof HTMLElement) activeElement.blur();
    }
  };

  return (
    <div
      ref={rootRef}
      className="ema-legend"
      style={{ top }}
      onPointerDownCapture={stopChartEvent}
      onPointerUpCapture={stopChartEvent}
      onClick={stopChartEvent}
      onDoubleClickCapture={stopChartEvent}
      onContextMenuCapture={stopChartEvent}
      onWheelCapture={stopChartEvent}
      onKeyDownCapture={handleKeyDownCapture}
      onKeyUpCapture={stopChartEvent}
    >
      <div className={`ema-legend__panel${collapsed ? ' is-collapsed' : ''}`}>
        <div className="ema-legend__header">
          <button
            type="button"
            className="ema-legend__collapse"
            aria-label={collapsed ? '展开 EMA 指标' : '折叠 EMA 指标'}
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
            title={collapsed ? '展开指标' : '折叠指标'}
          >
            {collapsed ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
            <span>EMA</span>
          </button>
          {!collapsed && (
            <div className="ema-legend__header-actions">
              {loading && <span className="ema-legend__loading" role="status">预热中</span>}
              {warning && (
                <span
                  className="ema-legend__warning"
                  title={warning}
                  aria-label={`指标提示：${warning}`}
                  role="img"
                  tabIndex={0}
                >
                  <Info aria-hidden="true" />
                </span>
              )}
              <button
                type="button"
                className="ema-legend__all-toggle"
                aria-label={allVisible ? '隐藏全部 EMA' : '显示全部 EMA'}
                aria-pressed={allVisible}
                onClick={onToggleAll}
                title={allVisible ? '隐藏全部' : '显示全部'}
              >
                {allVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </div>
          )}
        </div>
        {!collapsed && (
          <div className="ema-legend__rows">
            {EMA_PERIODS.map((period) => {
              const visible = visibility[period];
              const insufficientWarmup = !loading && warmupCount !== undefined && warmupCount < period;
              const rowTitle = insufficientWarmup
                ? `可用的已揭示 K 线少于 ${period} 根，EMA ${period} 尚在预热`
                : undefined;
              const value = values[period];

              return (
                <div
                  key={period}
                  className={`ema-legend__row${visible ? '' : ' is-hidden'}`}
                  title={rowTitle}
                >
                  <span className="ema-legend__label" style={{ color: EMA_COLORS[period] }}>
                    EMA {period}
                  </span>
                  <span className="ema-legend__value" aria-label={value == null ? '无数值' : undefined}>
                    {value == null ? '—' : formatPrice(value, precision)}
                  </span>
                  <button
                    type="button"
                    className="ema-legend__visibility"
                    aria-label={`${visible ? '隐藏' : '显示'} EMA ${period}`}
                    aria-pressed={visible}
                    onClick={() => onToggle(period)}
                    title={`${visible ? '隐藏' : '显示'} EMA ${period}`}
                  >
                    {visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

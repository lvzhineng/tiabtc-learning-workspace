import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { SESSION_DETAILS, TRADING_SESSIONS, type TradingSession } from './trading-sessions';
import '@/styles/trading-sessions.css';

type Props = { value: TradingSession[]; onChange: (value: TradingSession[]) => void };

export function TradingSessionControl({ value, onChange }: Props) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!position) return;
    panelRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    const outside = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node) && !buttonRef.current?.contains(event.target as Node)) setPosition(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setPosition(null); buttonRef.current?.focus(); }
    };
    const close = () => setPosition(null);
    const focusOutside = (event: FocusEvent) => {
      if (!panelRef.current?.contains(event.target as Node) && !buttonRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('focusin', focusOutside);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('focusin', focusOutside);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [Boolean(position)]);
  return <>
    <button
      ref={buttonRef}
      type="button"
      className={`trading-session-toggle${value.length ? ' trading-session-toggle-active' : ''}`}
      aria-expanded={Boolean(position)}
      aria-controls={position ? panelId : undefined}
      title={`交易时段${value.length ? `：${value.map((session) => SESSION_DETAILS[session].name).join('、')}` : '：选择亚盘、欧盘、美盘'}`}
      onClick={() => {
        if (position) { setPosition(null); return; }
        const rect = buttonRef.current!.getBoundingClientRect();
        setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)), top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 282)) });
      }}
    >
      交易时段
      {value.length > 0 && <span className="trading-session-dots" aria-hidden>{value.map((session) => <i key={session} style={{ background: SESSION_DETAILS[session].color }} />)}</span>}
      <ChevronDown size={12} />
    </button>
    {position && createPortal(<div ref={panelRef} id={panelId} className="trading-session-panel" role="group" aria-label="交易时段选择" style={position}>
      <div className="trading-session-heading"><strong>交易时段</strong><span>北京时间 · 可多选</span></div>
      {TRADING_SESSIONS.map((session) => <label key={session} className="trading-session-option">
        <input type="checkbox" checked={value.includes(session)} onChange={(event) => onChange(TRADING_SESSIONS.filter((item) => item === session ? event.target.checked : value.includes(item)))} />
        <i style={{ background: SESSION_DETAILS[session].color }} aria-hidden />
        <span><strong>{SESSION_DETAILS[session].name} · {SESSION_DETAILS[session].city}</strong><small>{SESSION_DETAILS[session].hours}</small></span>
      </label>)}
      <div className="trading-session-actions"><button type="button" onClick={() => onChange([...TRADING_SESSIONS])}>全选</button><button type="button" onClick={() => onChange([])}>清除</button></div>
      <p>参考三地现货常规时段，欧美自动适配夏令时。节假日仍标注；日线、周线不显示。</p>
    </div>, document.body)}
  </>;
}

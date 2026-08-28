import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';
import { subscribeConfirm, type ConfirmRequest } from './confirm';

export function GlobalConfirmDialog() {
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);
  const current = queue[0] || null;
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const decidingRef = useRef(false);

  useEffect(() => {
    return subscribeConfirm((request) => {
      setQueue((prev) => [...prev, request]);
    });
  }, []);

  const handleDecision = (value: boolean) => {
    if (!current || decidingRef.current) return;
    decidingRef.current = true;
    current.resolve(value);
    setQueue((prev) =>
      prev[0]?.id === current.id ? prev.slice(1) : prev
    );
  };

  useEffect(() => {
    decidingRef.current = false;
  }, [current?.id]);

  useEffect(() => {
    if (!current) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const background = document.querySelector('.app-shell');
    background?.setAttribute('inert', '');
    return () => {
      background?.removeAttribute('inert');
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [Boolean(current)]);

  useEffect(() => {
    if (!current) return;

    // Focus confirm button when dialog opens
    const timer = setTimeout(() => {
      confirmBtnRef.current?.focus();
    }, 50);

    const handleKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        handleDecision(false);
      } else if (event.key === 'Tab') {
        const focusable = Array.from(
          modalRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ) || []
        );
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      } else if (event.key === 'Enter') {
        // If not in a textarea/button, enter confirms
        if (document.activeElement?.tagName !== 'BUTTON') {
          event.preventDefault();
          event.stopPropagation();
          handleDecision(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [current]);

  if (!current) return null;

  return (
    <div
      className="confirm-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDecision(false);
      }}
      role="dialog"
      aria-modal="true"
    >
      <div ref={modalRef} className="confirm-modal">
        <div className="confirm-header">
          <div className="confirm-title-wrap">
            {current.isDanger ? (
              <AlertTriangle size={18} className="confirm-icon danger" />
            ) : (
              <HelpCircle size={18} className="confirm-icon info" />
            )}
            <h3 className="confirm-title">{current.title || '确认操作'}</h3>
          </div>
          <button
            type="button"
            className="confirm-close-btn"
            onClick={() => handleDecision(false)}
            title="关闭"
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <div className="confirm-body">
          {typeof current.message === 'string' ? (
            <p className="confirm-message">{current.message}</p>
          ) : (
            current.message
          )}
        </div>

        <div className="confirm-footer">
          <button
            type="button"
            className="confirm-btn cancel"
            onClick={() => handleDecision(false)}
          >
            {current.cancelText || '取消'}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`confirm-btn ${current.isDanger ? 'danger' : 'primary'}`}
            onClick={() => handleDecision(true)}
          >
            {current.confirmText || '确定'}
          </button>
        </div>
      </div>
    </div>
  );
}

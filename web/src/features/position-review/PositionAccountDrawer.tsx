import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './position-account-drawer.css';

export function PositionAccountDrawer({
  open,
  onClose,
  children,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  onCloseRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const appShell = document.querySelector<HTMLElement>('.app-shell');
    const wasInert = appShell?.inert ?? false;
    if (appShell) appShell.inert = true;

    const focusFrame = window.requestAnimationFrame(() => {
      const closeButton = closeRef.current;
      if (closeButton && !closeButton.disabled) closeButton.focus();
      else panelRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (appShell?.isConnected) appShell.inert = wasInert;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || document.querySelector('.confirm-overlay')) return;
    const panel = panelRef.current;
    const active = document.activeElement;
    // Disabling a clicked save/audit button can move native focus to <body>.
    // Keep Escape and Tab in this dialog as the operation starts or finishes.
    if (panel && (!panel.contains(active) || (active instanceof HTMLElement && active.matches(':disabled')))) {
      if (busy) panel.focus();
      else closeRef.current?.focus();
    }
  }, [open, busy]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // A confirmation dialog rendered above this drawer owns its keyboard focus.
    if (document.querySelector('.confirm-overlay')) return;
    event.stopPropagation();

    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busyRef.current) onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab') return;

    const panel = panelRef.current;
    const focusable = Array.from(panel?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
    ) ?? []).filter((element) => {
      if (element.hasAttribute('hidden') || element.getClientRects().length === 0) return false;

      let ancestor = element.parentElement;
      while (ancestor && ancestor !== panel) {
        if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
          const summary = ancestor.querySelector<HTMLElement>(':scope > summary');
          if (!summary?.contains(element)) return false;
        }
        ancestor = ancestor.parentElement;
      }
      return true;
    });
    if (!focusable.length) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="position-account-drawer-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busyRef.current) onCloseRef.current();
      }}
    >
      <section
        ref={panelRef}
        className="position-account-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="position-account-drawer-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="position-account-drawer-header">
          <div>
            <h2 id="position-account-drawer-title">账户管理</h2>
            <p>连接状态、账户与同步选项</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="position-account-drawer-close"
            aria-label="关闭账户管理"
            title={busy ? '操作完成后即可关闭' : '关闭'}
            onClick={() => onCloseRef.current()}
            disabled={busy}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>
        <div className="position-account-drawer-content">{children}</div>
      </section>
    </div>,
    document.body
  );
}

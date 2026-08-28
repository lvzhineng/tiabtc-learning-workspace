import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { subscribeToast, type ToastItem } from './toast';

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToast((newToast) => {
      setToasts((current) => [...current, newToast].slice(-5));
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  return (
    <div className="toast-container" aria-live="polite" aria-atomic="true">
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={removeToast} />
      ))}
    </div>
  );
}

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    if (item.duration <= 0) return;
    const timer = setTimeout(() => {
      onDismiss(item.id);
    }, item.duration);
    return () => clearTimeout(timer);
  }, [item.duration, item.id, onDismiss]);

  const renderIcon = () => {
    switch (item.type) {
      case 'success':
        return <CheckCircle2 size={16} className="toast-icon success" />;
      case 'warning':
        return <AlertTriangle size={16} className="toast-icon warning" />;
      case 'error':
        return <AlertCircle size={16} className="toast-icon error" />;
      default:
        return <Info size={16} className="toast-icon info" />;
    }
  };

  return (
    <div className={`toast-card toast-${item.type}`} role="status">
      <div className="toast-content">
        {renderIcon()}
        <span className="toast-message">{item.message}</span>
      </div>
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(item.id)}
        title="关闭通知"
        aria-label="关闭"
      >
        <X size={14} />
      </button>
    </div>
  );
}

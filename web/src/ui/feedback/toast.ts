export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

type ToastListener = (toast: ToastItem) => void;

const listeners = new Set<ToastListener>();

export function subscribeToast(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showToast(
  message: string,
  type: ToastType = 'info',
  duration = 3500
): void {
  const item: ToastItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    message,
    duration,
  };
  listeners.forEach((listener) => listener(item));
}

export const toast = {
  info: (message: string, duration = 3000) => showToast(message, 'info', duration),
  success: (message: string, duration = 3000) => showToast(message, 'success', duration),
  warning: (message: string, duration = 4000) => showToast(message, 'warning', duration),
  error: (message: string, duration = 4500) => showToast(message, 'error', duration),
};

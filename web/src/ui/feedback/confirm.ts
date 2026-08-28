import type { ReactNode } from 'react';

export interface ConfirmOptions {
  title?: string;
  message: ReactNode | string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
}

export interface ConfirmRequest extends ConfirmOptions {
  id: string;
  resolve: (value: boolean) => void;
}

type ConfirmListener = (request: ConfirmRequest) => void;

const listeners = new Set<ConfirmListener>();

export function subscribeConfirm(listener: ConfirmListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const request: ConfirmRequest = {
      ...options,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      resolve,
    };
    listeners.forEach((listener) => listener(request));
  });
}

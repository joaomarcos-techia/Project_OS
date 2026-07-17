'use client';

import { useSyncExternalStore } from 'react';

/**
 * Store de toasts — módulo singleton, sem Context/Provider (Governança de UI
 * regra 6: complexidade global é exceção). Qualquer client component chama
 * `toast.*()`; o <Toaster/> montado no layout renderiza a fila.
 */
export type ToastVariant = 'success' | 'error' | 'info' | 'ai';

export type ToastItem = {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string;
  /** ms até auto-dismiss */
  duration: number;
};

type Listener = () => void;

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const l of listeners) l();
}

function push(variant: ToastVariant, title: string, description?: string, duration?: number) {
  const id = nextId++;
  const ms = duration ?? (variant === 'error' ? 6000 : 4000);
  items = [
    ...items,
    { id, variant, title, duration: ms, ...(description !== undefined ? { description } : {}) },
  ];
  timers.set(
    id,
    setTimeout(() => dismissToast(id), ms),
  );
  emit();
  return id;
}

export function dismissToast(id: number) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
  const before = items.length;
  items = items.filter((i) => i.id !== id);
  if (items.length !== before) emit();
}

export const toast = {
  success: (title: string, description?: string, duration?: number) =>
    push('success', title, description, duration),
  error: (title: string, description?: string, duration?: number) =>
    push('error', title, description, duration),
  info: (title: string, description?: string, duration?: number) =>
    push('info', title, description, duration),
  ai: (title: string, description?: string, duration?: number) =>
    push('ai', title, description, duration),
};

function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot() {
  return items;
}

function getServerSnapshot(): ToastItem[] {
  return EMPTY;
}

const EMPTY: ToastItem[] = [];

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Só para testes: zera a fila. */
export function _resetToasts() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  items = [];
  emit();
}

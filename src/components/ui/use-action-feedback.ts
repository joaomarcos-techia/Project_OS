'use client';

import { useEffect, useRef } from 'react';

import { toast } from './use-toast';

export type ActionFeedback = {
  type: 'success' | 'error';
  title: string;
  description?: string;
} | null;

/**
 * Conecta o state de um `useActionState` ao toast global — substitui o padrão
 * local `msg = {ok, text}` (banner por tela). Erros de validação por campo
 * continuam inline no `Field error`; aqui vai só o desfecho da action.
 *
 * `resolve` traduz o state da action (shape livre — {ok,text}, {error}, …)
 * em feedback; retorne null para não notificar (ex.: state inicial).
 */
export function useActionFeedback<S>(state: S, resolve: (state: S) => ActionFeedback) {
  const prev = useRef(state);
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

  useEffect(() => {
    if (Object.is(state, prev.current)) return;
    prev.current = state;
    const fb = resolveRef.current(state);
    if (!fb) return;
    if (fb.type === 'success') toast.success(fb.title, fb.description);
    else toast.error(fb.title, fb.description);
  }, [state]);
}

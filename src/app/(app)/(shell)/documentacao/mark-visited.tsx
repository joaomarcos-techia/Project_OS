'use client';

import { useEffect, useRef } from 'react';

import { submitOnboardingAction } from '../_painel/onboarding-actions';

/**
 * Marca "já conheceu a central de ajuda" na primeira visita.
 *
 * Existe como efeito de cliente, e não como escrita no render do servidor,
 * porque abrir uma página é um GET: um GET que escreve seria reexecutado por
 * prefetch e por recarregamento, e o carimbo deixaria de responder "quando
 * descobriu a ajuda". A gravação em si é idempotente no banco (`IS NULL`), então
 * o ref aqui evita a chamada repetida, não a duplicidade.
 */
export function MarkDocsVisited() {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    // Falha aqui não pode atrapalhar a leitura da documentação: a visita é
    // telemetria de onboarding, não o conteúdo da página.
    void submitOnboardingAction({ action: 'docs_visited' }).catch(() => {});
  }, []);
  return null;
}

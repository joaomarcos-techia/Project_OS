'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { toast } from '@/components/ui/use-toast';

import { fetchOpenHandoffs } from './handoff-actions';

/** Igual ao inbox: 20s é frequente o bastante e não mantém aba de fundo ativa. */
export const HANDOFF_POLL_INTERVAL_MS = 20_000;

/** Acima disto vira um resumo — três toasts empilhados já é ruído. */
const MAX_INDIVIDUAL_TOASTS = 3;

/**
 * 5s, acima dos 4s padrão do `info`: quem atende costuma estar olhando outra
 * tela, e um segundo a mais é a diferença entre ver e perder o aviso. O X de
 * dispensar já vem do <Toaster/>, então quem não quer esperar fecha na hora.
 */
const HANDOFF_TOAST_MS = 5_000;

/**
 * Avisa quem atende que um paciente pediu uma pessoa.
 *
 * Fica no layout, então continua montado entre navegações — é por isso que o
 * conjunto de "já vistos" mora num ref e não em storage: ele sobrevive à troca
 * de rota, que é o caso real. Num reload completo o baseline é refeito, e isso
 * é deliberado: reabrir o app não deve reproduzir toasts de horas atrás.
 *
 * A primeira carga NÃO dispara um toast por item pendente — mostraria uma pilha
 * de avisos antigos como se tivessem acabado de chegar. Ela resume o que já
 * espera; dali em diante, só o que é novo.
 */
export function HandoffWatcher() {
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      let pending;
      try {
        pending = await fetchOpenHandoffs();
      } catch {
        // Rede instável não pode virar toast de erro: quem atende não tem o que
        // fazer com isso, e o próximo ciclo tenta de novo.
        return;
      }
      if (cancelled) return;

      // Primeira carga: estabelece o baseline e resume o que já espera.
      if (seen.current === null) {
        seen.current = new Set(pending.map((h) => h.conversationId));
        if (pending.length > 0) {
          toast.info(
            pending.length === 1
              ? 'Uma conversa aguarda atendimento'
              : `${pending.length} conversas aguardam atendimento`,
            'Abra Conversas IA para assumir.',
            HANDOFF_TOAST_MS,
          );
        }
        return;
      }

      const novos = pending.filter((h) => !seen.current!.has(h.conversationId));
      for (const h of pending) seen.current.add(h.conversationId);
      // Handoff resolvido volta a notificar se o paciente pedir de novo.
      const abertos = new Set(pending.map((h) => h.conversationId));
      for (const id of seen.current) if (!abertos.has(id)) seen.current.delete(id);

      if (novos.length === 0) return;

      if (novos.length > MAX_INDIVIDUAL_TOASTS) {
        toast.info(
          `${novos.length} pacientes pediram atendimento`,
          'Abra Conversas IA para assumir.',
          HANDOFF_TOAST_MS,
        );
      } else {
        for (const h of novos) {
          toast.info(
            h.priority === 'urgent'
              ? 'Paciente pediu atendimento (urgente)'
              : 'Paciente pediu atendimento',
            'Abra Conversas IA para assumir.',
            HANDOFF_TOAST_MS,
          );
        }
      }
      // A lista de conversas fica no servidor; sem isto o toast avisaria de algo
      // que a tela aberta ainda não mostra.
      router.refresh();
    };

    void check();
    const interval = window.setInterval(() => void check(), HANDOFF_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [router]);

  return null;
}

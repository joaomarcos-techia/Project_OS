'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { submitOnboardingAction } from '../../_painel/onboarding-actions';

/**
 * Dispensa o checklist de ativação.
 *
 * O checklist já some sozinho quando os cinco passos terminam. Dispensar serve
 * para a clínica que decidiu NÃO fazer algum deles — conectar o WhatsApp, por
 * exemplo — e não quer o lembrete para sempre. É por isso que dispensar não
 * marca nada como concluído: os itens continuam derivados do banco, e reabrir a
 * conversa é ver o mesmo estado real de antes.
 */
export function ChecklistDismiss() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      data-testid="checklist-dismiss"
      className="rounded-(--r-sm) px-2 py-1 text-(length:--fs-xs) text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg focus-visible:shadow-(--focus-ring) focus-visible:outline-none disabled:opacity-60"
      onClick={() =>
        startTransition(async () => {
          await submitOnboardingAction({ action: 'checklist_dismiss' });
          router.refresh();
        })
      }
    >
      Dispensar
    </button>
  );
}

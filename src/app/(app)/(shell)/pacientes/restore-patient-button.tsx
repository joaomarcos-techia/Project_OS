'use client';

/**
 * PAT-001 — desfazer a remoção de um paciente.
 *
 * A tela informava "remoção definitiva em 30 dias", sugerindo uma janela de
 * arrependimento, e não havia nenhum controle para usá-la: um clique errado só
 * era reversível mexendo direto no banco.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { uuidv4 } from '@/lib/ui/uuid';

import { restaurarPacienteAction } from './actions';

export function RestorePatientButton({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Chave estável por tentativa: um duplo clique é o MESMO restore, não dois.
  const [idempotencyKey, setIdempotencyKey] = useState(uuidv4);

  function restore() {
    startTransition(async () => {
      const result = await restaurarPacienteAction(patientId, idempotencyKey);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setIdempotencyKey(uuidv4());
      toast.success(
        result.restored
          ? 'Paciente restaurado.'
          : 'Este paciente já estava ativo — nada foi alterado.',
      );
      router.refresh();
    });
  }

  return (
    <Button type="button" size="sm" variant="ghost" loading={pending} onClick={restore}>
      Restaurar
    </Button>
  );
}

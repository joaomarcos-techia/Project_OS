'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import type { ProfessionalProfile } from '@/contexts/identity/queries';

import { updateProfessionalCredentialAction } from './actions';

export function ProfessionalCredentialForm({ initial }: { initial: ProfessionalProfile }) {
  const router = useRouter();
  const [crm, setCrm] = useState(initial.crm ?? '');
  const [crmUf, setCrmUf] = useState(initial.crmUf ?? '');
  const [especialidade, setEspecialidade] = useState(initial.especialidade ?? '');
  const [saving, startSaving] = useTransition();

  function save(): void {
    startSaving(async () => {
      const result = await updateProfessionalCredentialAction({ crm, crmUf, especialidade });
      if (result.ok) {
        setCrm(result.credential.crm);
        setCrmUf(result.credential.crmUf);
        setEspecialidade(result.credential.especialidade ?? '');
        router.refresh();
        toast.success('Credencial profissional salva.');
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div
      className="cardblock wrap-pad flex flex-col gap-3"
      data-testid="professional-credential-form"
    >
      <div>
        <h4 className="text-sm font-semibold">Credencial profissional</h4>
        <p className="mt-1 text-sm text-fg-muted">
          Se você também atende pacientes, informe seu CRM para aparecer como profissional e emitir
          documentos.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_5rem]">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg-muted">CRM</span>
          <Input
            value={crm}
            onChange={(event) => setCrm(event.currentTarget.value)}
            inputMode="text"
            maxLength={20}
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg-muted">UF</span>
          <Input
            value={crmUf}
            onChange={(event) => setCrmUf(event.currentTarget.value.toUpperCase())}
            maxLength={2}
            autoCapitalize="characters"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-fg-muted">Especialidade</span>
        <Input
          value={especialidade}
          onChange={(event) => setEspecialidade(event.currentTarget.value)}
          maxLength={120}
        />
      </label>
      <div>
        <Button type="button" size="sm" loading={saving} onClick={save}>
          Salvar credencial
        </Button>
      </div>
    </div>
  );
}

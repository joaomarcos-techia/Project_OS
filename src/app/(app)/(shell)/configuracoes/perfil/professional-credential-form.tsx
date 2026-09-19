'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
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
    <Card
      className="flex max-w-190 flex-col gap-(--sp-4) p-(--card-pad)"
      data-testid="professional-credential-form"
    >
      <div>
        <h2 className="text-(length:--fs-subsection) font-semibold">Credencial profissional</h2>
        <p className="mt-1 text-(length:--fs-body-sm) text-fg-muted">
          Se você também atende pacientes, informe seu CRM para aparecer como profissional e emitir
          documentos.
        </p>
      </div>
      <div className="grid gap-(--sp-4) sm:grid-cols-[minmax(0,1fr)_6rem]">
        <Field label="CRM" htmlFor="cred-crm">
          <Input
            id="cred-crm"
            value={crm}
            onChange={(event) => setCrm(event.currentTarget.value)}
            inputMode="text"
            maxLength={20}
            autoComplete="off"
          />
        </Field>
        <Field label="UF" htmlFor="cred-uf">
          <Input
            id="cred-uf"
            value={crmUf}
            onChange={(event) => setCrmUf(event.currentTarget.value.toUpperCase())}
            maxLength={2}
            autoCapitalize="characters"
          />
        </Field>
      </div>
      <Field label="Especialidade" htmlFor="cred-especialidade">
        <Input
          id="cred-especialidade"
          value={especialidade}
          onChange={(event) => setEspecialidade(event.currentTarget.value)}
          maxLength={120}
        />
      </Field>
      <div>
        <Button type="button" loading={saving} onClick={save}>
          Salvar credencial
        </Button>
      </div>
    </Card>
  );
}

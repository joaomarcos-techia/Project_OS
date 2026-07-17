/**
 * /modelos-receita — gestão dos modelos de receita do médico logado (Fase 2).
 * Pessoal por médico (doctor_id); RLS isola por clínica. CRUD via Server Actions
 * (create:prescription). Aplicar um modelo acontece no editor de prescrição.
 */
import { listPrescriptionTemplates } from '@/contexts/clinical/queries';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { PageHeader } from '@/components/ui/page-header';

import { TemplatesManager } from './templates-manager';

export const dynamic = 'force-dynamic';

export default async function ModelosReceitaPage() {
  const user = await requireUser();
  const clinicId = await requireClinicId();
  const templates = await listPrescriptionTemplates(clinicId, user.userId);

  return (
    <div>
      <PageHeader
        title="Modelos de receita"
        description="Gabaritos reutilizáveis de prescrição. Aplique-os no editor antes de emitir — modelos nunca emitem sozinhos."
      />
      <TemplatesManager initial={templates} />
    </div>
  );
}

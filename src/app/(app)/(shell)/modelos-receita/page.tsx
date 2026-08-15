/**
 * /modelos-receita — gestão dos modelos de receita do médico logado (Fase 2).
 * Pessoal por médico (doctor_id); RLS isola por clínica. CRUD via Server Actions
 * (create:prescription). Aplicar um modelo acontece no editor de prescrição.
 */
import { listPrescriptionTemplates } from '@/contexts/clinical/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { pageGate } from '@/lib/auth/page-guard';
import { PageNoAccess } from '@/components/shared/page-no-access';
import { PageHeader } from '@/components/ui/page-header';

import { TemplatesManager } from './templates-manager';

export const dynamic = 'force-dynamic';

export default async function ModelosReceitaPage() {
  // AUTHZ-004 — a tela inteira É gestão de modelos, e as quatro actions já
  // exigem `create:prescription`. A rota tem de exigir o mesmo: sem isso a UI
  // oferecia "Novo modelo" a quem a action ia negar.
  const gate = await pageGate([PERMISSIONS.CREATE_PRESCRIPTION]);
  if (!gate.allowed) {
    return (
      <PageNoAccess
        title="Modelos de receita"
        description="Seu perfil não tem permissão para gerenciar modelos de receita. Fale com um gestor se precisar de acesso."
      />
    );
  }
  const { clinicId, user } = gate;
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

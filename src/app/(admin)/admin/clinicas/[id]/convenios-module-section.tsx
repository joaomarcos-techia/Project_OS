import { headers } from 'next/headers';

import { readConveniosModuleState } from '@/contexts/health-insurance';
import { buildRequestContext } from '@/lib/audit/request-context';

import { ConveniosModuleForm } from './convenios-module-form';

/**
 * P1.13 — estado de Convênios da clínica no detalhe do console. A leitura passa pelo serviço do Convênios (super
 * admin com AAL2, registrada em `super_admin_actions`). Falha de leitura não derruba a página.
 */
export async function ConveniosModuleSection({ clinicId }: { clinicId: string }) {
  let state: Awaited<ReturnType<typeof readConveniosModuleState>> | null = null;
  try {
    state = await readConveniosModuleState(clinicId, buildRequestContext(await headers()));
  } catch {
    state = null;
  }
  if (!state?.clinic) {
    return (
      <p className="text-sm text-fg-subtle" data-convenios-module-unavailable>
        Não foi possível ler o estado de Convênios desta clínica agora.
      </p>
    );
  }
  return (
    <ConveniosModuleForm
      clinicId={clinicId}
      view={{
        available: state.available,
        enabled: state.clinic.enabled,
        enabledAt: state.clinic.enabledAt,
        commercialDenial: state.clinic.commercialDenial,
      }}
    />
  );
}

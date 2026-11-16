import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

import { allows, conveniosRights, guideScopeFor } from './rights';

const P = PERMISSIONS;
/** Pacotes da 0162 somados ao que cada papel já tinha e importa aqui. */
const BUNDLE = {
  owner: [P.VIEW_CONVENIOS, P.MANAGE_CONVENIOS, P.OPERATE_CONVENIOS, P.VIEW_FATURAMENTO_CONVENIO, P.MANAGE_FATURAMENTO_CONVENIO, P.VIEW_FINANCIAL, P.MANAGE_FINANCIAL],
  attendant: [P.VIEW_CONVENIOS, P.OPERATE_CONVENIOS, P.VIEW_FINANCIAL, P.EDIT_PATIENT, P.EDIT_AGENDA],
  financial: [P.VIEW_CONVENIOS, P.VIEW_FATURAMENTO_CONVENIO, P.MANAGE_FATURAMENTO_CONVENIO, P.VIEW_FINANCIAL, P.MANAGE_FINANCIAL],
  doctor: [P.VIEW_CONVENIOS, P.EDIT_PATIENT, P.EDIT_AGENDA, P.CREATE_PRONTUARIO],
} as const;

describe('direitos de Convênios (matriz I.2)', () => {
  it('owner e gestor: tudo, clínica inteira', () => {
    const r = conveniosRights(BUNDLE.owner);
    expect(r).toMatchObject({ view: true, configure: true, operate: true, seeValues: true, bill: true, broad: true });
  });

  it('recepção: opera e confere, sem valores, sem cadastro (D-1/D-2), sem faturar', () => {
    const r = conveniosRights(BUNDLE.attendant);
    expect(r).toMatchObject({ view: true, operate: true, configure: false, seeValues: false, bill: false, broad: true });
    expect(allows(BUNDLE.attendant, 'operateOrBill')).toBe(true);
    // D-5 fase 1–2: mantém o PDF/arquivo emitido que já tinha; não ganha cobrança do paciente.
    expect(r.emittedDocuments).toBe(true);
    expect(r.patientCharge).toBe(false);
  });

  it('financeiro: vê valores e fatura; não configura (D-1, D-2) nem opera a recepção', () => {
    const r = conveniosRights(BUNDLE.financial);
    expect(r).toMatchObject({ view: true, seeValues: true, bill: true, configure: false, operate: false, broad: true });
    expect(r.patientCharge).toBe(true);
  });

  it('médica: só entra; sem visão ampla (só as próprias guias), sem valores (D-4), sem documentos emitidos', () => {
    const r = conveniosRights(BUNDLE.doctor);
    expect(r).toMatchObject({ view: true, operate: false, seeValues: false, bill: false, configure: false, broad: false });
    expect(r.emittedDocuments).toBe(false);
    expect(guideScopeFor(r, 'u-1')).toEqual({ kind: 'own', professionalId: 'u-1' });
    // D-4: a visão de valores concedida individualmente (override auditado) dá valores e visão ampla.
    const granted = conveniosRights([...BUNDLE.doctor, P.VIEW_FATURAMENTO_CONVENIO]);
    expect(granted.seeValues).toBe(true);
    expect(guideScopeFor(granted, 'u-1')).toEqual({ kind: 'clinic' });
  });

  it('sem nenhum código novo: nada (ver o financeiro não abre Convênios depois da P1.12-b)', () => {
    const r = conveniosRights([P.VIEW_FINANCIAL, P.MANAGE_FINANCIAL]);
    expect(r).toMatchObject({ view: false, configure: false, operate: false, seeValues: false, bill: false, broad: false });
  });
});

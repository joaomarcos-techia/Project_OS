import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'src/app/(app)/(shell)/pacientes/[id]/page.tsx'),
  'utf8',
);

describe('/pacientes/[id] CRM layout', () => {
  it('usa duas colunas no desktop e preserva ordem de tarefa no DOM para mobile', () => {
    expect(source).toContain('data-patient-layout="crm"');
    expect(source).toContain('xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]');
    expect(source).toContain('aria-label="Contexto do paciente"');

    const profile = source.indexOf('<PatientProfileCard');
    const context = source.indexOf('<aside');
    const relationships = source.indexOf('<PatientRelationshipsCard');
    const lifecycle = source.indexOf('data-patient-section="lifecycle"');
    expect(profile).toBeGreaterThan(-1);
    expect(profile).toBeLessThan(context);
    expect(context).toBeLessThan(relationships);
    expect(relationships).toBeLessThan(lifecycle);
  });

  it('mantém cada fetch clínico atrás da permissão específica', () => {
    expect(source).toContain(
      'canViewProntuario ? listRecentProntuariosByPatient(clinicId, patientId) : Promise.resolve([])',
    );
    expect(source).toContain('canViewDocuments');
    expect(source).toContain('listClinicalDocumentFeed(clinicId, { patientId, limit: 8 })');
    expect(source).toContain('aria-label="Carregando atividade clínica"');
    expect(source).toContain('const list = await listProntuariosByPatient(clinicId, patientId)');
  });

  it('mantém criação e assinatura de prontuário atrás das capacidades próprias', () => {
    expect(source).toContain('deceased || !canCreate ? null');
    expect(source).toContain("pr.status === 'rascunho' && canSign");
  });
});

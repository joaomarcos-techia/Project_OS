import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CreatePatientSchema, MergePatientsSchema } from './types';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0069_patient_relationships_merge.sql'),
  'utf8',
);
const actions = readFileSync(resolve(process.cwd(), 'src/contexts/patient/actions.ts'), 'utf8');
const core = readFileSync(
  resolve(process.cwd(), 'src/contexts/patient/internal/patient-core.ts'),
  'utf8',
);
const page = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/pacientes/[id]/page.tsx'),
  'utf8',
);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('patient relationships and audited merge', () => {
  it('valida relação e justificativa no contrato público', () => {
    expect(
      CreatePatientSchema.parse({
        nome: 'Dependente',
        cpf: '529.982.247-25',
        guardian: {
          responsiblePatientId: A,
          relationshipType: 'mae',
          legalGuardian: true,
          financialResponsible: true,
          canManageAppointments: true,
        },
      }).guardian?.responsiblePatientId,
    ).toBe(A);
    expect(() =>
      MergePatientsSchema.parse({
        sourcePatientId: A,
        targetPatientId: A,
        reason: 'duplicado confirmado',
      }),
    ).toThrow();
    expect(() =>
      MergePatientsSchema.parse({ sourcePatientId: A, targetPatientId: B, reason: 'curta' }),
    ).toThrow();
  });

  it('enforça responsável legal de menor na aplicação e no banco', () => {
    expect(core).toContain('Paciente menor de idade exige a indicação');
    expect(core).toContain('data.guardian?.legalGuardian');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('minor patient requires a legal guardian relationship');
    expect(migration).toContain('validate_patient_relationship_tenant');
  });

  it('mantém isolamento tenant, RLS e histórico de merge append-only', () => {
    expect(migration).toContain('patient_relationships_tenant_access');
    expect(migration).toContain('patient_merges_tenant_access');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('patient merge history is append-only');
    expect(actions).toContain('requireFreshPermission(PERMISSIONS.DELETE_PATIENT)');
    expect(actions).toContain("key: idemKey('merge', idempotencyKey)");
    expect(actions).toContain('eventType: PATIENT_EVENTS.MERGED');
  });

  it('recusa conflitos que exigem decisão humana', () => {
    expect(actions).toContain('consultas ativas no mesmo horário');
    expect(actions).toContain('Consolide-os manualmente antes do merge');
    expect(actions).toContain('slot_occupies_instant = true');
  });

  it('transfere todos os vínculos operacionais conhecidos na mesma transação', () => {
    for (const table of [
      'appointments',
      'recurrence_series',
      'waitlist_entries',
      'lancamentos',
      'ai_conversations',
      'lgpd_requests',
      'ai_proactive_jobs',
      'prontuarios',
      'prescriptions',
      'medical_documents',
    ]) {
      expect(actions).toContain(`UPDATE ${table}`);
    }
    expect(actions).toContain("set_config('app.allow_patient_merge', 'on', true)");
    expect(actions).toContain('carryForwardMergedConsentDecisions');
    expect(actions).toContain('decision.grants.every(Boolean)');
  });

  it('limita a exceção jurídica ao patient_id e redireciona a origem arquivada', () => {
    expect(migration).toContain("current_setting('app.allow_patient_merge', true) = 'on'");
    expect(migration).toContain('NEW.content_encrypted IS NOT DISTINCT FROM OLD.content_encrypted');
    expect(migration).toContain('NEW.signed_at IS NOT DISTINCT FROM OLD.signed_at');
    expect(page).toContain('redirect(`/pacientes/${p.mergedIntoPatientId}`)');
  });
});

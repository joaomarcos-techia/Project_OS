import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0066_lgpd_operational_workflow.sql'),
  'utf8',
);
const actions = readFileSync(resolve(process.cwd(), 'src/contexts/patient/actions.ts'), 'utf8');
const page = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/configuracoes/lgpd/page.tsx'),
  'utf8',
);
const workQueue = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/configuracoes/lgpd/lgpd-work-queue.tsx'),
  'utf8',
);
const lgpdUi = `${page}\n${workQueue}`;

describe('LGPD operational workflow integration', () => {
  it('atribui owner e fixa prazo de resposta em 15 dias', () => {
    expect(migration).toContain("requested_at + interval '15 days'");
    expect(migration).toContain("p.role = 'owner'");
    expect(migration).toContain('LGPD assignee must be an active owner or manager from the clinic');
  });

  it('mantem historico automatico e tenant-scoped de tratamento', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS lgpd_request_history');
    expect(migration).toContain('CREATE TRIGGER trg_lgpd_requests_history');
    expect(migration).toContain('ALTER TABLE lgpd_request_history FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('GRANT SELECT ON lgpd_request_history TO authenticated');
  });

  it('processa intake somente apos verificacao e publica o evento correto', () => {
    expect(actions).toContain('canProcessLgpdRequest(request.status)');
    expect(actions).toContain("action: 'patient.lgpd.processing_started'");
    expect(actions).toContain('PATIENT_EVENTS.LGPD_EXPORT_REQUESTED');
    expect(actions).toContain('PATIENT_EVENTS.LGPD_DELETE_REQUESTED');
  });

  it('expoe SLA, responsavel, historico e comunicacao na fila operacional', () => {
    expect(lgpdUi).toContain('SLA vencido');
    expect(lgpdUi).toContain('Histórico de tratamento');
    expect(actions).toContain('export async function markLgpdRequesterNotified');
    expect(lgpdUi).toContain('notifyLgpdRequesterForm');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0070_handoff_sla_assignment.sql'),
  'utf8',
);
const actions = readFileSync(resolve(process.cwd(), 'src/contexts/ai-agent/actions.ts'), 'utf8');
const queries = readFileSync(resolve(process.cwd(), 'src/contexts/ai-agent/queries.ts'), 'utf8');
const listPage = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/conversas/page.tsx'),
  'utf8',
);

describe('human handoff assignment and SLA', () => {
  it('persiste prazo de 30 minutos, prioridade e atribuição consistente', () => {
    expect(migration).toContain("now() + interval '30 minutes'");
    expect(migration).toContain('ai_handoff_priority');
    expect(migration).toContain('assigned_at');
    expect(migration).toContain('ai_handoff_queue_assignment_chk');
  });

  it('atribui formalmente e exige o responsável nas ações operacionais', () => {
    expect(actions).toContain('.set({ assignedTo: user.userId, assignedAt: sql`now()` })');
    expect(actions).toContain('async function assertAssignedTo');
    expect(actions).toContain('export async function definirPrioridadeHandoff');
    expect(actions.match(/await assertAssignedTo/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('prioriza vencidas e urgentes e permite filtrar o prazo vencido', () => {
    expect(queries).toContain('overdueOnly?: boolean');
    expect(queries).toContain('overdueFirst');
    expect(queries).toContain('urgentFirst');
    // UX-014: o filtro fala a língua da recepção ("prazo"), não "SLA".
    expect(listPage).toContain('<option value="overdue">Prazo vencido</option>');
    expect(listPage).toContain('assignedToUserId');
  });
});

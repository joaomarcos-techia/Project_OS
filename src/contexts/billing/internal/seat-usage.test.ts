import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PgDialect, pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { practitionerSql } from '@/lib/auth/practitioner';

import { PROFILE_IS_PROFESSIONAL_SQL } from './seat-usage';

/**
 * "Profissional" para cobrança é quem a agenda trata como profissional (ADR-032
 * §2). A mesma regra vive em três lugares que não podem divergir: o predicado
 * da agenda, a contagem de billing e a trigger da migration 0119.
 */
describe('predicado de profissional — agenda, billing e trigger', () => {
  const probe = pgTable('profiles', { role: text('role'), crm: text('crm') });
  const agenda = new PgDialect()
    .sqlToQuery(practitionerSql(probe.role, probe.crm))
    .sql.replaceAll('"profiles".', '')
    .replaceAll('"', '');
  const migration = readFileSync(
    resolve(process.cwd(), 'drizzle/migrations/0119_offer_2026_per_professional.sql'),
    'utf8',
  );

  it('billing conta com o mesmo texto que `practitionerSql` gera', () => {
    expect(PROFILE_IS_PROFESSIONAL_SQL).toBe(agenda);
  });

  it('a trigger usa a mesma regra para a linha nova, a antiga e as demais', () => {
    expect(migration).toContain(
      "new_is_professional := (NEW.role = 'doctor' OR (NEW.crm IS NOT NULL AND btrim(NEW.crm) <> ''));",
    );
    expect(migration).toContain(
      "old_is_professional := (OLD.role = 'doctor' OR (OLD.crm IS NOT NULL AND btrim(OLD.crm) <> ''));",
    );
    expect(migration).toContain(`AND ${agenda} = new_is_professional;`);
  });
});

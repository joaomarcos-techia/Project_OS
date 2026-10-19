/**
 * Guarda a REGRA CANÔNICA de capacidade clínica (ADR-032 §2) nas suas duas
 * codificações — e a equivalência entre elas (o risco do review #8/#10).
 *
 * A equivalência é guardada por DOIS lados que, juntos, pegam uma mudança unilateral:
 *   - isPractitioner (TS): os casos abaixo travam `crm='   '` → false (o `.trim()`).
 *   - practitionerSql (SQL): o teste de shape trava o `btrim(...) <> ''` no SQL gerado.
 * Se alguém tirar o trim de um lado sem o btrim do outro, um dos dois quebra.
 *
 * Segue o idioma do repo (connection-store.test.ts): compila o `sql` para texto via
 * PgDialect — sem tocar o banco (dbAdmin é origem de conexão barrada pelo arch:db-check).
 */
import { PgDialect, pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { isPractitioner, practitionerSql } from './practitioner';

describe('isPractitioner (ADR-032 §2 — capacidade clínica)', () => {
  it('doctor sem CRM → true (role já basta)', () => {
    expect(isPractitioner({ role: 'doctor', crm: null })).toBe(true);
  });

  it('doctor com CRM → true', () => {
    expect(isPractitioner({ role: 'doctor', crm: '123456' })).toBe(true);
  });

  it('owner com CRM → true (o médico-dono)', () => {
    expect(isPractitioner({ role: 'owner', crm: '123456' })).toBe(true);
  });

  it('owner sem CRM → false (owner administrativo)', () => {
    expect(isPractitioner({ role: 'owner', crm: null })).toBe(false);
  });

  it('gestor com CRM → true; gestor sem CRM → false', () => {
    expect(isPractitioner({ role: 'gestor', crm: '123456' })).toBe(true);
    expect(isPractitioner({ role: 'gestor', crm: null })).toBe(false);
  });

  it("owner com CRM em branco '   ' → false (espelha o btrim do SQL — review #8)", () => {
    expect(isPractitioner({ role: 'owner', crm: '   ' })).toBe(false);
  });

  it('attendant sem CRM → false', () => {
    expect(isPractitioner({ role: 'attendant', crm: null })).toBe(false);
  });

  it('attendant com CRM retido → true na regra clínica vigente', () => {
    expect(isPractitioner({ role: 'attendant', crm: '123456' })).toBe(true);
  });

  it("financial com CRM string vazia '' → false", () => {
    expect(isPractitioner({ role: 'financial', crm: '' })).toBe(false);
  });

  it('super_admin sem CRM → false', () => {
    expect(isPractitioner({ role: 'super_admin', crm: null })).toBe(false);
  });
});

describe('practitionerSql ⇄ isPractitioner (equivalência — review #10)', () => {
  const dialect = new PgDialect();
  // Colunas-sonda locais (nome 'profiles') — evita importar o schema de identity
  // num arquivo de lib (boundaries). O texto SQL gerado é idêntico ao das colunas reais.
  const probe = pgTable('profiles', { role: text('role'), crm: text('crm') });
  const compiled = dialect.sqlToQuery(practitionerSql(probe.role, probe.crm)).sql;

  it("compara role à literal 'doctor'", () => {
    expect(compiled).toContain("= 'doctor'");
  });

  it('exige crm presente (IS NOT NULL)', () => {
    expect(compiled).toContain('IS NOT NULL');
  });

  it("trata CRM em branco como ausente (btrim(...) <> '') — espelha o .trim() do TS", () => {
    expect(compiled).toContain('btrim(');
    expect(compiled).toContain("<> ''");
  });

  it('referencia as colunas da profiles', () => {
    expect(compiled).toContain('"profiles"."role"');
    expect(compiled).toContain('"profiles"."crm"');
  });
});

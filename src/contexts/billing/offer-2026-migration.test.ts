import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { planSeatLimits } from './schema';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0119_offer_2026_per_professional.sql'),
  'utf8',
);
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> };

describe('0119 — oferta 2026 por profissional (ADR-067)', () => {
  it('cria o catálogo de tetos como as outras tabelas globais: leitura authenticated', () => {
    expect(migration).toContain('CREATE TABLE public.plan_seat_limits (');
    expect(migration).toContain('ALTER TABLE public.plan_seat_limits FORCE ROW LEVEL SECURITY;');
    expect(migration).toContain(
      'CREATE POLICY "plan_seat_limits_read_authenticated" ON public.plan_seat_limits\n' +
        '  FOR SELECT TO authenticated USING (true);',
    );
    expect(migration).toContain(
      'GRANT SELECT ON public.plan_seat_limits TO authenticated, service_role;',
    );
    // Sem IF NOT EXISTS: um banco que já tem outra versão desta tabela (DEV com a
    // PR #42) falha alto em vez de seguir com colunas diferentes.
    expect(migration).not.toContain('CREATE TABLE IF NOT EXISTS public.plan_seat_limits');
  });

  it('o schema do Drizzle declara as mesmas colunas e restrições', () => {
    const config = getTableConfig(planSeatLimits);
    const professionals = config.columns.find((c) => c.name === 'professionals');
    const staff = config.columns.find((c) => c.name === 'staff');
    expect(professionals?.notNull).toBe(true);
    expect(staff?.notNull).toBe(false);
    expect(config.checks.map((c) => c.name).sort()).toEqual([
      'plan_seat_limits_professionals_chk',
      'plan_seat_limits_staff_chk',
    ]);
    expect(migration).toContain(
      'CONSTRAINT plan_seat_limits_professionals_chk CHECK (professionals BETWEEN 1 AND 10)',
    );
    expect(migration).toContain(
      'CONSTRAINT plan_seat_limits_staff_chk CHECK (staff IS NULL OR staff >= 0)',
    );
  });

  it('a trigger cobre todo write que muda a categoria de alguém', () => {
    expect(migration).toContain(
      'CREATE TRIGGER profiles_plan_seat_limits\n' +
        '  BEFORE INSERT OR UPDATE OF clinic_id, role, crm, ativo, deleted_at\n' +
        '  ON public.profiles',
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.enforce_plan_seat_limits() FROM PUBLIC, anon, authenticated;',
    );
    expect(migration).toContain('SECURITY DEFINER SET search_path = public, pg_temp');
    // Os nomes que `seatLimitErrorFrom` (identity) traduz para a tela.
    expect(migration).toContain("CONSTRAINT = 'plan_professional_seat_limit'");
    expect(migration).toContain("CONSTRAINT = 'plan_staff_seat_limit'");
  });

  it('só barra a escrita que faz a categoria crescer', () => {
    // Mesma vaga, mesma categoria: renomear, reconvidar ou trocar papel passa.
    expect(migration).toMatch(/IF old_is_professional = new_is_professional THEN\s+RETURN NEW;/u);
    // Equipe ilimitada não conta nada.
    expect(migration).toMatch(
      /IF NOT new_is_professional AND cap_staff IS NULL THEN\s+RETURN NEW;/u,
    );
    // Plano sem teto por categoria (tabela antiga) segue a regra do convite.
    expect(migration).toMatch(/IF NOT FOUND THEN\s+RETURN NEW;/u);
  });

  it('downgrade agendado reserva a capacidade do destino', () => {
    expect(migration).toContain("AND c.kind = 'downgrade'");
    expect(migration).toContain("AND c.status = 'scheduled'");
    expect(migration).toContain('least(cap_professionals, scheduled.professionals)');
  });

  it('usa a mesma chave de advisory lock do convite', () => {
    expect(migration).toContain('pg_advisory_xact_lock(hashtext(NEW.clinic_id::text))');
  });

  it('registra o marcador e entra no journal depois da 0118', () => {
    expect(migration).toContain("VALUES ('0119-offer-2026-per-professional')");
    const previous = journal.entries.find((entry) => entry.idx === 118);
    const entry = journal.entries.find((candidate) => candidate.idx === 119);
    expect(entry?.tag).toBe('0119_offer_2026_per_professional');
    expect(entry && previous && entry.when > previous.when).toBe(true);
  });
});

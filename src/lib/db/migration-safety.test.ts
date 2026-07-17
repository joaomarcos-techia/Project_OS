/**
 * Testa o gate anti-migration-destrutiva (`scripts/check-migration-safety.ts`).
 *
 * Por que este teste existe: a 0040 precisou de `REVOKE ... TRUNCATE ... FROM
 * anon, authenticated` (hardening) e o gate barrou, porque casava `\btruncate\b`
 * sem olhar o contexto. A alternativa seria marcar a migration inteira como
 * `destructive-approved` — o que desligaria o gate para um `DROP TABLE` futuro no
 * mesmo arquivo. Afrouxar um controle de segurança sem teste é como o gate falhou
 * em primeiro lugar; então o afrouxamento (TRUNCATE-como-privilégio) vem com a
 * contraprova de que TRUNCATE-como-comando AINDA é pego.
 */
import { describe, expect, it } from 'vitest';

import { scanSql } from '../../../scripts/check-migration-safety';

const kinds = (sql: string): string[] => scanSql('t.sql', sql).map((f) => f.kind);

describe('scanSql — TRUNCATE: privilégio vs comando', () => {
  it('NÃO acusa TRUNCATE como nome de privilégio em REVOKE (o caso da 0040)', () => {
    expect(
      kinds('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES\n  ON public.t FROM anon, authenticated;'),
    ).toEqual([]);
  });

  it('NÃO acusa TRUNCATE como nome de privilégio em GRANT', () => {
    expect(kinds('GRANT TRUNCATE ON public.t TO service_role;')).toEqual([]);
  });

  it('AINDA acusa TRUNCATE como comando — o gate não foi desligado', () => {
    expect(kinds('TRUNCATE TABLE public.patients;')).toEqual(['TRUNCATE']);
    expect(kinds('truncate public.patients;')).toEqual(['TRUNCATE']);
  });

  it('acusa o TRUNCATE-comando mesmo quando um REVOKE legítimo o precede', () => {
    // Regressão do modo de falha que o statement-scan resolve: se o contexto fosse
    // resolvido por LINHA (e não por statement), o REVOKE contaminaria o resto.
    expect(
      kinds('REVOKE TRUNCATE ON public.t FROM anon;\nTRUNCATE TABLE public.t;'),
    ).toEqual(['TRUNCATE']);
  });

  it('resolve o contexto quando o REVOKE quebra em várias linhas', () => {
    expect(kinds('REVOKE\n  TRUNCATE\n  ON public.t\n  FROM anon;')).toEqual([]);
  });

  // A13: o statement começa com ALTER, não com REVOKE — mas TRUNCATE segue sendo
  // privilégio. É o mecanismo que fecha a CAUSA do default ACL do Supabase.
  it('NÃO acusa TRUNCATE em ALTER DEFAULT PRIVILEGES ... REVOKE (o caso do A13)', () => {
    expect(
      kinds(
        'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\n' +
          '  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;',
      ),
    ).toEqual([]);
  });

  it('NÃO acusa TRUNCATE em ALTER DEFAULT PRIVILEGES ... GRANT', () => {
    expect(
      kinds(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT TRUNCATE ON TABLES TO service_role;',
      ),
    ).toEqual([]);
  });

  it('o afrouxamento do ALTER DEFAULT PRIVILEGES não cega o TRUNCATE-comando seguinte', () => {
    expect(
      kinds(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon;\n' +
          'TRUNCATE TABLE public.patients;',
      ),
    ).toEqual(['TRUNCATE']);
  });

  it('ALTER DEFAULT PRIVILEGES não isenta DROP (não existe privilégio DROP)', () => {
    expect(
      kinds('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;\nDROP TABLE public.t;'),
    ).toEqual(['DROP TABLE']);
  });
});

describe('scanSql — DROP', () => {
  it('DROP TABLE/COLUMN/SCHEMA/DATABASE seguem sendo destrutivos', () => {
    expect(kinds('DROP TABLE public.t;')).toEqual(['DROP TABLE']);
    expect(kinds('ALTER TABLE t DROP COLUMN c;')).toEqual(['DROP COLUMN']);
    expect(kinds('DROP SCHEMA s;')).toEqual(['DROP SCHEMA']);
    expect(kinds('DROP DATABASE d;')).toEqual(['DROP DATABASE']);
  });

  it('não há privilégio chamado DROP — GRANT/REVOKE não isenta DROP', () => {
    expect(kinds('REVOKE ALL ON t FROM anon;\nDROP TABLE public.t;')).toEqual(['DROP TABLE']);
  });

  it('DROP de objeto recriável (POLICY/TRIGGER/FUNCTION/INDEX) não é destrutivo de DADOS', () => {
    expect(kinds('DROP POLICY IF EXISTS p ON public.t;')).toEqual([]);
    expect(kinds('DROP TRIGGER IF EXISTS trg ON public.t;')).toEqual([]);
    expect(kinds('DROP FUNCTION IF EXISTS public.f();')).toEqual([]);
    expect(kinds('DROP INDEX IF EXISTS i;')).toEqual([]);
  });
});

describe('scanSql — comentários', () => {
  it('keyword em comentário não conta (a 0040 documenta o ataque em prosa)', () => {
    expect(kinds('-- explica por que TRUNCATE e DROP TABLE são perigosos\nSELECT 1;')).toEqual([]);
  });

  it('reporta a linha correta do achado', () => {
    const findings = scanSql('t.sql', '-- topo\nSELECT 1;\n\nDROP TABLE public.t;');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(4);
    expect(findings[0]?.text).toBe('DROP TABLE public.t;');
  });
});

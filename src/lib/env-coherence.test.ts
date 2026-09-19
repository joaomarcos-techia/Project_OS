/**
 * SEC-041 — coerência de ambiente.
 *
 * O que estes testes protegem: o build precisa parar quando o app autentica
 * contra um projeto Supabase e lê o banco de outro, e quando um preview declara
 * apontar para produção. O que eles NÃO afirmam: que a checagem saiba distinguir
 * dois projetos gerenciados distintos — isso é Deployment Protection no painel
 * da Vercel, e está no registro de risco.
 */
import { describe, expect, it } from 'vitest';

import {
  checkEnvironmentCoherence,
  describeEnvironmentCoherence,
  supabaseRefFromDatabaseUrl,
  supabaseRefFromUrl,
} from './env-coherence';

const REF_A = 'abcdefghijklmnop';
const REF_B = 'qrstuvwxyz123456';
const authUrl = (ref: string) => `https://${ref}.supabase.co`;
const poolerUrl = (ref: string) =>
  `postgresql://postgres.${ref}:senha@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require`;

describe('extração do project ref', () => {
  it('lê o ref do host gerenciado e do usuário do pooler', () => {
    expect(supabaseRefFromUrl(authUrl(REF_A))).toBe(REF_A);
    expect(supabaseRefFromDatabaseUrl(poolerUrl(REF_A))).toBe(REF_A);
  });

  it('devolve null onde não existe ref — não inventa um', () => {
    // Postgres local, self-hosted e proxy não carregam ref. Isso é "não se
    // aplica", e a diferença entre null e string é o que impede um falso
    // positivo virar build quebrado no laptop de alguém.
    expect(supabaseRefFromUrl('http://127.0.0.1:55440')).toBeNull();
    expect(supabaseRefFromUrl(undefined)).toBeNull();
    expect(supabaseRefFromUrl('nao-e-url')).toBeNull();
    expect(supabaseRefFromDatabaseUrl('postgresql://postgres:senha@localhost:5432/app')).toBeNull();
    expect(supabaseRefFromDatabaseUrl('postgres://user@host/db')).toBeNull();
  });
});

describe('checkEnvironmentCoherence', () => {
  it('aprova quando auth e banco são o MESMO projeto', () => {
    expect(
      checkEnvironmentCoherence({
        NEXT_PUBLIC_SUPABASE_URL: authUrl(REF_A),
        DATABASE_URL: poolerUrl(REF_A),
      }),
    ).toEqual([]);
  });

  it('REPROVA sessão de um projeto lendo o banco de outro', () => {
    const issues = checkEnvironmentCoherence({
      NEXT_PUBLIC_SUPABASE_URL: authUrl(REF_A),
      DATABASE_URL: poolerUrl(REF_B),
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('DATABASE_URL');
    // A mensagem precisa dizer o PORQUÊ: às 3h da manhã, "env inválida" não ajuda.
    expect(issues[0]?.message).toContain('clinic_id');
  });

  it('cobre também o pool de runtime opt-in', () => {
    const issues = checkEnvironmentCoherence({
      NEXT_PUBLIC_SUPABASE_URL: authUrl(REF_A),
      DATABASE_URL: poolerUrl(REF_A),
      DATABASE_URL_RUNTIME: poolerUrl(REF_B),
    });

    expect(issues.map((issue) => issue.path)).toEqual(['DATABASE_URL_RUNTIME']);
  });

  it('não reprova o que não consegue determinar', () => {
    // Dev local e o build isolado de segurança caem aqui. Silêncio por
    // inaplicabilidade, não por aprovação — ver describeEnvironmentCoherence.
    expect(
      checkEnvironmentCoherence({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55440',
        DATABASE_URL: 'postgresql://security_local@127.0.0.1:55439/postgres',
      }),
    ).toEqual([]);
  });

  it('REPROVA preview declarando projeto de produção', () => {
    const issues = checkEnvironmentCoherence({
      VERCEL_ENV: 'preview',
      SUPABASE_PROJECT_ENV: 'prod',
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('SUPABASE_PROJECT_ENV');
  });

  it('production com projeto de produção é o caso normal', () => {
    expect(
      checkEnvironmentCoherence({ VERCEL_ENV: 'production', SUPABASE_PROJECT_ENV: 'prod' }),
    ).toEqual([]);
  });

  it('o diagnóstico expõe o ref público e nunca a credencial', () => {
    const texto = describeEnvironmentCoherence({
      NEXT_PUBLIC_SUPABASE_URL: authUrl(REF_A),
      DATABASE_URL: poolerUrl(REF_A),
      VERCEL_ENV: 'preview',
    });

    expect(texto).toBe(`auth=${REF_A} db=${REF_A} vercelEnv=preview`);
    expect(texto).not.toContain('senha');
  });
});

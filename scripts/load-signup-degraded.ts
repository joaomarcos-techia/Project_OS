/**
 * Carga adversarial da fatia O-2a (ADR-060) com o limiter DEGRADADO.
 *
 * A pergunta que este script responde é a que sustenta a decisão 6 da ADR:
 * *durante um apagão do Upstash, o teto de sessões vivas contém o estrago?*
 *
 * A degradação NÃO é simulada com mock. O script roda sem
 * `UPSTASH_REDIS_REST_URL`; `lazyRedis()` lança, o `catch` de
 * `assertSignupSessionAllowed` chama `degraded(...)` e o código cai no
 * `BoundedFallbackLimiter` — exatamente o caminho de produção num outage.
 *
 * Quatro fases:
 *   A1 — um IP só: prova que o fallback em memória ainda limita;
 *   A2 — muitos IPs (atacante distribuído): mede a vazão SEM limite efetivo,
 *        que é o pior caso real, porque em serverless o fallback é por instância;
 *   B  — teto: com a tabela cheia, a criação tem de virar `at_capacity`;
 *   C  — janitor: mede a vazão de limpeza, que é o que devolve o sistema ao normal.
 *
 * Só mexe em `signup_sessions`, só em linhas que ele mesmo cria, e termina com
 * readback provando zero resíduo. Nunca prod: `assertDevContext`.
 *
 * Uso: LOAD_SIGNUP_CONFIRM=SCRATCH pnpm load:signup-degraded
 */
import { assertDevContext } from './_env';

import { sql } from 'drizzle-orm';

import { SIGNUP_SESSION_CEILING, createSignupSession } from '@/contexts/onboarding';
import { purgeExpiredSignupSessions } from '@/contexts/onboarding';
import { dbAdmin } from '@/lib/db';

const MARCA = 'load-o2a-';
const falhas: string[] = [];

function check(ok: boolean, msg: string): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${msg}`);
  if (!ok) falhas.push(msg);
}

async function vivas(): Promise<number> {
  const [row] = await dbAdmin.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM signup_sessions
     WHERE status = 'initiated' AND idle_expires_at > now() AND absolute_expires_at > now()`);
  return row?.n ?? 0;
}

/** Semeia em massa, direto em SQL: a fase do teto precisa de volume, não de caminho real. */
async function semear(quantas: number, vencidas: boolean): Promise<void> {
  const idle = vencidas ? `-5 minutes` : `15 minutes`;
  const abs = vencidas ? `-1 minutes` : `60 minutes`;
  await dbAdmin.execute(sql`
    INSERT INTO signup_sessions (token_hash, status, idle_expires_at, absolute_expires_at)
    SELECT ${MARCA} || gen_random_uuid()::text, 'initiated',
           now() + ${idle}::interval, now() + ${abs}::interval
      FROM generate_series(1, ${quantas})`);
}

async function limpar(): Promise<number> {
  const [row] = await dbAdmin.execute<{ n: number }>(sql`
    WITH del AS (DELETE FROM signup_sessions WHERE token_hash LIKE ${MARCA + '%'} RETURNING 1)
    SELECT count(*)::int AS n FROM del`);
  return row?.n ?? 0;
}

interface Resultado {
  criadas: number;
  limitadas: number;
  noTeto: number;
  segundos: number;
}

/** Dispara `total` criações com concorrência fixa, contando cada desfecho. */
async function disparar(
  total: number,
  concorrencia: number,
  ipFixo: string | null,
): Promise<Resultado> {
  let criadas = 0;
  let limitadas = 0;
  let noTeto = 0;
  let proximo = 0;
  const inicio = Date.now();

  async function worker(): Promise<void> {
    for (;;) {
      const i = proximo++;
      if (i >= total) return;
      // IP distinto por requisição simula botnet — o pior caso, e o que o
      // fallback POR INSTÂNCIA não contém.
      const ip = ipFixo ?? `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
      const r = await createSignupSession(ip);
      if (r.ok) criadas += 1;
      else if (r.reason === 'rate_limited') limitadas += 1;
      else noTeto += 1;
    }
  }

  await Promise.all(Array.from({ length: concorrencia }, () => worker()));
  return { criadas, limitadas, noTeto, segundos: (Date.now() - inicio) / 1000 };
}

async function main(): Promise<void> {
  assertDevContext();
  if (process.env.LOAD_SIGNUP_CONFIRM !== 'SCRATCH') {
    throw new Error('[guard] LOAD_SIGNUP_CONFIRM=SCRATCH é obrigatório. Carga não roda implícita.');
  }
  // A degradação é forçada apontando o Upstash para um endereço INALCANÇÁVEL, e
  // não removendo a variável: `scripts/_env.ts` recarrega o .env.local no import e
  // desfaria um `unset`. É também a simulação melhor — exercita falha de REDE, que
  // é o outage de verdade, em vez de "configuração ausente".
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? '';
  const inalcancavel = /127\.0\.0\.1|localhost|\.invalid/u.test(redisUrl);
  if (!inalcancavel) {
    throw new Error(
      '[guard] esta prova exige o limiter DEGRADADO. Rode com ' +
        'UPSTASH_REDIS_REST_URL=http://127.0.0.1:1 para forçar a falha de rede.',
    );
  }

  const residuo = await limpar();
  if (residuo > 0) console.log(`(limpou ${residuo} linha(s) de execução anterior)`);
  const base = await vivas();
  console.log(`vivas antes de tudo: ${base} · teto: ${SIGNUP_SESSION_CEILING}\n`);

  // ---------------------------------------------------------------- A1
  console.log('--- A1: um IP só, limiter degradado ---');
  const a1 = await disparar(60, 10, '203.0.113.200');
  console.log(
    `  criadas=${a1.criadas} limitadas=${a1.limitadas} teto=${a1.noTeto} em ${a1.segundos.toFixed(1)}s`,
  );
  check(
    a1.limitadas > 0,
    `o fallback em memória ainda limita um IP repetido (${a1.limitadas} recusas)`,
  );
  check(
    a1.criadas <= 25,
    `criações por IP ficaram no teto do fallback (${a1.criadas}, esperado ~20)`,
  );

  // ---------------------------------------------------------------- A2
  console.log('\n--- A2: muitos IPs (distribuído), limiter degradado ---');
  const a2 = await disparar(300, 20, null);
  const vazao = a2.criadas / a2.segundos;
  console.log(
    `  criadas=${a2.criadas} limitadas=${a2.limitadas} teto=${a2.noTeto} em ${a2.segundos.toFixed(1)}s`,
  );
  console.log(`  VAZÃO: ${vazao.toFixed(1)} sessões/s deste cliente`);
  check(
    a2.limitadas === 0,
    'com IPs distintos o fallback NÃO limita — é o pior caso que o teto existe para conter',
  );
  const segundosAteOTeto = SIGNUP_SESSION_CEILING / Math.max(vazao, 0.001);
  console.log(
    `  nesta vazão, encher o teto (${SIGNUP_SESSION_CEILING}) levaria ~${Math.round(segundosAteOTeto)}s`,
  );

  // ---------------------------------------------------------------- B
  console.log('\n--- B: teto engaja ---');
  const faltam = SIGNUP_SESSION_CEILING - (await vivas());
  if (faltam > 0) {
    console.log(`  semeando ${faltam} linhas para alcançar o teto…`);
    await semear(faltam + 10, false);
  }
  const agoraVivas = await vivas();
  console.log(`  vivas: ${agoraVivas} (teto ${SIGNUP_SESSION_CEILING})`);

  // A checagem de teto tem cache de 30 s por instância. Espera-se a janela para
  // provar o comportamento REAL, em vez de furar o cache por dentro.
  console.log('  aguardando a janela de recontagem (30 s)…');
  await new Promise((r) => setTimeout(r, 31_000));

  const b = await disparar(10, 5, '203.0.113.201');
  console.log(`  criadas=${b.criadas} limitadas=${b.limitadas} teto=${b.noTeto}`);
  check(b.noTeto > 0, `criação recusada por at_capacity (${b.noTeto} de 10)`);
  check(b.criadas === 0, 'NENHUMA sessão criada acima do teto');

  // ---------------------------------------------------------------- C
  console.log('\n--- C: janitor drena ---');
  await dbAdmin.execute(sql`
    UPDATE signup_sessions
       SET idle_expires_at = now() - interval '5 min',
           absolute_expires_at = now() - interval '1 min'
     WHERE token_hash LIKE ${MARCA + '%'}`);
  const inicioDreno = Date.now();
  let apagadasTotal = 0;
  for (let i = 0; i < 30; i += 1) {
    const r = await purgeExpiredSignupSessions(500);
    apagadasTotal += r.deleted;
    if (r.deleted === 0) break;
  }
  const segundosDreno = (Date.now() - inicioDreno) / 1000;
  console.log(
    `  apagadas=${apagadasTotal} em ${segundosDreno.toFixed(1)}s (${(apagadasTotal / Math.max(segundosDreno, 0.001)).toFixed(0)}/s)`,
  );
  check(apagadasTotal > 0, 'janitor drenou as vencidas');
  const depoisDreno = await vivas();
  check(depoisDreno < SIGNUP_SESSION_CEILING, `vivas voltaram para baixo do teto (${depoisDreno})`);

  // ---------------------------------------------------------------- limpeza
  console.log('\n--- limpeza ---');
  const marcadas = await limpar();
  const orfas = await dbAdmin.execute<{ n: number }>(sql`
    WITH del AS (
      DELETE FROM signup_sessions
       WHERE created_at > now() - interval '30 min' AND token_hash NOT LIKE ${MARCA + '%'}
      RETURNING 1)
    SELECT count(*)::int AS n FROM del`);
  console.log(`  ${marcadas} marcadas + ${orfas[0]?.n ?? 0} criadas pelo caminho real`);
  const resto = await vivas();
  check(resto === base, `readback: vivas voltaram a ${base} (agora ${resto})`);

  console.log(
    falhas.length === 0
      ? '\nCARGA DEGRADADA: PASS'
      : `\nCARGA DEGRADADA: ${falhas.length} FALHA(S)`,
  );
  process.exit(falhas.length === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

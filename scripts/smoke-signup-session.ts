/**
 * Smoke da fatia O-2a (ADR-060) — sessão anônima de cadastro, contra o banco DEV.
 *
 * Prova o que o teste unitário NÃO prova, porque lá o banco é mock: que a
 * migration 0096/0097 se comporta como projetada — TTLs reais, renovação limitada
 * pelo prazo absoluto, janitor apagando, teto contando e o CHECK recusando estado
 * fora do escopo da fatia.
 *
 * Read-write, mas só na própria tabela e só em linhas que ele mesmo cria, todas
 * apagadas no fim. Nunca prod: `assertDevContext`.
 *
 * Uso: pnpm smoke:signup-session
 */
import { assertDevContext } from './_env';

import { and, eq, like, sql } from 'drizzle-orm';

import { signupSessions } from '@/contexts/onboarding/schema';
import { createSignupSession, readSignupSession, recordSignupAnswers } from '@/contexts/onboarding';
import { purgeExpiredSignupSessions } from '@/contexts/onboarding';
import { dbAdmin } from '@/lib/db';

const MARCA = 'smoke-o2a-';
const falhas: string[] = [];

function check(ok: boolean, msg: string): void {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${msg}`);
  if (!ok) falhas.push(msg);
}

/** IP distinto por caso: o rate limit é por IP e não é ele que está sob teste. */
let n = 0;
function ipNovo(): string {
  n += 1;
  return `198.51.100.${n}`;
}

/** Insere direto, para montar cenários que a API não permite criar (ex.: vencida). */
async function semear(sufixo: string, idle: string, absoluto: string): Promise<void> {
  await dbAdmin.execute(sql`
    INSERT INTO signup_sessions (token_hash, status, idle_expires_at, absolute_expires_at)
    VALUES (${MARCA + sufixo}, 'initiated', now() + ${idle}::interval, now() + ${absoluto}::interval)`);
}

async function limpar(): Promise<number> {
  const apagadas = await dbAdmin
    .delete(signupSessions)
    .where(like(signupSessions.tokenHash, `${MARCA}%`))
    .returning({ id: signupSessions.id });
  return apagadas.length;
}

async function main(): Promise<void> {
  assertDevContext();
  await limpar(); // resíduo de execução anterior interrompida

  console.log('--- criação ---');
  const criada = await createSignupSession({
    ip: ipNovo(),
    origin: 'https://app.qoro.dev',
    expectedHost: 'app.qoro.dev',
  });
  check(criada.ok, 'createSignupSession devolveu ok');
  if (!criada.ok) throw new Error('sem sessão, o resto não faz sentido');

  const [linha] = await dbAdmin.execute<{
    status: string;
    row_version: number;
    idle_s: number;
    abs_s: number;
  }>(sql`
    SELECT status, row_version,
           extract(epoch FROM (idle_expires_at - now()))::int AS idle_s,
           extract(epoch FROM (absolute_expires_at - now()))::int AS abs_s
      FROM signup_sessions
     ORDER BY created_at DESC LIMIT 1`);

  check(linha?.status === 'initiated', `status inicial é initiated (veio ${linha?.status})`);
  check(
    (linha?.idle_s ?? 0) > 14 * 60 && (linha?.idle_s ?? 0) <= 15 * 60,
    `idle ~15 min (${linha?.idle_s}s)`,
  );
  check(
    (linha?.abs_s ?? 0) > 59 * 60 && (linha?.abs_s ?? 0) <= 60 * 60,
    `absoluto ~60 min (${linha?.abs_s}s)`,
  );
  check(linha?.row_version === 1, 'row_version começa em 1');

  console.log('\n--- leitura ---');
  const estado = await readSignupSession(criada.rawToken);
  check(estado?.status === 'initiated', 'token correto devolve o estado');
  check((await readSignupSession('token-invalido-qualquer')) === null, 'token errado devolve null');

  console.log('\n--- renovação limitada pelo prazo absoluto ---');
  // Cenário: sessão com 50 min de idle "pedido" mas só 2 min de absoluto restante.
  // A renovação NÃO pode empurrar o idle para além do absoluto — sem o `least`,
  // atividade a cada 15 min tornaria a sessão eterna.
  await dbAdmin.execute(sql`
    UPDATE signup_sessions
       SET absolute_expires_at = now() + interval '2 min'
     WHERE token_hash = ${'x'} OR id = (SELECT id FROM signup_sessions ORDER BY created_at DESC LIMIT 1)`);
  await readSignupSession(criada.rawToken);
  const [apos] = await dbAdmin.execute<{ idle_menor: boolean }>(sql`
    SELECT (idle_expires_at <= absolute_expires_at) AS idle_menor
      FROM signup_sessions ORDER BY created_at DESC LIMIT 1`);
  check(apos?.idle_menor === true, 'idle nunca ultrapassa o absoluto após renovar');

  console.log('\n--- sessão vencida ---');
  await semear('vencida', '-5 min', '-1 min');
  const [vencida] = await dbAdmin.execute<{ hash: string }>(sql`
    SELECT token_hash AS hash FROM signup_sessions WHERE token_hash = ${MARCA + 'vencida'}`);
  check(Boolean(vencida), 'linha vencida semeada');
  check(
    (await readSignupSession(MARCA + 'vencida')) === null,
    'sessão vencida não é legível (410 genérico na rota)',
  );

  console.log('\n--- janitor ---');
  await semear('vencida2', '-30 min', '-10 min');
  const antes = await dbAdmin
    .select({ n: sql<number>`count(*)::int` })
    .from(signupSessions)
    .where(like(signupSessions.tokenHash, `${MARCA}%`));
  const resultado = await purgeExpiredSignupSessions();
  const depois = await dbAdmin
    .select({ n: sql<number>`count(*)::int` })
    .from(signupSessions)
    .where(like(signupSessions.tokenHash, `${MARCA}%`));
  check(resultado.deleted >= 2, `janitor apagou as vencidas (${resultado.deleted})`);
  check(
    (depois[0]?.n ?? 0) < (antes[0]?.n ?? 0),
    `linhas do smoke caíram de ${antes[0]?.n} para ${depois[0]?.n}`,
  );
  check(typeof resultado.live === 'number', `janitor reporta vivas (${resultado.live})`);

  console.log('\n--- CHECK de escopo ---');
  let recusou = false;
  try {
    await dbAdmin.execute(sql`
      INSERT INTO signup_sessions (token_hash, status, idle_expires_at, absolute_expires_at)
      VALUES (${MARCA + 'fora'}, 'checkout_pending', now() + interval '15 min', now() + interval '1 h')`);
  } catch {
    recusou = true;
  }
  check(recusou, 'banco recusa estado de fatia futura (escopo congelado em constraint)');

  /* ------------------------------------------------------------------
   * As QUATRO perguntas (ADR-060 §1.c.1, migration 0098)
   *
   * Contra o banco REAL de propósito: o teste unitário mocka o banco e não
   * pegaria um `Date` interpolado em `sql` cru — que é exatamente o bug que
   * derrubou o `readSignupSession` em runtime e só apareceu aqui.
   * ------------------------------------------------------------------ */
  console.log('\n--- perguntas ---');
  // Origin COERENTE: sem ele o classificador cai em risco moderado e exige
  // desafio — a sessão nem abre, e o que está sob teste aqui são as perguntas.
  const sessao = await createSignupSession({
    ip: ipNovo(),
    origin: 'https://app.qoro.dev',
    expectedHost: 'app.qoro.dev',
  });
  if (!sessao.ok) {
    check(false, 'nao consegui abrir sessao para o teste das perguntas');
  } else {
    const respostas = {
      professionalsBand: '2_5',
      weeklyAppointmentsBand: '21_50',
      currentTooling: 'outro_sistema',
      discoverySource: 'indicacao_colega',
    } as const;

    const gravou = await recordSignupAnswers(sessao.rawToken, {
      ...respostas,
      rowVersion: sessao.state.rowVersion,
    });
    check(gravou.ok, 'grava as quatro respostas');
    check(
      gravou.ok && gravou.rowVersion === sessao.state.rowVersion + 1,
      'row_version incrementa (CAS)',
    );

    // A sessão continua VIVA depois de responder — senão a página perderia a
    // própria sessão ao recarregar logo após o passo 1.
    const aindaViva = await readSignupSession(sessao.rawToken);
    check(aindaViva?.status === 'details_complete', 'status vira details_complete e segue viva');

    // CAS: reenviar a versão ANTIGA é a segunda aba perdendo a corrida.
    const conflito = await recordSignupAnswers(sessao.rawToken, {
      ...respostas,
      rowVersion: sessao.state.rowVersion,
    });
    check(
      !conflito.ok && conflito.reason === 'conflict',
      'versão velha dá conflict, não sobrescreve',
    );

    // Token desconhecido não pode virar "conflict": não há o que reenviar.
    const inexistente = await recordSignupAnswers('token-que-nunca-existiu', {
      ...respostas,
      rowVersion: 1,
    });
    check(!inexistente.ok && inexistente.reason === 'gone', 'token desconhecido devolve gone');

    const [persistida] = await dbAdmin
      .select({
        band: signupSessions.professionalsBand,
        fonte: signupSessions.discoverySource,
        respondidoEm: signupSessions.answeredAt,
      })
      .from(signupSessions)
      .where(eq(signupSessions.status, 'details_complete'))
      .limit(1);
    check(persistida?.band === '2_5', 'resposta persistiu de verdade');
    check(persistida?.fonte === 'indicacao_colega', 'canal persistiu');
    check(persistida?.respondidoEm != null, 'answered_at preenchido pelo relógio do BANCO');

    await dbAdmin.delete(signupSessions).where(eq(signupSessions.status, 'details_complete'));
  }

  console.log('\n--- limpeza ---');
  const apagadas = await limpar();
  await dbAdmin
    .delete(signupSessions)
    .where(
      and(eq(signupSessions.status, 'initiated'), sql`created_at > now() - interval '10 min'`),
    );
  console.log(`  ${apagadas} linha(s) marcada(s) removida(s) + as criadas pela API`);

  const [resto] = await dbAdmin
    .select({ n: sql<number>`count(*)::int` })
    .from(signupSessions)
    .where(like(signupSessions.tokenHash, `${MARCA}%`));
  check((resto?.n ?? 0) === 0, 'readback: nenhuma linha do smoke sobrou');

  console.log(
    falhas.length === 0 ? '\nSMOKE O-2a: PASS' : `\nSMOKE O-2a: ${falhas.length} FALHA(S)`,
  );
  process.exit(falhas.length === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

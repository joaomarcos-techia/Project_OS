/**
 * Smoke Conversas IA (ADR-047) — validação pós-migration 0051.
 *
 * Roda contra qoro-dev (DATABASE_URL do .env.local). NUNCA contra prod.
 * Integração real: NÃO mocka banco (CONVENTIONS §Testes).
 *
 * Cobre o que teste unitário não alcança — isolamento de tenant, cifra,
 * particionamento e a cadeia de idempotência:
 *   1.x  RLS cross-tenant (listar / thread / mensagens / mutação)
 *   2.x  cifra per-tenant (decifra dentro, falha fora)
 *   3.x  privacidade do DTO (sem telefone em claro, sem CPF, sem snapshot)
 *   4.x  resposta manual (persiste cifrada, direction=out, sent_by_user_id, outbox)
 *   5.x  idempotência + corrida (status muda entre carregar e enviar)
 *   6.x  invariante started_at imutável (a poda de partição depende dela)
 *
 * As Server Actions exigem sessão HTTP (requireUser), então o smoke exercita a
 * camada logo abaixo delas — queries + helpers de conversa + política — e
 * valida as regras de banco. O caminho com sessão é o roteiro manual do runbook.
 */
import './_env';

import { randomBytes, randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { aiConversations, aiMessages } from '@/contexts/ai-agent/schema';
import {
  appendManualMessage,
  escalateToHuman,
  returnToAgent,
} from '@/contexts/ai-agent/internal/conversation';
import { ActiveConversationConflictError } from '@/contexts/ai-agent/errors';
import { canReplyManually } from '@/contexts/ai-agent/internal/reply-policy';
import { META_WINDOW_MS } from '@/contexts/ai-agent/internal/meta-window';
import { getConversationThread, listConversations } from '@/contexts/ai-agent/queries';
import { decryptForTenant, encryptForTenant, hashForLookup, normalizePhone } from '@/lib/crypto';
import { __testing__ as cryptoTesting, type SecretProvider } from '@/lib/crypto/secret-provider';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

// --- test secrets (fixed; never real) ----------------------------------------
const MASTER_V1 = randomBytes(32);
const SALT = randomBytes(16);
const testProvider: SecretProvider = {
  async getMasterKey() {
    return MASTER_V1;
  },
  async getLookupSalt() {
    return SALT;
  },
};
cryptoTesting.setProvider(testProvider);

// --- harness ------------------------------------------------------------------
type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, ok: boolean, detail?: string): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
  console.log(ok ? `[OK]   ${name}` : `[FAIL] ${name}${detail ? `\n       ${detail}` : ''}`);
}
async function tryStep(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (e) {
    record(name, false, e instanceof Error ? e.message : String(e));
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const CLINIC_A = randomUUID();
const CLINIC_B = randomUUID();
const USER_A = randomUUID();
const slugA = `cva${Date.now().toString(36)}`.slice(0, 30);
const slugB = `cvb${Date.now().toString(36)}`.slice(0, 30);

const PHONE_A = '11988887777';
/** Contador de telefones distintos entre as conversas semeadas. */
let seq = 1;
const CPF_SECRETO = '52998224725';
const INBOUND_TEXT = 'Oi, queria remarcar minha consulta';
const MANUAL_TEXT = 'Claro! Consigo te encaixar quinta às 14h.';

async function seedClinic(id: string, slug: string): Promise<void> {
  await dbAdmin.execute(
    sql`INSERT INTO clinics (id, nome, slug) VALUES (${id}::uuid, ${`Smoke ${slug}`}, ${slug})
        ON CONFLICT (id) DO NOTHING`,
  );
}

/**
 * Operador do smoke. `ai_messages.sent_by_user_id` → `profiles(id)` (RESTRICT),
 * e `profiles.id` → `auth.users(id)` (CASCADE, migration 0003) — então a
 * cadeia de identidade precisa existir inteira, começando em auth.users.
 */
async function seedProfile(id: string, clinicId: string): Promise<void> {
  await dbAdmin.execute(
    sql`INSERT INTO auth.users (id, instance_id, aud, role, email)
        VALUES (${id}::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
                'authenticated', 'authenticated', ${`smoke-${id}@example.test`})
        ON CONFLICT (id) DO NOTHING`,
  );
  await dbAdmin.execute(
    sql`INSERT INTO profiles (id, clinic_id, nome, role)
        VALUES (${id}::uuid, ${clinicId}::uuid, 'Smoke Operador', 'owner')
        ON CONFLICT (id) DO NOTHING`,
  );
}

/**
 * Cria conversa + 1 inbound. `inboundAgeMs` posiciona a janela da Meta.
 *
 * started_at é backdateado JUNTO com a mensagem — de propósito. Em produção a
 * conversa nasce ANTES do inbound (findOrCreateConversation → appendInbound,
 * ambos com created_at default now()), então `msg.created_at >= conv.started_at`
 * é sempre verdade. Backdatear só a mensagem produziria um estado que o sistema
 * não consegue gerar e que a poda de partição (queries.ts) legitimamente
 * esconde — a primeira versão deste seed fazia isso e derrubou 2.1/6.2.
 */
async function seedConversation(
  clinicId: string,
  opts: { status?: 'active' | 'handoff'; inboundAgeMs?: number; phone?: string } = {},
): Promise<string> {
  // Telefone distinto por conversa (default) — a unique parcial
  // `(clinic_id, phone_hash) WHERE status='active'` só permite UMA ativa por
  // contato, então reusar o mesmo número colidiria entre os cenários.
  const phone = opts.phone ?? `1198${String(seq++).padStart(7, '0')}`;
  const phoneHash = await hashForLookup(normalizePhone(phone));
  const phoneEnc = await encryptForTenant(clinicId, normalizePhone(phone));
  const collected = await encryptForTenant(clinicId, JSON.stringify({ cpf: CPF_SECRETO }));
  const age = opts.inboundAgeMs ?? 60_000;
  const backdated = sql`now() - (${age}::bigint * interval '1 millisecond')`;

  return withTenant(clinicId, async (tx) => {
    const [conv] = await tx
      .insert(aiConversations)
      .values({
        clinicId,
        patientPhoneHash: phoneHash,
        patientPhoneEncrypted: phoneEnc,
        collectedDataEncrypted: collected,
        status: opts.status ?? 'active',
        intentAtual: 'remarcar',
        startedAt: backdated,
        lastMessageAt: backdated,
      })
      .returning({ id: aiConversations.id });

    await tx.insert(aiMessages).values({
      clinicId,
      conversationId: conv!.id,
      direction: 'in',
      contentEncrypted: await encryptForTenant(clinicId, INBOUND_TEXT),
      createdAt: backdated,
    });
    return conv!.id;
  });
}

async function lastInboundAt(clinicId: string, conversationId: string): Promise<Date | null> {
  const rows = (await dbAdmin.execute(
    sql`SELECT max(created_at) AS t FROM ai_messages
        WHERE clinic_id = ${clinicId}::uuid AND conversation_id = ${conversationId}::uuid
          AND direction = 'in'`,
  )) as unknown as Array<{ t: Date | string | null }>;
  const t = rows[0]?.t;
  // O driver devolve timestamptz como string em execute() cru — Date só vem
  // pelo select tipado do Drizzle.
  return t ? new Date(t) : null;
}

async function main(): Promise<void> {
  await seedClinic(CLINIC_A, slugA);
  await seedClinic(CLINIC_B, slugB);
  await seedProfile(USER_A, CLINIC_A);

  const convA = await seedConversation(CLINIC_A, { status: 'handoff', phone: PHONE_A });
  const convB = await seedConversation(CLINIC_B, { status: 'handoff', phone: PHONE_A });
  void convB; // semeada só para provar isolamento (1.x) — não usada diretamente

  // --- 1.x RLS cross-tenant ---------------------------------------------------

  await tryStep('1.1 listar: B não enxerga conversa de A', async () => {
    const listB = await listConversations(CLINIC_B, {});
    assert(
      !listB.items.some((c) => c.id === convA),
      'VAZAMENTO: clínica B listou conversa da clínica A',
    );
    const listA = await listConversations(CLINIC_A, {});
    assert(listA.items.some((c) => c.id === convA), 'A não listou a própria conversa');
  });

  await tryStep('1.2 thread: B não abre thread de A', async () => {
    const leak = await getConversationThread(CLINIC_B, convA);
    assert(leak === null, 'VAZAMENTO: clínica B abriu a thread da clínica A');
    const own = await getConversationThread(CLINIC_A, convA);
    assert(own !== null, 'A não abriu a própria thread');
  });

  await tryStep('1.3 mensagens: B não lê mensagens de A', async () => {
    const rows = await withTenant(CLINIC_B, (tx) =>
      tx.select().from(aiMessages).where(eq(aiMessages.conversationId, convA)),
    );
    assert(rows.length === 0, `VAZAMENTO: B leu ${rows.length} mensagens de A`);
  });

  await tryStep('1.4 mutação: B não devolve ao agente conversa de A', async () => {
    const changed = await withTenant(CLINIC_B, (tx) => returnToAgent(tx, CLINIC_B, convA));
    assert(!changed, 'VAZAMENTO: B mutou o status de uma conversa de A');
    const rows = (await dbAdmin.execute(
      sql`SELECT status FROM ai_conversations WHERE id = ${convA}::uuid`,
    )) as unknown as Array<{ status: string }>;
    assert(rows[0]!.status === 'handoff', 'status de A foi alterado por B');
  });

  // --- 2.x cifra per-tenant ---------------------------------------------------

  await tryStep('2.1 conteúdo decifra dentro do tenant', async () => {
    const thread = await getConversationThread(CLINIC_A, convA);
    assert(thread !== null, 'thread nula');
    assert(
      thread!.messages.some((m) => m.text === INBOUND_TEXT),
      'inbound não foi decifrado corretamente',
    );
  });

  await tryStep('2.2 decrypt cross-tenant falha (auth tag)', async () => {
    const rows = (await dbAdmin.execute(
      sql`SELECT content_encrypted FROM ai_messages WHERE conversation_id = ${convA}::uuid LIMIT 1`,
    )) as unknown as Array<{ content_encrypted: string }>;
    let threw = false;
    try {
      await decryptForTenant(CLINIC_B, rows[0]!.content_encrypted);
    } catch {
      threw = true;
    }
    assert(threw, 'decrypt cross-tenant NÃO falhou (HKDF/GCM quebrado)');
  });

  await tryStep('2.3 at-rest: nada em claro na coluna', async () => {
    const rows = (await dbAdmin.execute(
      sql`SELECT content_encrypted FROM ai_messages WHERE conversation_id = ${convA}::uuid`,
    )) as unknown as Array<{ content_encrypted: string }>;
    for (const r of rows) {
      assert(!r.content_encrypted.includes(INBOUND_TEXT), 'conteúdo em CLARO no banco');
    }
  });

  // --- 3.x privacidade do DTO -------------------------------------------------

  await tryStep('3.1 listagem não vaza telefone em claro nem CPF', async () => {
    const list = await listConversations(CLINIC_A, {});
    const blob = JSON.stringify(list);
    assert(!blob.includes(normalizePhone(PHONE_A)), 'VAZAMENTO: telefone em claro no DTO da lista');
    assert(!blob.includes(CPF_SECRETO), 'VAZAMENTO: CPF (collected_data) no DTO da lista');
    assert(!blob.includes('patientPhoneHash'), 'VAZAMENTO: hash do telefone no DTO');
    assert(!blob.includes('Encrypted'), 'VAZAMENTO: campo *Encrypted no DTO');
  });

  await tryStep('3.2 thread não vaza CPF nem prompt snapshot', async () => {
    const thread = await getConversationThread(CLINIC_A, convA);
    const blob = JSON.stringify(thread);
    assert(!blob.includes(CPF_SECRETO), 'VAZAMENTO: CPF na thread');
    assert(!blob.includes(normalizePhone(PHONE_A)), 'VAZAMENTO: telefone em claro na thread');
    assert(!blob.includes('promptSnapshot'), 'VAZAMENTO: prompt snapshot na thread');
  });

  await tryStep('3.3 telefone aparece mascarado quando não há nome', async () => {
    const list = await listConversations(CLINIC_A, {});
    const item = list.items.find((c) => c.id === convA);
    assert(item?.maskedPhone?.includes('*') === true, `telefone não mascarado: ${item?.maskedPhone}`);
  });

  // --- 4.x resposta manual ----------------------------------------------------

  const manualKey = randomUUID();

  await tryStep('4.1 mensagem manual: cifrada, direction=out, sent_by_user_id', async () => {
    await withTenant(CLINIC_A, (tx) =>
      appendManualMessage(tx, {
        clinicId: CLINIC_A,
        conversationId: convA,
        eventId: manualKey,
        text: MANUAL_TEXT,
        sentByUserId: USER_A,
      }),
    );
    const rows = (await dbAdmin.execute(
      sql`SELECT direction, content_encrypted, sent_by_user_id, model
          FROM ai_messages WHERE event_id = ${manualKey}::uuid`,
    )) as unknown as Array<{
      direction: string;
      content_encrypted: string;
      sent_by_user_id: string | null;
      model: string | null;
    }>;
    assert(rows.length === 1, `esperava 1 linha, veio ${rows.length}`);
    assert(rows[0]!.direction === 'out', `direction errada: ${rows[0]!.direction}`);
    assert(rows[0]!.sent_by_user_id === USER_A, 'sent_by_user_id não gravado');
    assert(rows[0]!.model === null, 'model deveria ser null em mensagem humana');
    assert(!rows[0]!.content_encrypted.includes(MANUAL_TEXT), 'texto manual em CLARO no banco');
    assert(
      (await decryptForTenant(CLINIC_A, rows[0]!.content_encrypted)) === MANUAL_TEXT,
      'texto manual não decifra',
    );
  });

  await tryStep('4.2 autoria: thread separa humano de agente', async () => {
    const thread = await getConversationThread(CLINIC_A, convA);
    const human = thread!.messages.find((m) => m.text === MANUAL_TEXT);
    assert(human?.author === 'human', `autor errado: ${human?.author}`);
    assert(human?.direction === 'out', 'direction errada');
    // Persistida ≠ entregue: sem linha em outbound_messages o selo é 'pending'.
    assert(human?.delivery === 'pending', `delivery deveria ser pending, veio ${human?.delivery}`);
  });

  await tryStep('4.3 não mente sobre entrega: accepted vira "sent"', async () => {
    await dbAdmin.execute(
      sql`INSERT INTO outbound_messages (clinic_id, idempotency_key, to_number_hash, content_encrypted, status)
          VALUES (${CLINIC_A}::uuid, ${manualKey}, ${await hashForLookup(normalizePhone(PHONE_A))},
                  ${await encryptForTenant(CLINIC_A, MANUAL_TEXT)}, 'accepted')`,
    );
    const thread = await getConversationThread(CLINIC_A, convA);
    const human = thread!.messages.find((m) => m.text === MANUAL_TEXT);
    assert(human?.delivery === 'sent', `delivery deveria ser sent, veio ${human?.delivery}`);
  });

  await tryStep('4.4 falha de envio aparece como "failed"', async () => {
    await dbAdmin.execute(
      sql`UPDATE outbound_messages SET status = 'failed'
          WHERE clinic_id = ${CLINIC_A}::uuid AND idempotency_key = ${manualKey}`,
    );
    const thread = await getConversationThread(CLINIC_A, convA);
    const human = thread!.messages.find((m) => m.text === MANUAL_TEXT);
    assert(human?.delivery === 'failed', `delivery deveria ser failed, veio ${human?.delivery}`);
  });

  // --- 5.x idempotência / corrida ---------------------------------------------

  await tryStep('5.1 escalateToHuman é idempotente (fila não duplica)', async () => {
    const conv = await seedConversation(CLINIC_A, { status: 'active' });
    await withTenant(CLINIC_A, (tx) => escalateToHuman(tx, CLINIC_A, conv, 'manual_takeover'));
    await withTenant(CLINIC_A, (tx) => escalateToHuman(tx, CLINIC_A, conv, 'manual_takeover'));
    const rows = (await dbAdmin.execute(
      sql`SELECT count(*)::int AS n FROM ai_handoff_queue
          WHERE conversation_id = ${conv}::uuid AND resolved_at IS NULL`,
    )) as unknown as Array<{ n: number }>;
    assert(rows[0]!.n === 1, `fila duplicou: ${rows[0]!.n} linhas abertas`);
  });

  await tryStep('5.2 devolver ao agente RESOLVE a fila (reescalação volta a funcionar)', async () => {
    const conv = await seedConversation(CLINIC_A, { status: 'active' });
    await withTenant(CLINIC_A, (tx) => escalateToHuman(tx, CLINIC_A, conv, 'manual_takeover'));
    await withTenant(CLINIC_A, (tx) => returnToAgent(tx, CLINIC_A, conv));

    const aberta = (await dbAdmin.execute(
      sql`SELECT count(*)::int AS n FROM ai_handoff_queue
          WHERE conversation_id = ${conv}::uuid AND resolved_at IS NULL`,
    )) as unknown as Array<{ n: number }>;
    assert(aberta[0]!.n === 0, 'fila não foi resolvida ao devolver ao agente');

    // Sem o resolved_at, este segundo escalate cairia no DO NOTHING e a conversa
    // nunca mais apareceria na fila humana.
    await withTenant(CLINIC_A, (tx) => escalateToHuman(tx, CLINIC_A, conv, 'fallback_threshold'));
    const rea = (await dbAdmin.execute(
      sql`SELECT count(*)::int AS n FROM ai_handoff_queue
          WHERE conversation_id = ${conv}::uuid AND resolved_at IS NULL`,
    )) as unknown as Array<{ n: number }>;
    assert(rea[0]!.n === 1, 'reescalação após devolver NÃO reabriu a fila');
  });

  await tryStep('5.2b devolver com outra ativa no mesmo contato → erro tipado, não 23505 cru', async () => {
    const phone = '11955554444';
    // Uma ativa e uma em handoff para o MESMO contato — estado que a unique
    // parcial permite (ela só cobre status='active').
    await seedConversation(CLINIC_A, { status: 'active', phone });
    const emHandoff = await seedConversation(CLINIC_A, { status: 'handoff', phone });

    let caught: unknown;
    try {
      await withTenant(CLINIC_A, (tx) => returnToAgent(tx, CLINIC_A, emHandoff));
    } catch (e) {
      caught = e;
    }
    assert(caught !== undefined, 'devolver deveria ter falhado (duas ativas no mesmo contato)');
    assert(
      caught instanceof ActiveConversationConflictError,
      `erro não tipado vazou para o caller: ${(caught as Error)?.name}`,
    );
  });

  await tryStep('5.3 CORRIDA: status vira active entre carregar e enviar → bloqueia', async () => {
    const conv = await seedConversation(CLINIC_A, { status: 'handoff' });
    // UI carregou em handoff e permitiria enviar…
    const carregado = canReplyManually({
      status: 'handoff',
      lastInboundAt: await lastInboundAt(CLINIC_A, conv),
      now: new Date(),
    });
    assert(carregado.allowed, 'setup: deveria estar permitido no carregamento');

    // …outro processo devolve ao agente…
    await withTenant(CLINIC_A, (tx) => returnToAgent(tx, CLINIC_A, conv));

    // …e o servidor relê o status sob lock antes de aceitar.
    const atual = (await dbAdmin.execute(
      sql`SELECT status FROM ai_conversations WHERE id = ${conv}::uuid`,
    )) as unknown as Array<{ status: string }>;
    const decisao = canReplyManually({
      status: atual[0]!.status,
      lastInboundAt: await lastInboundAt(CLINIC_A, conv),
      now: new Date(),
    });
    assert(!decisao.allowed, 'CORRIDA: envio permitido com a conversa já devolvida ao agente');
    assert(
      !decisao.allowed && decisao.reason === 'not_handoff',
      'motivo errado para a corrida',
    );
  });

  await tryStep('5.4 janela de 24h fechada bloqueia com dado real do banco', async () => {
    const conv = await seedConversation(CLINIC_A, {
      status: 'handoff',
      inboundAgeMs: META_WINDOW_MS + 60_000,
    });
    const decisao = canReplyManually({
      status: 'handoff',
      lastInboundAt: await lastInboundAt(CLINIC_A, conv),
      now: new Date(),
    });
    assert(!decisao.allowed, 'janela expirada NÃO bloqueou');
    assert(!decisao.allowed && decisao.reason === 'window_closed', 'motivo errado');
  });

  // --- 6.x invariante da poda de partição -------------------------------------

  await tryStep('6.1 started_at é imutável (a poda de partição depende disso)', async () => {
    const before = (await dbAdmin.execute(
      sql`SELECT started_at FROM ai_conversations WHERE id = ${convA}::uuid`,
    )) as unknown as Array<{ started_at: Date }>;

    await withTenant(CLINIC_A, (tx) => escalateToHuman(tx, CLINIC_A, convA, 'probe'));
    await withTenant(CLINIC_A, (tx) => returnToAgent(tx, CLINIC_A, convA));
    await withTenant(CLINIC_A, (tx) =>
      appendManualMessage(tx, {
        clinicId: CLINIC_A,
        conversationId: convA,
        eventId: randomUUID(),
        text: 'probe',
        sentByUserId: USER_A,
      }),
    );

    const after = (await dbAdmin.execute(
      sql`SELECT started_at FROM ai_conversations WHERE id = ${convA}::uuid`,
    )) as unknown as Array<{ started_at: Date }>;
    assert(
      new Date(before[0]!.started_at).getTime() === new Date(after[0]!.started_at).getTime(),
      'started_at MUDOU — a poda `createdAt >= startedAt` em queries.ts passa a esconder histórico',
    );
  });

  await tryStep('6.2 thread traz todas as mensagens apesar da poda', async () => {
    const esperado = (await dbAdmin.execute(
      sql`SELECT count(*)::int AS n FROM ai_messages WHERE conversation_id = ${convA}::uuid`,
    )) as unknown as Array<{ n: number }>;
    const thread = await getConversationThread(CLINIC_A, convA);
    assert(
      thread!.messages.length === esperado[0]!.n,
      `poda escondeu mensagens: thread=${thread!.messages.length} banco=${esperado[0]!.n}`,
    );
  });

  // --- filtros -----------------------------------------------------------------

  await tryStep('7.1 filtro de status e ordenação handoff-primeiro', async () => {
    await seedConversation(CLINIC_A, { status: 'handoff' });
    const all = await listConversations(CLINIC_A, {});
    const firstNonHandoff = all.items.findIndex((c) => c.status !== 'handoff');
    const lastHandoff = all.items.map((c) => c.status).lastIndexOf('handoff');
    assert(
      firstNonHandoff === -1 || lastHandoff < firstNonHandoff,
      'ordenação: handoff NÃO veio primeiro',
    );
    const only = await listConversations(CLINIC_A, { status: 'handoff' });
    assert(only.items.every((c) => c.status === 'handoff'), 'filtro de status vazou outros status');
  });

  await tryStep('7.2 busca por telefone acha via hash', async () => {
    const found = await listConversations(CLINIC_A, { search: PHONE_A });
    assert(found.items.length > 0, 'busca por telefone não achou nada');
    const miss = await listConversations(CLINIC_A, { search: '11900000000' });
    assert(miss.items.length === 0, 'busca por telefone inexistente retornou resultados');
  });

  // Cleanup. ORDEM IMPORTA: sent_by_user_id é RESTRICT, então as mensagens
  // precisam morrer antes do profile. Apagar as clínicas cascateia conversas →
  // mensagens; só depois o auth.user (que cascateia o profile).
  await dbAdmin.execute(
    sql`DELETE FROM clinics WHERE id IN (${CLINIC_A}::uuid, ${CLINIC_B}::uuid)`,
  );
  await dbAdmin.execute(sql`DELETE FROM auth.users WHERE id = ${USER_A}::uuid`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[smoke-conversas] fatal', e);
  process.exit(1);
});

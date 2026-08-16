/**
 * Patient hard-delete (C5, PlanoAção §5.6.5) + anonimização LGPD (ADR-021).
 *
 * F-02 (auditoria forense 2026-06-10): o DELETE em lote único por clínica era
 * tudo-ou-nada — um único paciente com prontuário/prescrição/documento (FK
 * ON DELETE RESTRICT, ADR-017) fazia rollback do lote INTEIRO e o cron
 * re-tentava os mesmos ids para sempre. Agora o processamento é POR PACIENTE
 * (savepoint aninhado): cada um termina em exatamente um de três estados:
 *
 *   - deleted     → DELETE físico ok (cascade nos filhos; suppression_list
 *                   sobrevive — sem FK, contato segue inmensajeável).
 *   - anonymized  → FK RESTRICT clínico bloqueou o DELETE. Caminho previsto em
 *                   ADR-017 ("anonimiza cadastro → mantém prontuário → hard-
 *                   delete do restante"), implementado por ADR-021: PII do
 *                   cadastro substituída por placeholders, filhos cadastrais
 *                   deletados explicitamente, registro clínico intacto,
 *                   anonymized_at setado (o scan do cron exclui anonimizados).
 *   - failed      → erro inesperado; lgpd_requests vira 'failed' (visibilidade)
 *                   e o cron re-tenta no próximo run. NUNCA aborta o lote.
 *
 * Em deleted E anonymized, lgpd_requests (type='delete') do paciente são
 * marcadas 'completed' — a obrigação LGPD foi cumprida (eliminação ou
 * anonimização sob a exceção do Art. 16, I — obrigação legal CFM).
 *
 * O SCAN cross-tenant que encontra ids expirados vive nos callers (cron route /
 * script dev, via dbAdmin); este módulo só processa ids recebidos, escopado a
 * UMA clínica via withTenant (RLS).
 *
 * Audit anonymization (ADR-012): audit_events é append-only sob FORCE RLS (sem
 * UPDATE policy para authenticated), então o strip de PII roda via dbAdmin nos
 * callers — unificado aqui em `anonymizePatientAuditTrail` (F-11: o script dev
 * removia menos chaves PII que a rota).
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { encryptForTenant } from '@/lib/crypto';
import { withTenant } from '@/lib/db/tenant';
import { PURGED_RESPONSE } from '@/lib/idempotency/purged';

import {
  lgpdRequests,
  patientAddresses,
  patientClinicalData,
  patientConsents,
  patientEmergencyContacts,
  patients,
} from '../schema';

export interface HardDeleteOutcome {
  deleted: number;
  anonymized: number;
  failed: number;
}

/**
 * Chaves PII (camelCase, vindas de toPatientSummary()) removidas dos JSONs
 * before/after de audit_events. Fonte única (F-11) — rota e script dev usam.
 */
export const PATIENT_PII_AUDIT_KEYS = [
  'nome',
  'email',
  'dataNascimento',
  'sexo',
  'obitoEm',
] as const;

/** Executor mínimo (dbAdmin) — recebido por parâmetro para não importar o pool
 *  admin dentro de um context (boundary C1: dbAdmin é allowlist-only). */
type AdminExecutor = { execute(query: SQL): Promise<unknown> };

/**
 * Strip de PII nos audit_events retidos + scrub de respostas cacheadas de
 * idempotency_keys dos pacientes em eliminação. Idempotente — seguro rodar
 * ANTES do DELETE (se o DELETE falhar, o strip já feito não corrompe nada).
 */
export async function anonymizePatientAuditTrail(
  admin: AdminExecutor,
  patientIds: string[],
): Promise<void> {
  if (patientIds.length === 0) return;
  // Drizzle expande um array interpolado em um record `($1, $2, ...)`, que o
  // PostgreSQL não converte para `text[]`. ARRAY[...] mantém cada id como bind
  // param e produz o tipo esperado por ANY.
  const ids = sql`ARRAY[${sql.join(
    patientIds.map((patientId) => sql`${patientId}`),
    sql`, `,
  )}]::text[]`;
  await admin.execute(
    sql`UPDATE audit_events
        SET before = (before - 'nome' - 'email' - 'dataNascimento' - 'sexo' - 'obitoEm'),
            after  = (after  - 'nome' - 'email' - 'dataNascimento' - 'sexo' - 'obitoEm')
        WHERE resource_type = 'patient' AND resource_id = ANY(${ids})`,
  );
  // A resposta de create/update é um PatientSummary cujo `id` é o patient id.
  //
  // LGPD-004 — o scrub anterior fazia `response = NULL`, e `NULL` já significava
  // OUTRA coisa no protocolo de idempotência: "reserva em andamento". Uma chave
  // concluída (status_code=200) virava indistinguível de uma operação em voo —
  // o replay recebia conflito falso, o health contava `in_flight` para algo que
  // terminou, e o trigger bloqueava o DELETE como se fosse recente.
  //
  // O sentinel abaixo mantém a resposta NÃO-NULA (portanto terminal) e sem PII.
  // `idempotentMutation` continua enxergando uma execução concluída; quem
  // consome só vê que o conteúdo foi expurgado.
  await admin.execute(
    sql`UPDATE idempotency_keys
        SET response = ${JSON.stringify(PURGED_RESPONSE)}::jsonb
        WHERE response IS NOT NULL
          AND response->>'purged' IS NULL
          AND response->>'id' = ANY(${ids})`,
  );
}

/**
 * LGPD-002 — saneia os payloads do OUTBOX do titular.
 *
 * `anonymizePatientAuditTrail` cuidava de `audit_events` e `idempotency_keys` e
 * parava ali. O outbox ficava intocado, inclusive os eventos já `skipped`, que
 * a política genérica conserva por até 30 dias. Resultado medido em produção:
 * sete pacientes ausentes de `patients` com nome/hash de CPF ainda no payload.
 *
 * Duas regras deliberadas:
 *
 *  - Só toca eventos TERMINAIS (`processed`/`skipped`). Uma linha `pending` ou
 *    `processing` ainda vai ser entregue a um handler; reescrever o payload
 *    debaixo dele trocaria um problema de privacidade por um de corrupção de
 *    fila. Se existir pendência do titular, ela é entregue e o próximo run do
 *    cron a alcança — o job é idempotente.
 *
 *  - Escopo por `clinic_id` + `patientId` dentro do payload. Evento de outro
 *    paciente ou de outro tenant fica byte a byte igual.
 *
 * As chaves removidas são as mesmas de `PATIENT_PII_AUDIT_KEYS` mais os
 * pseudônimos (`cpfHash`/`telefoneHash`): hash estável identifica o titular
 * para quem já tem o dado original.
 */
export async function anonymizePatientOutbox(
  admin: AdminExecutor,
  clinicId: string,
  patientIds: string[],
): Promise<void> {
  if (patientIds.length === 0) return;
  const ids = sql`ARRAY[${sql.join(
    patientIds.map((patientId) => sql`${patientId}`),
    sql`, `,
  )}]::text[]`;
  await admin.execute(
    sql`UPDATE outbox
        SET payload = (payload
              - 'nome' - 'email' - 'dataNascimento' - 'sexo' - 'obitoEm'
              - 'cpfHash' - 'telefoneHash' - 'telefone' - 'cpf')
        WHERE clinic_id = ${clinicId}::uuid
          AND status IN ('processed', 'skipped')
          AND payload->>'patientId' = ANY(${ids})`,
  );
}

/** FK violation (23503) — único caminho esperado: RESTRICT clínico (ADR-017).
 *  postgres-js pode aflorar o erro direto ou como `cause` (drizzle wrap). */
export function isFkRestrictViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (typeof cur === 'object' && (cur as { code?: unknown }).code === '23503') return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** Placeholders de anonimização (ADR-021). Únicos por paciente para não colidir
 *  com UNIQUE(clinic_id, cpf_hash) / UNIQUE(clinic_id, email). O prefixo
 *  `anon:` nunca colide com um HMAC hex real. */
function anonEmail(patientId: string): string {
  return `anon+${patientId}@lgpd.invalid`;
}
function anonCpfHash(patientId: string): string {
  return `anon:${patientId}`;
}

/**
 * Porta do Storage, injetada pelo caller.
 *
 * `@/lib/storage/exports` usa o client service-role e um context não pode
 * alcançá-lo (boundary C1). Recebê-la por parâmetro mantém a regra e deixa o
 * teste exercitar sucesso, ausência de objeto e falha sem tocar em rede.
 */
export type ExportEraser = (clinicId: string, patientId: string) => Promise<{ removed: number }>;

export async function hardDeletePatients(
  clinicId: string,
  ids: string[],
  eraseExports?: ExportEraser,
): Promise<HardDeleteOutcome> {
  const outcome: HardDeleteOutcome = { deleted: 0, anonymized: 0, failed: 0 };
  if (ids.length === 0) return outcome;

  // LGPD-003 — o Storage é apagado ANTES de o pedido virar `completed`.
  //
  // A ordem não é estética: se o objeto sumir depois da conclusão e a remoção
  // falhar, o sistema já terá dito ao titular que a eliminação terminou
  // enquanto a cópia mais completa dos dados dele continua baixável. Falhar
  // aqui deixa o paciente para o próximo run — o pedido segue observável em
  // `processing`, que é o estado honesto.
  const storageFailures = new Set<string>();
  if (eraseExports) {
    for (const id of ids) {
      try {
        await eraseExports(clinicId, id);
      } catch {
        storageFailures.add(id);
      }
    }
  }

  await withTenant(clinicId, async (tx) => {
    for (const id of ids) {
      if (storageFailures.has(id)) {
        outcome.failed++;
        await markDeleteRequestsFailed(tx, clinicId, id);
        continue;
      }
      try {
        // Savepoint: o DELETE que violar o RESTRICT clínico faz rollback só
        // deste paciente; o lote continua (F-02).
        const result = await tx.transaction(async (sp) => {
          const deleted = await sp
            .delete(patients)
            .where(eq(patients.id, id))
            .returning({ id: patients.id });
          if (deleted.length === 0) return 'noop' as const;
          await markDeleteRequestsCompleted(sp, clinicId, id);
          return 'deleted' as const;
        });
        if (result === 'deleted') outcome.deleted++;
      } catch (err) {
        if (!isFkRestrictViolation(err)) {
          outcome.failed++;
          await markDeleteRequestsFailed(tx, clinicId, id);
          continue;
        }
        // RESTRICT clínico → anonimiza (ADR-017 passo 3 / ADR-021).
        try {
          await tx.transaction(async (sp) => {
            await anonymizePatientRow(sp, clinicId, id);
            await markDeleteRequestsCompleted(sp, clinicId, id);
          });
          outcome.anonymized++;
        } catch {
          outcome.failed++;
          await markDeleteRequestsFailed(tx, clinicId, id);
        }
      }
    }
  });
  return outcome;
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/**
 * Anonimização in-place (ADR-021): PII cadastral substituída por placeholders;
 * filhos cadastrais (consents/clinical_data/addresses/emergency_contacts) —
 * que o CASCADE removeria no delete normal — são deletados explicitamente.
 * O registro clínico (prontuarios/prescriptions/medical_documents) permanece
 * íntegro com seus snapshots imutáveis (ADR-017 §4).
 */
async function anonymizePatientRow(sp: Tx, clinicId: string, id: string): Promise<void> {
  // Ciphertext VÁLIDO de string vazia (decriptável) — o ponto único de decrypt
  // não pode quebrar se algum fluxo legado alcançar a linha anonimizada.
  const emptyCiphertext = await encryptForTenant(clinicId, '');
  await sp
    .update(patients)
    .set({
      nome: 'Paciente anonimizado (LGPD)',
      cpfEncrypted: emptyCiphertext,
      cpfHash: anonCpfHash(id),
      telefoneEncrypted: null,
      telefoneHash: null,
      email: anonEmail(id),
      dataNascimento: null,
      sexo: null,
      obitoEm: null,
      anonymizedAt: sql`now()`,
      deletedAt: sql`coalesce(deleted_at, now())`,
    })
    .where(eq(patients.id, id));
  await sp.delete(patientConsents).where(eq(patientConsents.patientId, id));
  await sp.delete(patientClinicalData).where(eq(patientClinicalData.patientId, id));
  await sp.delete(patientAddresses).where(eq(patientAddresses.patientId, id));
  await sp.delete(patientEmergencyContacts).where(eq(patientEmergencyContacts.patientId, id));
}

async function markDeleteRequestsCompleted(
  sp: Tx,
  clinicId: string,
  patientId: string,
): Promise<void> {
  await sp
    .update(lgpdRequests)
    .set({ status: 'completed', fulfilledAt: sql`now()` })
    .where(
      and(
        eq(lgpdRequests.clinicId, clinicId),
        eq(lgpdRequests.patientId, patientId),
        eq(lgpdRequests.type, 'delete'),
        inArray(lgpdRequests.status, ['pending', 'processing']),
      ),
    );

  // LGPD-003 — a URL assinada persistida do pedido de EXPORTAÇÃO do mesmo
  // titular também morre aqui. O objeto já foi removido do bucket, mas deixar a
  // URL na linha mantém um bearer token guardado e faz a UI oferecer um
  // download que não existe mais. Escopo: pedidos de `export` deste paciente.
  await sp
    .update(lgpdRequests)
    .set({ exportSignedUrl: null, exportSignedUrlExpiresAt: null })
    .where(
      and(
        eq(lgpdRequests.clinicId, clinicId),
        eq(lgpdRequests.patientId, patientId),
        eq(lgpdRequests.type, 'export'),
      ),
    );
}

/** Best-effort (fora de savepoint próprio): visibilidade do bloqueio (F-02c). */
async function markDeleteRequestsFailed(
  tx: Tx,
  clinicId: string,
  patientId: string,
): Promise<void> {
  try {
    await tx
      .update(lgpdRequests)
      .set({ status: 'failed' })
      .where(
        and(
          eq(lgpdRequests.clinicId, clinicId),
          eq(lgpdRequests.patientId, patientId),
          eq(lgpdRequests.type, 'delete'),
          inArray(lgpdRequests.status, ['pending', 'processing']),
        ),
      );
  } catch {
    // visibilidade é best-effort; o re-run do cron tenta de novo.
  }
}

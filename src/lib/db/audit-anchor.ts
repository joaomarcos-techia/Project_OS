/**
 * S5 / P12.10 — ancoragem das trilhas de auditoria por SHA-256 ENCADEADO (a parte técnica da "evidência externa" do
 * `s5-contrato-trilha-59.md` e da alternativa da ADR-075; risco `auditoria-sem-hash-chain`).
 *
 * Os gatilhos append-only (0171 para a trilha da clínica, a candidata do #59 para a da plataforma) param a aplicação,
 * mas o dono do banco ainda pode desligá-los por DDL. Contra ele, a única defesa é uma evidência que mora FORA do
 * banco: um resumo por dia com o hash de cada linha, encadeado ao dia anterior. Guardado fora (o destino é decisão
 * do titular), qualquer linha alterada, apagada ou inserida com data retroativa muda o resumo daquele dia e quebra a
 * cadeia dali em diante. Isto DETECTA depois; não impede (o limite honesto da ADR-075 continua valendo).
 *
 * O que entra no hash de cada linha: TODAS as colunas. Em `audit_events`, `before`/`after` entram SEM as chaves de dado
 * pessoal que a anonimização LGPD retira (a única alteração que o gatilho da 0171 aceita): anonimizar não quebra a
 * cadeia, e mudar qualquer outra coisa, sim. A lista é a MESMA do gatilho (teste de drift).
 *
 * Só leitura. Não cria cron, serviço nem tabela: quem calcula é o operador (`scripts/security/audit-anchor.ts`) ou,
 * quando o titular decidir o destino, um agendamento existente. Não é um segundo sistema de auditoria: lê as trilhas
 * que já existem e não grava nada.
 */
import { createHash } from 'node:crypto';

/** As chaves que a anonimização LGPD retira (idênticas ao `pii` de `clinic_audit_append_only()` da 0171). */
export const AUDIT_ANONYMIZED_KEYS = [
  'nome',
  'email',
  'dataNascimento',
  'sexo',
  'obitoEm',
] as const;

export interface AnchorTrailSpec {
  /** Identificador estável da trilha (entra no hash: a cadeia de uma trilha não serve para a outra). */
  id: 'clinic_audit' | 'platform_audit';
  table: string;
  /**
   * Expressão SQL ESTÁTICA (nunca entrada de usuário) do texto canônico da linha. Datas em UTC fixo e jsonb pela
   * saída canônica do Postgres, para o mesmo banco dar o mesmo texto em qualquer sessão.
   */
  canonicalRowSql: string;
}

const utc = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
const anonymizedArray = `ARRAY[${AUDIT_ANONYMIZED_KEYS.map((k) => `'${k}'`).join(', ')}]::text[]`;

export const CLINIC_AUDIT_ANCHOR: AnchorTrailSpec = {
  id: 'clinic_audit',
  table: 'public.audit_events',
  canonicalRowSql: `jsonb_build_array(id, clinic_id, user_id, action, resource_type, resource_id,
      before - ${anonymizedArray}, after - ${anonymizedArray},
      ip_address::text, user_agent, request_id, correlation_id, ${utc('created_at')})::text`,
};

export const PLATFORM_AUDIT_ANCHOR: AnchorTrailSpec = {
  id: 'platform_audit',
  table: 'public.super_admin_actions',
  canonicalRowSql: `jsonb_build_array(id, super_admin_id, action, target_clinic_id, payload,
      ip_address, user_agent, ${utc('created_at')})::text`,
};

export const ANCHOR_TRAILS: readonly AnchorTrailSpec[] = [
  CLINIC_AUDIT_ANCHOR,
  PLATFORM_AUDIT_ANCHOR,
];

/** Início de toda cadeia (versão do formato: mudar o canônico exige nova versão, nunca reaproveitar). */
export const ANCHOR_GENESIS = createHash('sha256').update('qoro/audit-anchor/v1').digest('hex');

export interface DayAnchor {
  trail: AnchorTrailSpec['id'];
  /** Dia em UTC (`YYYY-MM-DD`). */
  day: string;
  count: number;
  /** Resumo do dia anterior da MESMA trilha (ou o gênese). */
  prev: string;
  digest: string;
}

/** O resumo do dia: hash do anterior + trilha + dia + quantidade + hashes das linhas na ordem (created_at, id). */
export function chainDay(
  prev: string,
  trail: AnchorTrailSpec['id'],
  day: string,
  rowHashes: readonly string[],
): string {
  const h = createHash('sha256');
  h.update(`${prev}\n${trail}\n${day}\n${rowHashes.length}\n`);
  for (const r of rowHashes) h.update(`${r}\n`);
  return h.digest('hex');
}

export type AnchorQuery = (
  text: string,
  params: readonly unknown[],
) => Promise<ReadonlyArray<Record<string, unknown>>>;

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

/** Hash de cada linha do dia (UTC), na ordem estável. Só leitura. */
export async function dayRowHashes(
  query: AnchorQuery,
  spec: AnchorTrailSpec,
  day: string,
): Promise<string[]> {
  if (!DAY.test(day)) throw new Error(`dia inválido: ${day}`);
  const rows = await query(
    `SELECT encode(sha256(convert_to(${spec.canonicalRowSql}, 'UTF8')), 'hex') AS h
       FROM ${spec.table}
      WHERE created_at >= ($1::date)::timestamp AT TIME ZONE 'UTC'
        AND created_at < (($1::date) + 1)::timestamp AT TIME ZONE 'UTC'
      ORDER BY created_at, id`,
    [day],
  );
  return rows.map((r) => String(r.h));
}

const nextDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Resumos encadeados de `from` a `to` (inclusive), começando do `prev` informado (gênese por padrão). */
export async function computeAnchors(
  query: AnchorQuery,
  spec: AnchorTrailSpec,
  from: string,
  to: string,
  prev: string = ANCHOR_GENESIS,
): Promise<DayAnchor[]> {
  if (!DAY.test(from) || !DAY.test(to) || from > to) throw new Error('intervalo de dias inválido');
  const out: DayAnchor[] = [];
  let chain = prev;
  for (let day = from; day <= to; day = nextDay(day)) {
    const hashes = await dayRowHashes(query, spec, day);
    const digest = chainDay(chain, spec.id, day, hashes);
    out.push({ trail: spec.id, day, count: hashes.length, prev: chain, digest });
    chain = digest;
  }
  return out;
}

export type AnchorFinding =
  | { kind: 'chain_broken'; day: string; expectedPrev: string; storedPrev: string }
  | {
      kind: 'day_changed';
      day: string;
      storedCount: number;
      currentCount: number;
    }
  | { kind: 'wrong_trail'; day: string };

/**
 * Confere os resumos GUARDADOS FORA contra o banco de agora. Vazio = íntegro. `day_changed` = alguma linha daquele
 * dia foi alterada, apagada ou inserida depois (a quantidade ajuda a separar apagar/inserir de alterar);
 * `chain_broken` = a sequência guardada foi editada (falta um dia ou o anterior não bate).
 */
export async function verifyAnchors(
  query: AnchorQuery,
  spec: AnchorTrailSpec,
  stored: readonly DayAnchor[],
): Promise<AnchorFinding[]> {
  const findings: AnchorFinding[] = [];
  let expectedPrev: string | null = null;
  for (const a of stored) {
    if (a.trail !== spec.id) {
      findings.push({ kind: 'wrong_trail', day: a.day });
      continue;
    }
    if (expectedPrev !== null && a.prev !== expectedPrev) {
      findings.push({ kind: 'chain_broken', day: a.day, expectedPrev, storedPrev: a.prev });
    }
    const hashes = await dayRowHashes(query, spec, a.day);
    if (chainDay(a.prev, spec.id, a.day, hashes) !== a.digest) {
      findings.push({
        kind: 'day_changed',
        day: a.day,
        storedCount: a.count,
        currentCount: hashes.length,
      });
    }
    expectedPrev = a.digest;
  }
  return findings;
}

/**
 * As QUATRO perguntas do cadastro autônomo — ADR-060 §1.c.1.
 *
 * Passo 1 do fluxo, e ele é IMPESSOAL de propósito:
 *
 *   4 perguntas → identidade + consentimento + nome da clínica
 *               → verificação de e-mail → Checkout hospedado
 *
 * TODAS as perguntas são de marcar. Não existe campo de texto em nenhuma delas,
 * e isso é decisão de segurança antes de ser de produto: um texto livre em
 * "por onde ficou sabendo" convida a digitar o nome de quem indicou — PII de um
 * terceiro que nunca consentiu, entrando ANTES da caixa de consentimento.
 *
 * As listas abaixo espelham os CHECK da migration 0098. A duplicação é
 * deliberada e tem teste: o banco é a autoridade (recusa mesmo se este arquivo
 * afrouxar), e o Zod existe para devolver 400 em vez de 500.
 */
import 'server-only';

import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { dbAdmin } from '@/lib/db';

import { signupSessions } from '../schema';

import { signupAnswerValuesSchema } from './signup-answer-values';
import { hashSignupToken } from './signup-session';

/** Quantos profissionais atendem na clínica. */
export { PROFESSIONALS_BANDS } from './signup-answer-values';

/**
 * Atendimentos por semana, em FAIXA e nunca em número livre. Ninguém sabe o
 * número de cabeça, então um inteiro produziria precisão falsa — e em clínica
 * pequena ele se aproxima de um identificador.
 */
export { WEEKLY_APPOINTMENT_BANDS } from './signup-answer-values';

/** `outro_sistema` é a resposta com consequência: oferece `/agenda/importar`. */
export { CURRENT_TOOLING } from './signup-answer-values';

/**
 * Canal DECLARADO. Não duplica o `gclid`/UTM do §21.3 — aquilo só enxerga o que
 * é pago e etiquetado, e é cego para indicação de colega, que é justamente o
 * canal que se quer medir. Guarda o CANAL, nunca quem indicou.
 */
export { DISCOVERY_SOURCES } from './signup-answer-values';

/**
 * `.strict()` recusa campo desconhecido em vez de ignorar — mesmo motivo do
 * corpo de `POST /api/signup/sessions`: ignorar ensina o cliente a mandar lixo e
 * esconde a divergência quando as fatias seguintes lerem campos novos.
 */
export const signupAnswersSchema = signupAnswerValuesSchema.extend({
  /** Versão lida pelo cliente. A aba que perder a corrida recebe conflito. */
  rowVersion: z.number().int().min(1),
});

export type SignupAnswers = z.infer<typeof signupAnswersSchema>;

/**
 * Estados em que a sessão ainda está EM ANDAMENTO.
 *
 * `details_complete` entra junto com `initiated` porque voltar e trocar uma
 * resposta é uso normal — não um estado novo. `expired` e `blocked` ficam de
 * fora: são saídas, não etapas.
 */
const ACTIVE_STATUSES = ['initiated', 'details_complete'] as const;

const IDLE_TTL_SECONDS = 15 * 60;

export type RecordAnswersOutcome =
  | { ok: true; rowVersion: number }
  /** Cookie ausente, token desconhecido, sessão vencida ou bloqueada. */
  | { ok: false; reason: 'gone' }
  /** Outra aba gravou primeiro. O cliente relê e reenvia. */
  | { ok: false; reason: 'conflict' };

/**
 * Grava as respostas e move a sessão para `details_complete`.
 *
 * UMA ida ao banco: o `UPDATE` guardado carrega a validação de sessão viva, o
 * CAS de `row_version` e a renovação do idle. Ler antes para depois escrever
 * abriria janela entre a checagem e a escrita — que é exatamente o que o CAS
 * existe para fechar.
 *
 * O prazo novo sai de `now()` do BANCO, não de um `Date` do processo: o driver
 * não faz bind de `Date` dentro de um template `sql` cru, e isso já quebrou em
 * runtime uma vez (ver `readSignupSession`).
 */
export async function recordSignupAnswers(
  rawToken: string,
  answers: SignupAnswers,
): Promise<RecordAnswersOutcome> {
  const tokenHash = hashSignupToken(rawToken);

  const [row] = await dbAdmin
    .update(signupSessions)
    .set({
      professionalsBand: answers.professionalsBand,
      weeklyAppointmentsBand: answers.weeklyAppointmentsBand,
      currentTooling: answers.currentTooling,
      discoverySource: answers.discoverySource,
      answeredAt: sql`now()`,
      status: 'details_complete',
      rowVersion: sql`${signupSessions.rowVersion} + 1`,
      // `least(...)`: renovar não pode empurrar a sessão para além do prazo
      // ABSOLUTO, senão atividade contínua a tornaria eterna.
      idleExpiresAt: sql`least(now() + make_interval(secs => ${IDLE_TTL_SECONDS}), ${signupSessions.absoluteExpiresAt})`,
    })
    .where(
      and(
        eq(signupSessions.tokenHash, tokenHash),
        eq(signupSessions.rowVersion, answers.rowVersion),
        inArray(signupSessions.status, [...ACTIVE_STATUSES]),
        isNull(signupSessions.consumedAt),
        gt(signupSessions.idleExpiresAt, sql`now()`),
        gt(signupSessions.absoluteExpiresAt, sql`now()`),
      ),
    )
    .returning({ rowVersion: signupSessions.rowVersion });

  if (row) return { ok: true, rowVersion: row.rowVersion };

  // Zero linhas tem duas causas, e a distinção muda o que o cliente faz: em
  // `conflict` ele relê e reenvia; em `gone` não há o que reenviar. Uma segunda
  // consulta é aceitável aqui — só acontece no caminho de falha.
  const [existe] = await dbAdmin
    .select({ rowVersion: signupSessions.rowVersion })
    .from(signupSessions)
    .where(
      and(
        eq(signupSessions.tokenHash, tokenHash),
        // Identidade já salva congela respostas: conflito exige reler /me.
        inArray(signupSessions.status, [...ACTIVE_STATUSES, 'identity_pending', 'email_pending']),
        isNull(signupSessions.consumedAt),
        gt(signupSessions.idleExpiresAt, sql`now()`),
        gt(signupSessions.absoluteExpiresAt, sql`now()`),
      ),
    )
    .limit(1);

  return existe ? { ok: false, reason: 'conflict' } : { ok: false, reason: 'gone' };
}

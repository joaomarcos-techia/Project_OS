/**
 * O-7 — onboarding OPERACIONAL: o que acontece depois de a clínica existir.
 * SERVER-ONLY.
 *
 * DIVISÃO DE AUTORIDADE, que é a decisão de projeto deste arquivo:
 *
 *   - O QUE A CLÍNICA JÁ FEZ é derivado de presença de dado e continua em
 *     `dashboard/data.ts` (checklist de ativação, GAP 8). "Cadastre um médico"
 *     está feito se, e somente se, existe médico. Derivação não tem o que
 *     falsificar: não há id vindo do browser, não há como marcar concluído sem
 *     fazer, não há como concluir para outro tenant. Estado marcado seria
 *     ESTRITAMENTE mais fraco, então essa parte não ganhou tabela.
 *
 *   - O QUE A PESSOA JÁ VIU não é derivável de dado nenhum e vive aqui, em
 *     `onboarding_progress` (migration 0104): passo do tour, se pulou, se já
 *     abriu a central de documentação, se dispensou o checklist.
 *
 * Por que servidor e não `localStorage`: o estado precisa sobreviver a refresh,
 * logout/login, segunda aba e NAVEGADOR NOVO. `localStorage` morre no navegador
 * novo — quem completou o tour no consultório o veria de novo em casa.
 *
 * Nada aqui aceita identificador do browser. `clinicId` e `userId` vêm de
 * `getCurrentUser()` no servidor; do cliente vem apenas a AÇÃO (enum fechado) e,
 * quando avança o tour, o índice do passo de onde ele pensa estar — que é um
 * inteiro limitado, usado como chave de idempotência, nunca como autoridade.
 */
import 'server-only';

import { and, eq, isNull, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { onboardingProgress, type OnboardingProgressRow } from '@/contexts/onboarding/schema';
import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';

/** Espelha o CHECK `onboarding_progress_tour_state_chk` da migration 0104. */
export type TourState = 'not_started' | 'in_progress' | 'completed' | 'skipped';

export interface TourStep {
  key: string;
  title: string;
  body: string;
  /** Para onde o passo aponta. Sempre rota interna — nunca URL do cliente. */
  href: string;
}

/**
 * Os passos do tour. Lista FECHADA em código: o banco limita `tour_step` a 32
 * para que nenhuma escrita adulterada guarde um passo que a UI não mostraria, e
 * o schema Zod abaixo aperta o limite para o tamanho real desta lista.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    key: 'dashboard',
    title: 'O pulso da clínica',
    body: 'O painel abre no que está acontecendo agora: quem espera, quem está em atendimento e o que vem a seguir.',
    href: '/dashboard',
  },
  {
    key: 'agenda',
    title: 'A agenda',
    body: 'Marque, remarque e confirme atendimentos. Os horários vêm da disponibilidade que você definir para cada profissional.',
    href: '/agenda',
  },
  {
    key: 'consultorio',
    title: 'O consultório',
    body: 'É onde o atendimento acontece: fila de espera, prontuário e evolução do paciente no mesmo lugar.',
    href: '/consultorio',
  },
  {
    key: 'pacientes',
    title: 'Os pacientes',
    body: 'A base de cadastro. Cada paciente carrega histórico, documentos e situação financeira.',
    href: '/pacientes',
  },
  {
    key: 'financeiro',
    title: 'Caixa e financeiro',
    body: 'O que foi atendido vira lançamento. O caixa mostra o que entrou, o que saiu e o que ainda falta faturar.',
    href: '/caixa',
  },
  {
    key: 'documentacao',
    title: 'A central de ajuda',
    body: 'Todos os fluxos explicados por escrito. Quando esta janela fechar, ela continua em Ajuda, no menu.',
    href: '/documentacao',
  },
] as const;

export const TOUR_LAST_STEP = TOUR_STEPS.length - 1;

export interface OnboardingProgressState {
  tourState: TourState;
  /** Índice em `TOUR_STEPS`. Sempre dentro da lista. */
  tourStep: number;
  tourFinishedAt: string | null;
  docsVisitedAt: string | null;
  checklistDismissedAt: string | null;
  rowVersion: number;
  /**
   * A janela do tour está aberta exatamente quando o estado NÃO é terminal.
   * Fechar grava `skipped`, então fechar tem efeito observável e o refresh no
   * meio do tour volta no mesmo passo — não existe um "aberto" que só o
   * componente conheça.
   */
  shouldAutoOpenTour: boolean;
}

/** Linha inexistente é um estado legítimo: ninguém abriu o app ainda. */
const NEVER_STARTED: OnboardingProgressState = {
  tourState: 'not_started',
  tourStep: 0,
  tourFinishedAt: null,
  docsVisitedAt: null,
  checklistDismissedAt: null,
  rowVersion: 0,
  shouldAutoOpenTour: true,
};

/**
 * Ações aceitas. Enum FECHADO — o browser escolhe entre estas e nada mais.
 *
 * `close` não está aqui de propósito: fechar É pular. Se fechar deixasse
 * `in_progress`, ou o tour reabriria na navegação seguinte (e fechar não
 * significaria nada), ou nunca mais reabriria (e o refresh perderia o fluxo).
 * `tour_skip` preserva o passo, então quem reabre volta de onde parou.
 */
export const onboardingActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('tour_start') }).strict(),
  z
    .object({
      action: z.literal('tour_next'),
      fromStep: z.number().int().min(0).max(TOUR_LAST_STEP),
    })
    .strict(),
  z
    .object({
      action: z.literal('tour_previous'),
      fromStep: z.number().int().min(0).max(TOUR_LAST_STEP),
    })
    .strict(),
  z.object({ action: z.literal('tour_complete') }).strict(),
  z.object({ action: z.literal('tour_skip') }).strict(),
  z.object({ action: z.literal('tour_reopen') }).strict(),
  z.object({ action: z.literal('docs_visited') }).strict(),
  z.object({ action: z.literal('checklist_dismiss') }).strict(),
]);

export type OnboardingAction = z.infer<typeof onboardingActionSchema>;

export type OnboardingActionOutcome =
  | { ok: true; progress: OnboardingProgressState; changed: boolean }
  /** O cliente afirma estar à frente do servidor: releia antes de agir de novo. */
  | { ok: false; reason: 'stale'; progress: OnboardingProgressState };

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function toState(row: OnboardingProgressRow): OnboardingProgressState {
  const tourState = row.tourState as TourState;
  return {
    tourState,
    // O CHECK do banco limita a 32 e a lista pode encolher numa release futura;
    // recortar aqui impede que uma linha antiga aponte para um passo que sumiu.
    tourStep: Math.min(row.tourStep, TOUR_LAST_STEP),
    tourFinishedAt: iso(row.tourFinishedAt),
    docsVisitedAt: iso(row.docsVisitedAt),
    checklistDismissedAt: iso(row.checklistDismissedAt),
    rowVersion: row.rowVersion,
    shouldAutoOpenTour: tourState !== 'completed' && tourState !== 'skipped',
  };
}

type Tx = Parameters<Parameters<typeof withTenant<unknown>>[1]>[0];

function keyOf(clinicId: string, userId: string) {
  return and(eq(onboardingProgress.clinicId, clinicId), eq(onboardingProgress.userId, userId));
}

function readRow(tx: Tx, clinicId: string, userId: string) {
  return tx.select().from(onboardingProgress).where(keyOf(clinicId, userId)).limit(1);
}

/**
 * Lê o progresso. NÃO cria linha: leitura de dashboard não deve escrever, e a
 * ausência de linha já significa exatamente "ninguém começou".
 */
export async function readOnboardingProgress(
  clinicId: string,
  userId: string,
): Promise<OnboardingProgressState> {
  const rows = await withTenant(clinicId, (tx) => readRow(tx, clinicId, userId), userId);
  const row = rows[0];
  return row ? toState(row) : NEVER_STARTED;
}

/**
 * Aplica uma ação. Toda a decisão vive no `WHERE`: a pré-condição viaja com a
 * escrita, de modo que dois submits simultâneos não podem ambos avançar. Quem
 * perde a corrida não recebe erro — recebe o estado autoritativo e
 * `changed: false`, porque repetir a mesma etapa é idempotente por contrato.
 */
export async function applyOnboardingAction(
  clinicId: string,
  userId: string,
  action: OnboardingAction,
): Promise<OnboardingActionOutcome> {
  return withTenant(
    clinicId,
    async (tx) => {
      // Cria a linha sem sobrescrever nada. `DO NOTHING` torna a criação
      // idempotente sob concorrência: duas abas chegando juntas produzem uma
      // linha, não um erro de chave duplicada.
      await tx
        .insert(onboardingProgress)
        .values({ clinicId, userId })
        .onConflictDoNothing({ target: [onboardingProgress.clinicId, onboardingProgress.userId] });

      const changedRow = (await mutate(tx, clinicId, userId, action))[0];
      if (changedRow) {
        metrics.emit('onboarding.progress.changed', { action: action.action });
        return { ok: true as const, progress: toState(changedRow), changed: true };
      }

      // Nenhuma linha mudou: ou a pré-condição já estava satisfeita (replay), ou
      // o cliente está à frente. Só a releitura distingue os dois casos.
      const row = (await readRow(tx, clinicId, userId))[0];
      const progress = row ? toState(row) : NEVER_STARTED;

      if (
        (action.action === 'tour_next' || action.action === 'tour_previous') &&
        progress.tourState === 'in_progress' &&
        action.fromStep > progress.tourStep
      ) {
        metrics.emit('onboarding.progress.stale', { action: action.action });
        return { ok: false as const, reason: 'stale' as const, progress };
      }
      return { ok: true as const, progress, changed: false };
    },
    userId,
  );
}

/**
 * O `WHERE` de cada ação É a regra de negócio. Escrever a pré-condição junto da
 * escrita, e não em JavaScript depois de um SELECT, é o que remove a janela
 * entre ler e decidir — a janela por onde duas abas passariam juntas.
 */
function mutate(
  tx: Tx,
  clinicId: string,
  userId: string,
  action: OnboardingAction,
): Promise<OnboardingProgressRow[]> {
  const key = keyOf(clinicId, userId);
  const bump = {
    rowVersion: sql<number>`${onboardingProgress.rowVersion} + 1`,
    updatedAt: sql<Date>`now()`,
  };
  const update = (values: Record<string, unknown>, where: ReturnType<typeof and>) =>
    tx
      .update(onboardingProgress)
      .set({ ...bump, ...values })
      .where(where)
      .returning();

  switch (action.action) {
    case 'tour_start':
      // Só sai de `not_started`. Recomeçar um tour já concluído é `tour_reopen`.
      return update(
        { tourState: 'in_progress', tourStep: 0, tourStartedAt: sql`now()` },
        and(key, eq(onboardingProgress.tourState, 'not_started')),
      );

    case 'tour_next':
      // O último passo não avança: a saída dali é concluir. Barrar em JavaScript
      // é correto porque o limite não depende de nada que esteja no banco.
      if (action.fromStep >= TOUR_LAST_STEP) return Promise.resolve([]);
      // `tourStep = fromStep` é a idempotência: um duplo clique manda o mesmo
      // `fromStep` duas vezes e a segunda não encontra linha para atualizar.
      return update(
        { tourStep: action.fromStep + 1 },
        and(
          key,
          eq(onboardingProgress.tourState, 'in_progress'),
          eq(onboardingProgress.tourStep, action.fromStep),
        ),
      );

    case 'tour_previous':
      if (action.fromStep <= 0) return Promise.resolve([]);
      return update(
        { tourStep: action.fromStep - 1 },
        and(
          key,
          eq(onboardingProgress.tourState, 'in_progress'),
          eq(onboardingProgress.tourStep, action.fromStep),
        ),
      );

    case 'tour_complete':
      // Aceita de `in_progress` E de `not_started` (quem clica "concluir" na
      // primeira tela nunca passou por `tour_start`). `tourStartedAt` recebe
      // COALESCE porque o CHECK exige início sempre que o estado não é inicial.
      return update(
        {
          tourState: 'completed',
          tourStep: TOUR_LAST_STEP,
          tourStartedAt: sql`COALESCE(${onboardingProgress.tourStartedAt}, now())`,
          tourFinishedAt: sql`now()`,
        },
        and(key, inArray(onboardingProgress.tourState, ['not_started', 'in_progress'])),
      );

    case 'tour_skip':
      // Pular NÃO mexe no passo: se a pessoa reabrir, volta de onde parou.
      return update(
        {
          tourState: 'skipped',
          tourStartedAt: sql`COALESCE(${onboardingProgress.tourStartedAt}, now())`,
          tourFinishedAt: sql`now()`,
        },
        and(key, inArray(onboardingProgress.tourState, ['not_started', 'in_progress'])),
      );

    case 'tour_reopen':
      // Só de estado terminal. Reabrir preserva o passo de quem pulou no meio;
      // quem completou volta ao início, porque `tour_complete` fixou o último.
      return update(
        {
          tourState: 'in_progress',
          tourFinishedAt: null,
          tourStep: sql`CASE WHEN ${onboardingProgress.tourState} = 'completed' THEN 0 ELSE ${onboardingProgress.tourStep} END`,
        },
        and(key, inArray(onboardingProgress.tourState, ['completed', 'skipped'])),
      );

    case 'docs_visited':
      // Primeira visita vence. `IS NULL` faz a repetição não gravar nada — o
      // carimbo responde "quando descobriu a ajuda", e sobrescrever apagaria isso.
      return update(
        { docsVisitedAt: sql`now()` },
        and(key, isNull(onboardingProgress.docsVisitedAt)),
      );

    case 'checklist_dismiss':
      return update(
        { checklistDismissedAt: sql`now()` },
        and(key, isNull(onboardingProgress.checklistDismissedAt)),
      );
  }
}

/** Recorta um índice para dentro da lista — a UI nomeia o passo sem reimplementar isto. */
export function tourStepAt(index: number): TourStep {
  return TOUR_STEPS[Math.min(Math.max(index, 0), TOUR_LAST_STEP)] as TourStep;
}

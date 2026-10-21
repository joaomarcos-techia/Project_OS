/**
 * Domínio do convite mágico (server-only). Tabela `clinic_invites` é global-protected
 * (sem dado de tenant); leitura/escrita via dbAdmin/service_role. A criação roda
 * DENTRO da tx do superAdminAction (auditada); as demais transições usam UPDATE
 * guardado por `version` (optimistic lock — impede 2 abas concluírem o mesmo convite).
 */
import 'server-only';

import { and, asc, eq, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { dbAdmin, type Tx } from '@/lib/db';
/* eslint-disable boundaries/element-types -- catálogo de planos (billing) p/ o wizard
   público; leitura cross-context do catálogo global, como tenant-context lê identity. */
import { OFFER_2026_PLAN_CODES } from '@/contexts/billing/offer-2026';
import { plans, prices } from '@/contexts/billing/schema';
/* eslint-enable boundaries/element-types */
import { clinicInvites, type ClinicInviteRow } from '../schema';
import { hashToken } from './token';

export interface InviteCreateTxArgs {
  rawToken: string;
  createdBy: string;
  email: string | null;
  planSnapshot: unknown;
  metadata: unknown;
}

/** Cria o convite (status pending, expira em 24h) DENTRO da tx. Retorna o id. */
export async function createInviteTx(tx: Tx, args: InviteCreateTxArgs): Promise<string> {
  const [row] = await tx
    .insert(clinicInvites)
    .values({
      tokenHash: hashToken(args.rawToken),
      status: 'pending',
      email: args.email,
      createdBy: args.createdBy,
      planSnapshot: args.planSnapshot as never,
      metadata: args.metadata as never,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning({ id: clinicInvites.id });
  return row!.id;
}

/**
 * Resolve um convite ABERTO pelo token cru (rota pública /join). Null se
 * inexistente, expirado, ou já completed/cancelled. Lookup por token_hash (unique).
 */
export async function resolveOpenInvite(rawToken: string): Promise<ClinicInviteRow | null> {
  const [row] = await dbAdmin
    .select()
    .from(clinicInvites)
    .where(eq(clinicInvites.tokenHash, hashToken(rawToken)))
    .limit(1);
  if (!row) return null;
  if (row.status === 'completed' || row.status === 'cancelled') return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

/**
 * Lê só o status de um convite por token (QUALQUER estado). A página /join usa para
 * distinguir "já ativada" (completed) de "inválido/expirado" — UX pós-ativação.
 */
export async function getInviteStatus(
  rawToken: string,
): Promise<{ status: string; provisionedClinicId: string | null } | null> {
  const [row] = await dbAdmin
    .select({
      status: clinicInvites.status,
      provisionedClinicId: clinicInvites.provisionedClinicId,
    })
    .from(clinicInvites)
    .where(eq(clinicInvites.tokenHash, hashToken(rawToken)))
    .limit(1);
  return row ?? null;
}

/**
 * UPDATE guardado por `version` (optimistic lock). Aplica `patch` + incrementa
 * version SOMENTE se a version no banco ainda for `expectedVersion`. Retorna a nova
 * linha (ou null se perdeu a corrida — outra aba avançou).
 */
export async function guardedUpdateInvite(
  id: string,
  expectedVersion: number,
  patch: Partial<ClinicInviteRow>,
): Promise<ClinicInviteRow | null> {
  const [row] = await dbAdmin
    .update(clinicInvites)
    .set({ ...patch, version: expectedVersion + 1 } as never)
    .where(and(eq(clinicInvites.id, id), eq(clinicInvites.version, expectedVersion)))
    .returning();
  return row ?? null;
}

/**
 * Cancela o convite (override do admin) por id — qualquer estado MENOS `completed`
 * (esse já virou clínica). NÃO é guardado por `version`: cancelar é uma decisão do
 * admin que deve valer independentemente de o convite ter sido aberto/avançado
 * (senão a version derivada da abertura faria o cancelamento falhar). Roda DENTRO
 * da tx do superAdminAction (atômico com a auditoria).
 */
export async function cancelInviteTx(tx: Tx, id: string): Promise<boolean> {
  const [row] = await tx
    .update(clinicInvites)
    .set({ status: 'cancelled', version: sql`${clinicInvites.version} + 1` })
    .where(and(eq(clinicInvites.id, id), ne(clinicInvites.status, 'completed')))
    .returning({ id: clinicInvites.id });
  return row != null;
}

/**
 * Código da campanha de lançamento. Quem entra pelo LINK de onboarding paga o
 * preço de fundador; a futura criação de conta pela landing page resolverá o
 * preço de tabela simplesmente não pedindo campanha nenhuma.
 */
export const FOUNDER_CAMPAIGN = 'fundador';

/**
 * Decide o par (cobrado, riscado) exibido no wizard.
 *
 * Puro de propósito: a regra é de COMUNICAÇÃO, não de banco. Exibir um "de" que
 * nunca foi praticado é propaganda enganosa pelo CDC, então o riscado só existe
 * quando há preço de tabela efetivamente diferente do cobrado.
 */
export function resolveDisplayPrice(
  listPriceCents: number | null,
  founderPriceCents: number | null,
): { priceCents: number | null; listPriceCents: number | null } {
  const charged = founderPriceCents ?? listPriceCents;
  const strike =
    founderPriceCents != null && listPriceCents != null && listPriceCents !== founderPriceCents
      ? listPriceCents
      : null;
  return { priceCents: charged, listPriceCents: strike };
}

export interface OnboardingPlan {
  id: string;
  code: string;
  name: string;
  /** O que a clínica de fato paga (preço de fundador, quando existe). */
  priceCents: number | null;
  /** Preço de tabela, para exibir riscado. `null` quando não há desconto. */
  listPriceCents: number | null;
  cycle: string;
}

/**
 * Plano oferecido pelo convite do fundador: a tabela antiga, que é a que tem
 * preço de fundador. A oferta por profissional (ADR-067) é vendida no cadastro
 * autônomo, com seletor de profissionais que este wizard não tem; levá-la ao
 * convite (e decidir se ganha desconto de fundador) é decisão comercial aberta.
 */
export function invitePlanCondition() {
  return and(eq(plans.ativo, true), notInArray(plans.code, [...OFFER_2026_PLAN_CODES]));
}

/**
 * Catálogo de planos para o wizard público (preço mensal vigente). Visitante é
 * não-autenticado → leitura via dbAdmin (RLS não aplica sem sessão).
 */
export async function listOnboardingPlans(): Promise<OnboardingPlan[]> {
  const listPrice = alias(prices, 'list_price');
  const founderPrice = alias(prices, 'founder_price');
  const rows = await dbAdmin
    .select({
      id: plans.id,
      code: plans.code,
      name: plans.name,
      listAmount: listPrice.amount,
      founderAmount: founderPrice.amount,
      cycle: listPrice.billingCycle,
    })
    .from(plans)
    .leftJoin(
      listPrice,
      and(
        eq(listPrice.planId, plans.id),
        eq(listPrice.billingCycle, 'monthly'),
        isNull(listPrice.activeUntil),
        isNull(listPrice.campaignCode),
      ),
    )
    .leftJoin(
      founderPrice,
      and(
        eq(founderPrice.planId, plans.id),
        eq(founderPrice.billingCycle, 'monthly'),
        isNull(founderPrice.activeUntil),
        eq(founderPrice.campaignCode, FOUNDER_CAMPAIGN),
      ),
    )
    .where(invitePlanCondition())
    .orderBy(asc(plans.name));

  return rows.map((r) => {
    const cents = (v: string | null) => (v != null ? Math.round(Number(v) * 100) : null);
    const list = cents(r.listAmount);
    const founder = cents(r.founderAmount);
    // Sem linha de campanha o plano cai no preço de tabela e não há riscado —
    // o wizard não pode inventar um "de" que nunca foi praticado.
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      ...resolveDisplayPrice(list, founder),
      cycle: r.cycle ?? 'monthly',
    };
  });
}

export interface CheckoutPlan {
  planId: string;
  code: string;
  priceId: string;
  amountReais: number;
  cycle: string;
}

/**
 * Resolve plano + preço VIGENTE no servidor (o front só manda `planId`; o valor
 * NUNCA vem do cliente — G6). Preço mensal ativo. Null se plano inativo/sem preço.
 */
export async function resolveCheckoutPlan(planId: string): Promise<CheckoutPlan | null> {
  const [row] = await dbAdmin
    .select({
      planId: plans.id,
      code: plans.code,
      priceId: prices.id,
      amount: prices.amount,
      cycle: prices.billingCycle,
    })
    .from(plans)
    .innerJoin(
      prices,
      and(
        eq(prices.planId, plans.id),
        eq(prices.billingCycle, 'monthly'),
        isNull(prices.activeUntil),
      ),
    )
    .where(and(eq(plans.id, planId), invitePlanCondition()))
    // Preço de fundador primeiro: quem chega por convite paga o promocional. O
    // `limit(1)` sozinho seria não-determinístico com duas linhas vigentes.
    .orderBy(sql`case when ${prices.campaignCode} = ${FOUNDER_CAMPAIGN} then 0 else 1 end`)
    .limit(1);
  if (!row) return null;
  return {
    planId: row.planId,
    code: row.code,
    priceId: row.priceId,
    amountReais: Number(row.amount),
    cycle: row.cycle,
  };
}

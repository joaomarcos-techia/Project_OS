/**
 * Ajuste dos dados da Guia de Consulta antes da aprovação (D11, P4.6).
 *
 * Roda na transação de quem chama (a Server Action abre `withTenant` com a pessoa da sessão e
 * grava a auditoria na mesma transação). Regras:
 *  - só Guia de Consulta, só em edição (pendências ou pronta para conferência). Conferida:
 *    devolver para correção; aprovada: reabrir (nova revisão). O banco confere de novo (0161);
 *  - concorrência otimista pela `version` que a tela leu; a linha fica travada até o fim;
 *  - os códigos são conferidos na terminologia DA GUIA (tabelas 36, 52, 75, 76 e 77), vigentes
 *    na data do atendimento; a emissão roda o validador completo outra vez;
 *  - campo vazio = padrão da D11 (o ajuste sai); nada ajustado = coluna nula;
 *  - salvar o mesmo conteúdo não gera versão nova nem evento.
 */
import 'server-only';

import { and, eq } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { assertPremiumFeatureTx } from '@/lib/premium-access';

import { hiGuideItems, hiGuides } from '../schema-clinic';
import {
  checkConsultaOverrides,
  normalizeConsultaOverrides,
  type ConsultaCodeField,
  type ConsultaOverrideProblem,
  type ConsultaOverrides,
} from '../tiss/assembly/consulta-overrides';

import { CONSULTA_DOMAIN_TABLES, loadTerms } from './issuance-common';

export class ConsultaOverridesError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_found' | 'not_consulta' | 'not_editable' | 'conflict' | 'invalid',
    readonly problems: ConsultaOverrideProblem[] = [],
  ) {
    super(message);
    this.name = 'ConsultaOverridesError';
  }
}

const EDITABLE = new Set(['pending_data', 'ready_for_review']);

/** Comparação estável (a ordem das chaves do jsonb não importa). */
const same = (a: ConsultaOverrides | null, b: ConsultaOverrides | null): boolean => {
  const norm = (o: ConsultaOverrides | null) =>
    o
      ? JSON.stringify(Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.localeCompare(y))))
      : 'null';
  return norm(a) === norm(b);
};

export async function updateConsultaOverridesInTx(
  tx: Tx,
  args: {
    clinicId: string;
    guideId: string;
    version: number;
    input: Partial<Record<ConsultaCodeField | 'observacao', string | null | undefined>>;
  },
): Promise<{ version: number; overrides: ConsultaOverrides | null; changed: boolean }> {
  const { clinicId } = args;
  // D24: operação de Convênios só com assinatura paga e ativa.
  await assertPremiumFeatureTx(tx, clinicId, 'health_insurance');
  const [g] = await tx
    .select({
      guideType: hiGuides.guideType,
      status: hiGuides.status,
      version: hiGuides.version,
      terminologyVersion: hiGuides.terminologyVersion,
      consultaOverrides: hiGuides.consultaOverrides,
    })
    .from(hiGuides)
    .where(and(eq(hiGuides.clinicId, clinicId), eq(hiGuides.id, args.guideId)))
    .limit(1)
    .for('update');
  if (!g) throw new ConsultaOverridesError('Guia inexistente nesta clínica.', 'not_found');
  if (g.guideType !== 'consulta') {
    throw new ConsultaOverridesError('Estes dados são só da Guia de Consulta.', 'not_consulta');
  }
  if (!EDITABLE.has(g.status)) {
    throw new ConsultaOverridesError(
      'Esta guia já foi conferida e não aceita ajuste. Para mudar, use “Devolver para correção”: ela volta para edição e a próxima emissão sai como nova revisão.',
      'not_editable',
    );
  }
  if (g.version !== args.version) {
    throw new ConsultaOverridesError(
      'A guia mudou desde que a tela foi aberta. Atualize e tente de novo.',
      'conflict',
    );
  }

  const overrides = normalizeConsultaOverrides(args.input);
  if (same(overrides, g.consultaOverrides ?? null)) {
    return { version: g.version, overrides, changed: false };
  }
  if (overrides) {
    if (!g.terminologyVersion) {
      throw new ConsultaOverridesError(
        'A guia ainda não tem versão de terminologia: não dá para conferir os códigos.',
        'invalid',
      );
    }
    const [item] = await tx
      .select({ executedOn: hiGuideItems.executedOn })
      .from(hiGuideItems)
      .where(and(eq(hiGuideItems.clinicId, clinicId), eq(hiGuideItems.guideId, args.guideId)))
      .limit(1);
    const terminology = await loadTerms(tx, g.terminologyVersion, [], CONSULTA_DOMAIN_TABLES);
    const problems = checkConsultaOverrides(overrides, terminology, item?.executedOn ?? null);
    if (problems.length > 0) {
      throw new ConsultaOverridesError(problems[0]!.message, 'invalid', problems);
    }
  }

  const [row] = await tx
    .update(hiGuides)
    .set({ consultaOverrides: overrides })
    .where(
      and(
        eq(hiGuides.clinicId, clinicId),
        eq(hiGuides.id, args.guideId),
        eq(hiGuides.version, args.version),
      ),
    )
    .returning({ version: hiGuides.version });
  if (!row) {
    throw new ConsultaOverridesError(
      'A guia mudou desde que a tela foi aberta. Atualize e tente de novo.',
      'conflict',
    );
  }
  return { version: row.version, overrides, changed: true };
}

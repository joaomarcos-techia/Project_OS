import 'server-only';

import { sql } from 'drizzle-orm';

import { billingApiV1 } from '@/contexts/billing';
import { requireClinicId } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';

import {
  channelStatus,
  subscriptionStatus,
  type SettingsStatus,
  type SubscriptionBillingStatus,
} from './settings-status';
import { getClinicWhatsappStatus } from './whatsapp/data';

/**
 * Status do canal para o card de WhatsApp.
 *
 * Leitura de banco, sem sondagem externa: a verificação do canal na Meta
 * (META-001) custa GETs no Graph e continua sendo responsabilidade da tela de
 * detalhe, que é onde o operador vai agir sobre o resultado.
 *
 * Falha não derruba a categoria — sem status o card simplesmente não mostra
 * selo. Uma indisponibilidade de banco não pode esconder as outras
 * configurações da aba.
 */
export async function loadChannelStatuses(): Promise<{
  statuses: Record<string, SettingsStatus>;
  metas: Record<string, string>;
}> {
  try {
    const clinicId = await requireClinicId();
    const status = await getClinicWhatsappStatus(clinicId);
    return {
      statuses: { '/configuracoes/whatsapp': channelStatus(status) },
      // O número JÁ vinha mascarado no status e não era mostrado. É o que
      // identifica o canal: "Conectado" sozinho não diz conectado a QUAL número,
      // e clínica que trocou de número precisa exatamente dessa conferência.
      metas: status.phoneNumberMasked
        ? { '/configuracoes/whatsapp': status.phoneNumberMasked }
        : {},
    };
  } catch (error) {
    console.error('[configuracoes] status do canal indisponível:', error);
    return { statuses: {}, metas: {} };
  }
}

/**
 * Status dos cards da categoria Gestão. Hoje só a Assinatura reporta estado — a
 * situação de cobrança do Qoro (`subscriptions.billing_status`, C13). Clínica
 * sem assinatura provisionada devolve `null` do mapeamento e o card fica sem
 * selo; nenhuma falha aqui pode esconder Equipe e Financeiro da aba.
 */
export async function loadGestaoStatuses(): Promise<Record<string, SettingsStatus>> {
  try {
    const clinicId = await requireClinicId();
    const subscription = await billingApiV1.getSubscription(clinicId);
    const status = subscriptionStatus(
      (subscription?.billingStatus as SubscriptionBillingStatus) ?? null,
    );
    return status ? { '/configuracoes/assinatura': status } : {};
  } catch (error) {
    console.error('[configuracoes] status da assinatura indisponível:', error);
    return {};
  }
}

/**
 * O meta de cada linha do índice — o número que a referência põe à direita.
 *
 * É ele que separa uma LISTA de um MENU: "Procedimentos" sozinho só diz que a
 * tela existe; "38 ativos · 4 inativos" diz se vale abrir. Sem isso o operador
 * precisa entrar em cada uma para descobrir onde está o que ele procura.
 *
 * Tudo numa consulta só, por subselect: são contagens pequenas e independentes,
 * e uma ida ao banco por linha transformaria o índice em oito round-trips. Falha
 * devolve `{}` — a lista continua navegável sem os números, que é degradar, não
 * quebrar.
 */
export async function loadSettingsMetas(): Promise<Record<string, string>> {
  try {
    const clinicId = await requireClinicId();
    const [row] = (await withTenant(clinicId, (tx) =>
      tx.execute(sql`
        SELECT
          (SELECT count(*) FROM procedures
            WHERE clinic_id = ${clinicId}::uuid AND ativo)::int AS proc_ativos,
          (SELECT count(*) FROM procedures
            WHERE clinic_id = ${clinicId}::uuid AND NOT ativo)::int AS proc_inativos,
          (SELECT count(*) FROM schedulable_resources
            WHERE clinic_id = ${clinicId}::uuid AND active AND type = 'room')::int AS salas,
          (SELECT count(*) FROM schedulable_resources
            WHERE clinic_id = ${clinicId}::uuid AND active AND type <> 'room')::int AS equipamentos,
          (SELECT count(DISTINCT doctor_id) FROM doctor_availability
            WHERE clinic_id = ${clinicId}::uuid)::int AS profissionais,
          (SELECT count(DISTINCT weekday) FROM doctor_availability
            WHERE clinic_id = ${clinicId}::uuid)::int AS dias,
          (SELECT count(*) FROM lgpd_requests
            WHERE clinic_id = ${clinicId}::uuid
              AND status IN ('pending', 'processing'))::int AS lgpd_abertas,
          (SELECT max_days_ahead FROM ai_clinic_config
            WHERE clinic_id = ${clinicId}::uuid) AS agenda_dias
      `),
    )) as unknown as Array<{
      proc_ativos: number;
      proc_inativos: number;
      salas: number;
      equipamentos: number;
      profissionais: number;
      dias: number;
      lgpd_abertas: number;
      agenda_dias: number | null;
    }>;
    if (!row) return {};

    const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;
    const metas: Record<string, string> = {};

    if (row.profissionais > 0) {
      metas['/configuracoes/horarios'] =
        `${plural(row.profissionais, 'profissional', 'profissionais')} · ${plural(row.dias, 'dia', 'dias')}`;
    }
    if (row.proc_ativos + row.proc_inativos > 0) {
      // Inativos só entram quando existem: "0 inativos" é ruído em toda clínica
      // que nunca desativou um procedimento, que é a maioria.
      metas['/configuracoes/procedimentos'] =
        row.proc_inativos > 0
          ? `${row.proc_ativos} ativos · ${row.proc_inativos} inativos`
          : plural(row.proc_ativos, 'ativo', 'ativos');
    }
    if (row.salas + row.equipamentos > 0) {
      metas['/configuracoes/recursos'] =
        `${plural(row.salas, 'sala', 'salas')} · ${plural(row.equipamentos, 'equipamento', 'equipamentos')}`;
    }
    if (row.lgpd_abertas > 0) {
      metas['/configuracoes/lgpd'] = plural(row.lgpd_abertas, 'aberta', 'abertas');
    }
    if (row.agenda_dias != null) {
      metas['/configuracoes/agente'] = `agenda até ${plural(row.agenda_dias, 'dia', 'dias')}`;
    }
    return metas;
  } catch (error) {
    console.error('[configuracoes] contagens do índice indisponíveis:', error);
    return {};
  }
}

import {
  Banknote,
  Calendar,
  CircleDot,
  FileText,
  ListChecks,
  PenLine,
  ShieldCheck,
  Truck,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import type { AuditActivity } from '@/lib/audit/recent';

import styles from '../dashboard.module.css';

/**
 * Terceira pessoa do pretérito — a referência escreve o feed como FRASE, com
 * quem agiu no começo: "Dra. Ana Moraes assinou o prontuário". A forma anterior
 * ("Prontuário assinado", ator numa segunda linha) enterrava justamente o dado
 * que faz alguém olhar um log de auditoria, que é quem mexeu.
 */
const ACT_VERBS: Record<string, string> = {
  created: 'criou',
  updated: 'atualizou',
  paid: 'pagou',
  cancelled: 'cancelou',
  estornado: 'estornou',
  refunded: 'estornou',
  removed: 'removeu',
  set: 'definiu',
  deactivated: 'desativou',
  signed: 'assinou',
  completed: 'concluiu',
  deleted: 'excluiu',
  exported: 'exportou',
  ativo: 'atualizou',
  generated: 'gerou',
  finalized: 'finalizou',
  sent: 'enviou',
  revoked: 'revogou',
  restored: 'restaurou',
  archived: 'arquivou',
  started: 'iniciou',
  invited: 'convidou',
  imported: 'importou',
  scheduled: 'agendou',
  rescheduled: 'remarcou',
  confirmed: 'confirmou',
  viewed: 'abriu',
  corrected: 'corrigiu',
};

/** Eventos em que "verbo + o atendimento" não faz sentido: a frase vem pronta. */
const ACT_PHRASES: Record<string, string> = {
  checked_in: 'registrou a chegada do paciente',
  no_show: 'registrou a falta do paciente',
};

const ACT_FALLBACK = 'registrou uma ação no sistema';

/** `artigo` evita "assinou prontuário"; `icon` é o glifo da referência. */
const ACT_ENTITIES: Record<string, { label: string; artigo: 'o' | 'a'; icon: LucideIcon }> = {
  supplier: { label: 'fornecedor', artigo: 'o', icon: Truck },
  lancamento: { label: 'lançamento', artigo: 'o', icon: Banknote },
  procedure: { label: 'procedimento', artigo: 'o', icon: ListChecks },
  prontuario: { label: 'prontuário', artigo: 'o', icon: PenLine },
  appointment: { label: 'atendimento', artigo: 'o', icon: Calendar },
  patient: { label: 'paciente', artigo: 'o', icon: UserRound },
  doctor_availability: { label: 'disponibilidade', artigo: 'a', icon: Calendar },
  clinic_holiday: { label: 'feriado', artigo: 'o', icon: Calendar },
  prescription: { label: 'prescrição', artigo: 'a', icon: FileText },
  document: { label: 'documento', artigo: 'o', icon: FileText },
  financial: { label: 'financeiro', artigo: 'o', icon: Banknote },
  profile: { label: 'acesso', artigo: 'o', icon: ShieldCheck },
  invite: { label: 'convite', artigo: 'o', icon: ShieldCheck },
};

function describe(action: string): { frase: string; Icon: LucideIcon } {
  const segs = action.split('.');
  const last = segs[segs.length - 1] ?? action;
  let entity: (typeof ACT_ENTITIES)[string] | undefined;
  for (let i = segs.length - 2; i >= 0; i--) {
    const e = ACT_ENTITIES[segs[i]!];
    if (e) {
      entity = e;
      break;
    }
  }
  const Icon = entity?.icon ?? CircleDot;

  const pronta = ACT_PHRASES[last];
  if (pronta) return { frase: pronta, Icon };

  // Sem tradução conhecida, uma frase genérica e verdadeira: o token do audit
  // continua no `title` da linha para quem precisa rastrear o evento.
  const verbo = ACT_VERBS[last];
  if (!verbo || !entity) return { frase: ACT_FALLBACK, Icon };
  return { frase: `${verbo} ${entity.artigo} ${entity.label}`, Icon };
}

/**
 * Hora do relógio, não "há 18 h". A referência escreve 13:12 porque o feed é do
 * TURNO: o operador cruza com o que lembra do próprio dia, e "há 18 h" o obriga
 * a fazer a subtração de cabeça. Fora de hoje, a data assume. Sempre no fuso da
 * clínica: o componente roda no servidor, que está em UTC.
 */
function horaOuData(iso: string, tz: string): string {
  const quando = new Date(iso);
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  const mesmoDia = dia.format(new Date()) === dia.format(quando);
  return quando.toLocaleString('pt-BR', {
    timeZone: tz,
    hourCycle: 'h23',
    ...(mesmoDia ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit' }),
  });
}

/**
 * Feed de atividade (audit) — 5 mais recentes, data sem quebra.
 * Linha do app v5: ícone num quadrado de 28 px, a frase com o ator em negrito
 * e a hora do relógio à direita.
 */
export function ActivityFeed({
  activity,
  actorNames,
  tz,
}: {
  activity: AuditActivity[];
  actorNames: Map<string, string>;
  tz: string;
}) {
  return (
    <ul className={styles.list}>
      {activity.slice(0, 5).map((a) => {
        const who = a.userId ? (actorNames.get(a.userId) ?? 'Sistema') : 'Sistema';
        const { frase, Icon } = describe(a.action);
        return (
          <li key={a.id} className={styles.actRow}>
            <span aria-hidden="true" className={styles.actIcon}>
              <Icon />
            </span>
            <span className={styles.actText} title={a.action}>
              <b>{who}</b> {frase}
            </span>
            <span className={styles.actTime}>{horaOuData(a.createdAt, tz)}</span>
          </li>
        );
      })}
    </ul>
  );
}

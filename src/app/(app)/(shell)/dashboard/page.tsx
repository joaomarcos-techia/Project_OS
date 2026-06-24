import Link from 'next/link';

import { getProfileNames } from '@/contexts/identity/queries';
import { clinicDayBounds } from '@/contexts/financial/logic';
import { getCashFlowToday, getClinicTimezone, listCashFlowDaily } from '@/contexts/financial/queries';
import type { AppointmentStatusDTO } from '@/contexts/scheduling/types';
import { Icon } from '@/components/painel/icons';
import { getRecentActivity, type AuditActivity } from '@/lib/audit/recent';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { formatBRL } from '@/lib/format';

import { getActivationChecklist, getDashboard, type ActivationChecklistDTO } from './data';

export const dynamic = 'force-dynamic';

/* ---- stat tile (porte de helpers.stat) ---- */
function Stat({
  label,
  value,
  hint,
  ico,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  ico: string;
  tone?: 'amber' | 'teal' | 'green' | 'red';
}) {
  return (
    <div className="stat-tile">
      <div className="st-top">
        <span className="st-l">{label}</span>
        <span className={`st-ico${tone ? ` ${tone}` : ''}`}>
          <Icon name={ico} size={16} />
        </span>
      </div>
      <div className="st-v">{value}</div>
      {hint ? <div className="st-d">{hint}</div> : null}
    </div>
  );
}

/* ---- checklist de ativação (Fase 2) — some quando os passos estão concluídos ---- */
function ActivationChecklist({ data }: { data: ActivationChecklistDTO }) {
  if (data.complete) return null;
  return (
    <div
      className="panel"
      style={{
        marginBottom: 'var(--sp-4)',
        borderColor: 'color-mix(in oklch, var(--primary-500) 35%, var(--border))',
        background: 'color-mix(in oklch, var(--primary-500) 4%, var(--surface))',
      }}
    >
      <h4>
        Primeiros passos
        <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {data.done}/{data.total} concluídos
        </span>
      </h4>
      <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '2px 0 var(--sp-3)' }}>
        Falta pouco para sua clínica funcionar 100%.
      </p>
      <div className="mini-list">
        {data.items.map((it) => (
          <Link
            key={it.key}
            href={it.href}
            className="mini-row"
            style={{ opacity: it.done ? 0.55 : 1, alignItems: 'center', gap: 12 }}
          >
            <span
              aria-hidden
              style={{
                width: 22,
                height: 22,
                flex: '0 0 22px',
                borderRadius: 999,
                display: 'grid',
                placeItems: 'center',
                fontSize: 13,
                fontWeight: 700,
                background: it.done ? 'var(--success-500)' : 'transparent',
                color: it.done ? '#fff' : 'var(--text-3)',
                border: it.done ? 'none' : '1.5px solid var(--border-strong)',
              }}
            >
              {it.done ? '✓' : ''}
            </span>
            <span className="mr-name" style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 500, textDecoration: it.done ? 'line-through' : 'none' }}>{it.label}</span>
              <span className="td-sub" style={{ display: 'block' }}>{it.desc}</span>
            </span>
            {!it.done ? <span style={{ color: 'var(--text-3)', fontSize: 18 }}>›</span> : null}
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ---- "em breve" dentro de um painel (feature ainda não desenvolvida) ---- */
function SoonInner({ ico, note }: { ico: string; note: string }) {
  return (
    <div className="empty" style={{ padding: 'var(--sp-8) var(--sp-4)' }}>
      <span className="em-ico">
        <Icon name={ico} size={22} />
      </span>
      <b>Em breve</b>
      <p>{note}</p>
    </div>
  );
}

const STATUS: Record<AppointmentStatusDTO, { tone: string; label: string }> = {
  agendado: { tone: 'blue', label: 'Agendado' },
  confirmado: { tone: 'teal', label: 'Confirmado' },
  chegou: { tone: 'amber', label: 'Chegou' },
  em_atendimento: { tone: 'violet', label: 'Em atendimento' },
  atendido: { tone: 'green', label: 'Atendido' },
  cancelado: { tone: 'gray', label: 'Cancelado' },
  faltou: { tone: 'red', label: 'Faltou' },
};

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/* ---- gráfico de faturamento (últimos 7 dias) ---- */
function ymd(tz: string, offsetDays: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(Date.now() + offsetDays * 86_400_000));
}

function weekdayLabel(date: string): string {
  return new Date(`${date}T12:00:00`)
    .toLocaleDateString('pt-BR', { weekday: 'short' })
    .replace('.', '')
    .slice(0, 3);
}

/* ---- atividade recente (audit) ---- */
const ACT_VERBS: Record<string, string> = {
  created: 'criado',
  updated: 'atualizado',
  paid: 'pago',
  cancelled: 'cancelado',
  estornado: 'estornado',
  removed: 'removido',
  set: 'definido',
  deactivated: 'desativado',
  signed: 'assinado',
  completed: 'concluído',
  deleted: 'excluído',
  exported: 'exportado',
  ativo: 'atualizado',
};
const ACT_ENTITIES: Record<string, string> = {
  supplier: 'Fornecedor',
  lancamento: 'Lançamento',
  procedure: 'Procedimento',
  prontuario: 'Prontuário',
  appointment: 'Atendimento',
  patient: 'Paciente',
  doctor_availability: 'Disponibilidade',
  clinic_holiday: 'Feriado',
  prescription: 'Prescrição',
  document: 'Documento',
  financial: 'Financeiro',
};

function humanizeAction(action: string): string {
  const segs = action.split('.');
  const last = segs[segs.length - 1] ?? action;
  const verb = ACT_VERBS[last] ?? last;
  let entity: string | undefined;
  for (let i = segs.length - 2; i >= 0; i--) {
    const e = ACT_ENTITIES[segs[i]!];
    if (e) {
      entity = e;
      break;
    }
  }
  entity ??= (segs[0] ?? '').replace(/_/g, ' ');
  return `${entity} ${verb}`.trim();
}

function relTime(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dd = Math.floor(h / 24);
  if (dd === 1) return 'ontem';
  if (dd < 7) return `há ${dd} d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export default async function DashboardPage() {
  const d = await getDashboard();

  if (!d.hasClinic) {
    return (
      <div className="screen">
        <div className="page-head">
          <h1 className="ph-title">Visão operacional</h1>
          <p className="ph-desc">Selecione uma clínica para ver o painel operacional.</p>
        </div>
      </div>
    );
  }

  const user = await requireUser();
  const clinicId = await requireClinicId();
  const checklist = await getActivationChecklist(clinicId);
  const tz = await getClinicTimezone(clinicId);
  const { from, to } = clinicDayBounds(tz);
  const flow = await getCashFlowToday(clinicId, from, to);

  // Gráfico: faturamento (recebido) dos últimos 7 dias. Histórico vem do
  // consolidado diário (cash_flow_daily); "hoje" usa o valor ao vivo (o rollup
  // roda 1x/dia, então ainda não fechou o dia corrente).
  const dias = Array.from({ length: 7 }, (_, i) => ymd(tz, i - 6));
  const serie = await listCashFlowDaily(clinicId, dias[0]!, ymd(tz, 1));
  const recByDate = new Map(serie.map((s) => [s.date, s.totalRecebido]));
  const chart = dias.map((date, i) => ({
    date,
    label: weekdayLabel(date),
    recebido: i === dias.length - 1 ? flow.recebidoHoje : (recByDate.get(date) ?? 0),
  }));
  const chartMax = Math.max(1, ...chart.map((c) => c.recebido));
  const chartTotal = chart.reduce((s, c) => s + c.recebido, 0);

  // Atividade recente (audit) — feed sensível, gateado em view:audit (gestor/owner).
  const canAudit = user.permissions.includes(PERMISSIONS.VIEW_AUDIT);
  const activity: AuditActivity[] = canAudit ? await getRecentActivity(clinicId, 7) : [];
  const actorNames = canAudit
    ? await getProfileNames(
        clinicId,
        activity.map((a) => a.userId ?? '').filter(Boolean),
      )
    : new Map<string, string>();

  const hoje = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());

  return (
    <div className="screen">
      <div className="page-head">
        <div className="ph-crumb">
          Clínica Vida <span className="sep">›</span> <b>Dashboard</b> <span className="sep">›</span> Hoje · {hoje}
        </div>
        <div className="ph-title-row">
          <div>
            <h1 className="ph-title">Visão operacional</h1>
            <p className="ph-desc">
              O pulso da clínica em tempo real — agenda, atendimento, caixa e inteligência num só lugar.
            </p>
          </div>
          <div className="ph-actions">
            <div className="seg">
              <button className="on">Hoje</button>
              <button>Semana</button>
            </div>
            <Link href="/dashboard" className="btn sm secondary">
              <Icon name="refresh" size={15} />
              Atualizar
            </Link>
          </div>
        </div>
      </div>

      <ActivationChecklist data={checklist} />

      {/* ---- stat tiles (dados reais) ---- */}
      <div className="stat-row five">
        <Stat label="Consultas hoje" value={String(d.consultasHoje)} hint={`${d.finalizadas} finalizadas`} ico="calendar" />
        <Stat label="Aguardando" value={String(d.aguardando)} hint="na sala de espera" ico="clock" tone="amber" />
        <Stat label="Em atendimento" value={String(d.emAtendimento)} hint="agora" ico="stethoscope" tone="teal" />
        <Stat label="Recebimentos pendentes" value={formatBRL(flow.receber)} hint="a receber em aberto" ico="wallet" tone="red" />
        <Stat label="Faturado hoje" value={formatBRL(flow.recebidoHoje)} hint="recebido hoje" ico="cash" tone="green" />
      </div>

      <div className="cols-3-2" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="stack">
          <div className="panel">
            <h4>
              Faturamento · últimos 7 dias{' '}
              <Link href="/financeiro">Financeiro</Link>
            </h4>
            {chartTotal === 0 ? (
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--text-3)',
                  padding: 'var(--sp-6) 0',
                  textAlign: 'center',
                }}
              >
                Sem recebimentos registrados no período.
              </p>
            ) : (
              <div className="chart">
                <div className="bars">
                  {chart.map((c) => (
                    <div
                      className="bar-col"
                      key={c.date}
                      title={`${c.label}: ${formatBRL(c.recebido)}`}
                    >
                      <div
                        className="bar-v"
                        style={{ height: `${Math.round((c.recebido / chartMax) * 100)}%` }}
                      />
                      <span className="bar-l">{c.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="cols-2">
            <div className="panel">
              <h4>
                Próximos na agenda <Link href="/consultorio">Ver consultório</Link>
              </h4>
              {d.proximos.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-3)', padding: '8px 0' }}>Nada para hoje.</p>
              ) : (
                <div className="mini-list">
                  {d.proximos.map((p) => {
                    const s = STATUS[p.status];
                    return (
                      <div className="mini-row" key={p.appointmentId}>
                        <span className="mr-time">{hora(p.horario)}</span>
                        <span className="mr-name" style={{ flex: 1 }}>
                          {p.nome}
                        </span>
                        <span className={`badge ${s.tone}`}>
                          <span className="bdot" />
                          {s.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="panel">
              <h4>Ocupação por profissional</h4>
              <SoonInner ico="users" note="Ocupação por médico chega com a Agenda." />
            </div>
          </div>
        </div>

        <div className="stack">
          <div
            className="panel"
            style={{ borderColor: 'color-mix(in oklch, var(--accent-500) 30%, var(--border))' }}
          >
            <h4>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="ai" size={15} /> Alertas da IA
              </span>
              <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>em breve</span>
            </h4>
            <SoonInner ico="ai" note="Alertas (no-show, cobrança ausente, retorno vencido) chegam com o Agente de IA." />
          </div>

          <div className="panel">
            <h4>Atividade recente</h4>
            {!canAudit ? (
              <p style={{ fontSize: 13, color: 'var(--text-3)', padding: '8px 0' }}>
                A trilha de atividade fica disponível para gestores.
              </p>
            ) : activity.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-3)', padding: '8px 0' }}>
                Nenhuma atividade registrada ainda.
              </p>
            ) : (
              <div className="mini-list">
                {activity.map((a) => {
                  const who = a.userId ? (actorNames.get(a.userId) ?? 'Sistema') : 'Sistema';
                  return (
                    <div className="mini-row" key={a.id}>
                      <span className="mr-name" style={{ flex: 1, minWidth: 0 }}>
                        {humanizeAction(a.action)}
                        <span className="td-sub" style={{ marginLeft: 6 }}>
                          {who}
                        </span>
                      </span>
                      <span className="mr-time">{relTime(a.createdAt)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

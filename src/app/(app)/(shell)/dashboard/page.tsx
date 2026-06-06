import Link from 'next/link';

import { clinicDayBounds } from '@/contexts/financial/logic';
import { getCashFlowToday, getClinicTimezone } from '@/contexts/financial/queries';
import type { AppointmentStatusDTO } from '@/contexts/scheduling/types';
import { Icon } from '@/components/painel/icons';
import { requireClinicId } from '@/lib/auth/tenant-context';
import { formatBRL } from '@/lib/format';

import { getDashboard } from './data';

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

  const clinicId = await requireClinicId();
  const tz = await getClinicTimezone(clinicId);
  const { from, to } = clinicDayBounds(tz);
  const flow = await getCashFlowToday(clinicId, from, to);

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
            <SoonInner ico="chart" note="O gráfico de faturamento chega com o consolidado diário do Financeiro." />
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
            <SoonInner ico="history" note="O feed de atividade da clínica chega em breve." />
          </div>
        </div>
      </div>
    </div>
  );
}

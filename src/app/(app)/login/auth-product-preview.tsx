/**
 * Ilustração do painel de marca do login, na paleta e nas fontes do app v5.
 *
 * É uma FIGURA do produto, não chrome do produto: fica sobre o gradiente escuro
 * do aside e precisa ler como o app no tema claro em qualquer tema do usuário.
 * Por isso os valores são literais (os mesmos do design) em vez de tokens
 * — um `bg-surface` aqui escureceria junto com o tema e quebraria a figura.
 *
 * Dados sintéticos: nenhum paciente real aparece na tela pública (LGPD).
 */

const INK = '#0A0C25';
const BODY = '#33333B';
const MUTED = '#5C5C66';
const FAINT = '#6E6E79';
const RULE = '#ECEEF4';
const HAIRLINE = '#E3E5EE';
const BORDER = '#E3E5EE';
const PRIMARY = '#1A1ED5';
const PRIMARY_SOFT = '#EEEFFF';
const PRIMARY_DEEP = '#1A1ED5';
const CHIP = '#F4F5F9';

const SANS = 'var(--font-inter), ui-sans-serif, system-ui, sans-serif';
const DISPLAY = 'var(--font-manrope), ui-sans-serif, system-ui, sans-serif';
// Números em Inter, como no app: o v5 não usa fonte monoespaçada.
const MONO = SANS;

const ROW_GRID = '64px minmax(0,1fr) 96px 88px';

type Consulta = { hora: string; paciente: string; sala: string; status: string; ativo?: boolean };

const CONSULTAS: Consulta[] = [
  { hora: '14:00', paciente: 'Helena Vasques', sala: 'Sala 2', status: 'Em sala', ativo: true },
  { hora: '14:30', paciente: 'Ana Ribeiro', sala: 'Sala 1', status: 'Aguardando' },
  { hora: '15:00', paciente: 'Paulo Menezes', sala: 'Sala 3', status: 'Confirmado' },
  { hora: '15:20', paciente: 'Célia Braga', sala: 'Sala 2', status: 'Confirmado' },
  { hora: '15:40', paciente: 'Rogério Lins', sala: 'Sala 1', status: 'Confirmado' },
  { hora: '16:00', paciente: 'Marina Duarte', sala: 'Sala 3', status: 'Confirmado' },
  { hora: '16:20', paciente: 'Tiago Ferraz', sala: 'Sala 2', status: 'Confirmado' },
  { hora: '16:40', paciente: 'Sofia Andrade', sala: 'Sala 1', status: 'Confirmado' },
  { hora: '17:00', paciente: 'Bruno Tavares', sala: 'Sala 3', status: 'Confirmado' },
  { hora: '17:20', paciente: 'Letícia Prado', sala: 'Sala 2', status: 'Confirmado' },
];

const ORIGENS = [
  { rotulo: 'Convênio', valor: '248', cor: PRIMARY },
  { rotulo: 'Particular', valor: '121', cor: '#8A8DF0' },
  { rotulo: 'Retorno', valor: '43', cor: '#D6D8FA' },
];

export function AuthProductPreview() {
  return (
    <div aria-hidden="true" className="relative min-h-0 flex-1" style={{ marginTop: 40 }}>
      {/* ---------------------------- Dashboard ---------------------------- */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 660,
          borderRadius: 16,
          background: '#F6F7FB',
          boxShadow: '0 34px 80px -24px rgb(10 12 37 / .55)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 16px',
            background: '#fff',
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <span
            style={{
              font: `600 13.5px/1 ${DISPLAY}`,
              letterSpacing: '-.02em',
              color: INK,
              whiteSpace: 'nowrap',
            }}
          >
            Dashboard de hoje
          </span>
          <span
            style={{
              display: 'flex',
              gap: 14,
              font: `500 12px/1 ${SANS}`,
              color: MUTED,
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ color: PRIMARY_DEEP, fontWeight: 600 }}>Turno</span>
            <span>Agenda</span>
            <span>Caixa</span>
          </span>
          <span
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 9px',
              height: 24,
              borderRadius: 6,
              background: PRIMARY_SOFT,
              font: `600 11px/24px ${SANS}`,
              color: PRIMARY_DEEP,
              whiteSpace: 'nowrap',
            }}
          >
            Turno aberto
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
            padding: '14px 16px',
          }}
        >
          <div style={{ padding: '12px 14px', borderRadius: 12, background: PRIMARY }}>
            <div
              style={{
                font: `400 11px/1 ${SANS}`,
                color: '#D6D8FA',
                whiteSpace: 'nowrap',
              }}
            >
              Faturamento do dia
            </div>
            <div
              style={{
                marginTop: 9,
                font: `600 22px/1 ${MONO}`,
                color: '#fff',
                whiteSpace: 'nowrap',
              }}
            >
              R$ 18.420
            </div>
            <div
              style={{
                marginTop: 10,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '0 8px',
                height: 21,
                borderRadius: 6,
                background: '#3A3EE6',
                font: `600 10.5px/21px ${SANS}`,
                color: '#fff',
                whiteSpace: 'nowrap',
              }}
            >
              +12% vs ontem
            </div>
          </div>

          <div
            style={{
              padding: '12px 14px',
              border: `1px solid ${HAIRLINE}`,
              borderRadius: 12,
              background: '#fff',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span style={{ font: `400 11px/1 ${SANS}`, color: MUTED, whiteSpace: 'nowrap' }}>
                Tempo médio de sala
              </span>
              <span style={{ font: `500 10.5px/1 ${MONO}`, color: FAINT }}>hoje</span>
            </div>
            <div style={{ marginTop: 9, font: `600 21px/1 ${MONO}`, color: INK }}>00:41:20</div>
            <svg
              viewBox="0 0 200 48"
              preserveAspectRatio="none"
              style={{ marginTop: 10, display: 'block', width: '100%', height: 40 }}
            >
              <polyline
                points="0,40 25,32 50,36 75,20 100,26 125,11 150,19 175,7 200,15"
                fill="none"
                stroke={PRIMARY}
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        <div style={{ padding: '2px 16px 18px' }}>
          <div
            style={{
              border: `1px solid ${HAIRLINE}`,
              borderRadius: 12,
              background: '#fff',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '11px 14px',
                borderBottom: `1px solid ${RULE}`,
              }}
            >
              <span style={{ font: `600 12px/1 ${SANS}`, color: INK, whiteSpace: 'nowrap' }}>
                Atendimentos do turno
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  font: `500 11px/1 ${MONO}`,
                  color: FAINT,
                  whiteSpace: 'nowrap',
                }}
              >
                18 de 24
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: ROW_GRID,
                gap: 10,
                padding: '9px 14px',
                borderBottom: `1px solid ${RULE}`,
                font: `500 10.5px/1 ${SANS}`,
                color: FAINT,
                whiteSpace: 'nowrap',
              }}
            >
              <span>Horário</span>
              <span>Paciente</span>
              <span>Sala</span>
              <span>Status</span>
            </div>

            {CONSULTAS.map((consulta, indice) => (
              <div
                key={consulta.hora}
                style={{
                  display: 'grid',
                  gridTemplateColumns: ROW_GRID,
                  gap: 10,
                  padding: '10px 14px',
                  alignItems: 'center',
                  whiteSpace: 'nowrap',
                  borderTop: indice === 0 ? undefined : `1px solid ${RULE}`,
                }}
              >
                <span style={{ font: `500 11.5px/1 ${MONO}`, color: MUTED }}>{consulta.hora}</span>
                <span
                  style={{
                    font: `500 12px/1 ${SANS}`,
                    color: INK,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {consulta.paciente}
                </span>
                <span style={{ font: `400 11.5px/1 ${SANS}`, color: MUTED }}>{consulta.sala}</span>
                <span
                  style={{
                    justifySelf: 'start',
                    padding: '0 8px',
                    height: 20,
                    borderRadius: 6,
                    background: consulta.ativo ? PRIMARY_SOFT : CHIP,
                    font: `600 10.5px/20px ${SANS}`,
                    color: consulta.ativo ? PRIMARY_DEEP : BODY,
                  }}
                >
                  {consulta.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------ Origem (sobreposto) ----------------------- */}
      <div
        style={{
          position: 'absolute',
          right: 14,
          top: 196,
          width: 268,
          boxSizing: 'border-box',
          padding: 16,
          borderRadius: 12,
          background: '#fff',
          boxShadow: '0 30px 70px -20px rgb(10 12 37 / .6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: `600 12px/1 ${SANS}`, color: INK, whiteSpace: 'nowrap' }}>
            Origem dos atendimentos
          </span>
          <span style={{ marginLeft: 'auto', font: `500 10.5px/1 ${MONO}`, color: FAINT }}>
            mês
          </span>
        </div>

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}>
          <div style={{ position: 'relative', width: 172, height: 94 }}>
            <svg viewBox="0 0 120 66" style={{ display: 'block', width: 172, height: 94 }}>
              <path
                d="M10 60 A50 50 0 0 1 110 60"
                fill="none"
                stroke="#ECEEF4"
                strokeWidth="12"
                strokeLinecap="round"
              />
              <path
                d="M10 60 A50 50 0 0 1 110 60"
                fill="none"
                stroke={PRIMARY}
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray="110 200"
              />
            </svg>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 6,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span style={{ font: `400 10.5px/1 ${SANS}`, color: FAINT, whiteSpace: 'nowrap' }}>
                Total no mês
              </span>
              <span style={{ font: `600 19px/1 ${MONO}`, color: INK }}>412</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {ORIGENS.map((origem) => (
            <div
              key={origem.rotulo}
              style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
            >
              <span
                style={{ width: 7, height: 7, borderRadius: 999, background: origem.cor }}
              ></span>
              <span style={{ flex: 1, font: `400 11.5px/1 ${SANS}`, color: BODY }}>
                {origem.rotulo}
              </span>
              <span style={{ font: `500 11.5px/1 ${MONO}`, color: '#33333B' }}>{origem.valor}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

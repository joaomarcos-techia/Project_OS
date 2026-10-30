import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';

/** Linha do consolidado — espelho estrutural do DoctorConsolidadoDTO do app
 *  (lib não importa de app — boundaries). */
export interface RelatorioDoctorRow {
  doctorId: string;
  nome: string;
  total: number;
  atendidos: number;
  faltas: number;
  recebido: number | null;
}

/**
 * PDF de Relatórios (Fase B do plano pausa-almoço/export): KPIs do período +
 * consolidado por profissional. Sem branding de médico (documento gerencial,
 * não clínico) — cabeçalho é a clínica + período.
 */
const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#1a1a1a' },
  h1: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sub: { fontSize: 9, color: '#555', marginBottom: 18 },
  kpiRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  kpi: { flex: 1, border: '1 solid #ddd', borderRadius: 4, padding: 10 },
  kpiLabel: { fontSize: 7, color: '#666', textTransform: 'uppercase', marginBottom: 4 },
  kpiValue: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  kpiHint: { fontSize: 7, color: '#777', marginTop: 3 },
  th: {
    flexDirection: 'row',
    borderBottom: '1 solid #999',
    paddingBottom: 4,
    marginBottom: 2,
  },
  tr: { flexDirection: 'row', borderBottom: '0.5 solid #e0e0e0', paddingVertical: 4 },
  cName: { flex: 3, fontFamily: 'Helvetica-Bold' },
  cNum: { flex: 1, textAlign: 'right' },
  thText: { fontSize: 7, color: '#555', textTransform: 'uppercase' },
  note: { fontSize: 7, color: '#888', marginTop: 14 },
  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
});

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export interface RelatorioPdfInput {
  clinicName: string;
  periodLabel: string;
  fromLabel: string;
  toLabel: string;
  generatedAt: string;
  includeFaturamento: boolean;
  kpis: {
    faturamento: { recebido: number; pago: number; saldo: number } | null;
    noShow: { taxa: number | null; faltou: number; atendido: number; total: number };
    ocupacao: { taxa: number | null };
  };
  porProfissional: RelatorioDoctorRow[] | null;
}

export async function renderRelatorioPDF(input: RelatorioPdfInput): Promise<Buffer> {
  const { kpis } = input;
  return renderToBuffer(
    <Document title={`Relatórios — ${input.clinicName}`} producer="Qoro" creator="Qoro">
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Relatórios — {input.clinicName}</Text>
        <Text style={s.sub}>
          Período: {input.fromLabel} – {input.toLabel} ({input.periodLabel}) · gerado em{' '}
          {input.generatedAt}
        </Text>

        <View style={s.kpiRow}>
          {input.includeFaturamento && kpis.faturamento ? (
            <View style={s.kpi}>
              <Text style={s.kpiLabel}>Faturamento (recebido)</Text>
              <Text style={s.kpiValue}>{brl(kpis.faturamento.recebido)}</Text>
              <Text style={s.kpiHint}>
                Pago: {brl(kpis.faturamento.pago)} · Saldo: {brl(kpis.faturamento.saldo)}
              </Text>
            </View>
          ) : null}
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>No-show</Text>
            <Text style={s.kpiValue}>{pct(kpis.noShow.taxa)}</Text>
            <Text style={s.kpiHint}>
              {kpis.noShow.faltou} falta(s) · {kpis.noShow.atendido} atendido(s) ·{' '}
              {kpis.noShow.total} no período
            </Text>
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>Ocupação</Text>
            <Text style={s.kpiValue}>{pct(kpis.ocupacao.taxa)}</Text>
          </View>
        </View>

        {input.porProfissional !== null ? (
          <View>
            <Text style={s.sectionTitle}>Consolidado por profissional</Text>
            <View style={s.th}>
              <Text style={[s.cName, s.thText]}>Profissional</Text>
              <Text style={[s.cNum, s.thText]}>Atendimentos</Text>
              <Text style={[s.cNum, s.thText]}>Atendidos</Text>
              <Text style={[s.cNum, s.thText]}>Faltas</Text>
              {input.includeFaturamento ? <Text style={[s.cNum, s.thText]}>Recebido</Text> : null}
            </View>
            {input.porProfissional.length === 0 ? (
              <Text style={s.note}>Sem atendimentos no período.</Text>
            ) : (
              input.porProfissional.map((d) => (
                <View key={d.doctorId} style={s.tr} wrap={false}>
                  <Text style={s.cName}>{d.nome}</Text>
                  <Text style={s.cNum}>{d.total}</Text>
                  <Text style={s.cNum}>{d.atendidos}</Text>
                  <Text style={s.cNum}>{d.faltas}</Text>
                  {input.includeFaturamento ? (
                    <Text style={s.cNum}>{d.recebido != null ? brl(d.recebido) : '—'}</Text>
                  ) : null}
                </View>
              ))
            )}
          </View>
        ) : null}

        <Text style={s.note}>
          Ocupação usa o resolvedor de agenda canônico (respeita pausas e feriados). Gerado pelo
          Qoro.
        </Text>
      </Page>
    </Document>,
  );
}

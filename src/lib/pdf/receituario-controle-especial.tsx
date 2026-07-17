/**
 * Receituário de Controle Especial (branco, 2 vias) — Portaria SVS/MS 344/98 art.35
 * + RDC ANVISA 20/2011. Documento IMPRESSO, assinado e carimbado FISICAMENTE pelo
 * prescritor. NÃO é SAMD, SNGPC, talão numerado nem assinatura digital.
 *
 * Layout (validado contra modelo real do lead): DUAS VIAS na MESMA página A4
 * (metade superior / inferior), idênticas em conteúdo, rotuladas 1ª/2ª via.
 *
 * G1 — validade documental: a identificação do emitente (nome/endereço/telefone +
 * nome/CRM/UF/especialidade do médico) vem de SNAPSHOT congelado na emissão. Logo e
 * cor (branding) são cosméticos e seguem atuais — NÃO fazem parte da validade.
 */
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { renderToBuffer } from '@react-pdf/renderer';
import type { ReactNode } from 'react';

import { formatDate } from './components';
import { quantityToWords } from './quantity-to-words';
import type { PdfBranding, PdfDoctor, ReceituarioControleEspecialPdfData } from './types';

const DEFAULT_PRIMARY = '#0F766E';
const INK = '#1f2937';
const MUTED = '#4b5563';
const LINE = '#9ca3af';

const DISCLAIMER =
  'Documento válido somente mediante assinatura e carimbo físico do prescritor.';

const s = StyleSheet.create({
  page: {
    paddingVertical: 16,
    paddingHorizontal: 26,
    fontSize: 8,
    fontFamily: 'Helvetica',
    color: INK,
    lineHeight: 1.15,
  },
  via: {
    borderWidth: 1,
    borderColor: INK,
    borderRadius: 3,
    padding: 8,
    marginBottom: 5,
  },
  cut: {
    borderTopWidth: 1,
    borderTopColor: LINE,
    borderStyle: 'dashed',
    marginVertical: 3,
  },
  // header / emitente
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  logo: { width: 30, height: 30, marginRight: 8, objectFit: 'contain' },
  emitenteNome: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  emitenteMeta: { fontSize: 7, color: MUTED },
  band: { height: 2, marginTop: 3, marginBottom: 4, borderRadius: 2 },
  title: {
    fontSize: 9.5,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  viaLabel: { fontSize: 7, color: MUTED, textAlign: 'right', marginBottom: 1 },
  // paciente
  field: { marginBottom: 1 },
  label: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#6b7280' },
  value: { fontSize: 8 },
  blankLine: {
    borderBottomWidth: 0.7,
    borderBottomColor: LINE,
    minHeight: 7,
  },
  // medicamentos
  bodyLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', marginTop: 3, marginBottom: 1 },
  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: 0.7,
    borderBottomColor: INK,
    paddingBottom: 1,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 1,
  },
  thMed: { width: '38%', fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#6b7280' },
  thDose: { width: '17%', fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#6b7280' },
  thPos: { width: '27%', fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#6b7280' },
  thQt: { width: '18%', fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#6b7280' },
  tdMed: { width: '38%', fontSize: 7.5 },
  tdDose: { width: '17%', fontSize: 7.5 },
  tdPos: { width: '27%', fontSize: 7.5 },
  tdQt: { width: '18%', fontSize: 7.5 },
  obs: { fontSize: 7, color: MUTED, marginTop: 2 },
  // data + assinatura
  signRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 6 },
  dateText: { fontSize: 8 },
  signWrap: { alignItems: 'center', width: 200 },
  signLine: { borderTopWidth: 0.8, borderTopColor: INK, width: 200, marginBottom: 1 },
  signCaption: { fontSize: 6.5, color: MUTED },
  // quadros comprador / fornecedor
  boxRow: { flexDirection: 'row', marginTop: 5, gap: 6 },
  box: { flex: 1, borderWidth: 0.7, borderColor: LINE, borderRadius: 2, padding: 4 },
  boxTitle: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  boxField: { marginBottom: 1 },
  boxFieldLabel: { fontSize: 6, color: '#6b7280' },
  disclaimer: { fontSize: 6, color: MUTED, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  genBy: { fontSize: 6, color: '#9ca3af', textAlign: 'center', marginTop: 1 },
});

function BlankField({ label }: { label: string }): ReactNode {
  return (
    <View style={s.boxField}>
      <Text style={s.boxFieldLabel}>{label}</Text>
      <View style={s.blankLine} />
    </View>
  );
}

function Emitente({
  data,
  branding,
  doctor,
}: {
  data: ReceituarioControleEspecialPdfData;
  branding: PdfBranding;
  doctor: PdfDoctor;
}): ReactNode {
  const crmLine = doctor.crmUf ? `CRM ${doctor.crmUf} ${doctor.crm}` : `CRM ${doctor.crm}`;
  const meta = [
    doctor.nome ? `${doctor.nome} — ${crmLine}` : crmLine,
    doctor.especialidade,
    data.emitenteEndereco,
    data.emitenteTelefone ? `Tel.: ${data.emitenteTelefone}` : null,
  ].filter(Boolean) as string[];
  return (
    <View>
      <View style={s.headerRow}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image não é <img>; sem prop alt. */}
        {branding.logoUrl ? <Image style={s.logo} src={branding.logoUrl} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={s.emitenteNome}>{data.emitenteNome}</Text>
          {meta.map((m, i) => (
            <Text key={i} style={s.emitenteMeta}>
              {m}
            </Text>
          ))}
        </View>
      </View>
      <View style={[s.band, { backgroundColor: branding.primaryColor ?? DEFAULT_PRIMARY }]} />
    </View>
  );
}

function Medicamentos({ data }: { data: ReceituarioControleEspecialPdfData }): ReactNode {
  return (
    <View>
      <Text style={s.bodyLabel}>Uso Interno / Uso Externo</Text>
      <View style={s.tableHead}>
        <Text style={s.thMed}>Medicamento</Text>
        <Text style={s.thDose}>Dosagem</Text>
        <Text style={s.thPos}>Posologia</Text>
        <Text style={s.thQt}>Quantidade</Text>
      </View>
      {data.medicamentos.map((m, i) => (
        <View key={i} style={s.tableRow}>
          <Text style={s.tdMed}>
            {i + 1}. {m.nome}
          </Text>
          <Text style={s.tdDose}>{m.dosagem ?? '—'}</Text>
          <Text style={s.tdPos}>{m.posologia ?? '—'}</Text>
          <Text style={s.tdQt}>{quantityToWords(m.quantidade) || '—'}</Text>
        </View>
      ))}
      {data.observacoes ? <Text style={s.obs}>Obs.: {data.observacoes}</Text> : null}
    </View>
  );
}

function Via({
  data,
  branding,
  doctor,
  viaLabel,
}: {
  data: ReceituarioControleEspecialPdfData;
  branding: PdfBranding;
  doctor: PdfDoctor;
  viaLabel: string;
}): ReactNode {
  return (
    <View style={s.via} wrap={false}>
      <Text style={s.viaLabel}>{viaLabel}</Text>
      <Emitente data={data} branding={branding} doctor={doctor} />
      <Text style={s.title}>Receituário de Controle Especial</Text>

      <View style={s.field}>
        <Text style={s.label}>Nome do Paciente</Text>
        <Text style={s.value}>{data.patientNome}</Text>
      </View>
      <View style={s.field}>
        <Text style={s.label}>Endereço do Paciente</Text>
        {data.patientEndereco ? (
          <Text style={s.value}>{data.patientEndereco}</Text>
        ) : (
          <View style={s.blankLine} />
        )}
      </View>

      <Medicamentos data={data} />

      <View style={s.signRow}>
        <Text style={s.dateText}>Data: {formatDate(data.issuedAt)}</Text>
        <View style={s.signWrap}>
          <View style={s.signLine} />
          <Text style={s.signCaption}>Carimbo e assinatura do prescritor</Text>
        </View>
      </View>

      <View style={s.boxRow}>
        <View style={s.box}>
          <Text style={s.boxTitle}>IDENTIFICAÇÃO DO COMPRADOR</Text>
          <BlankField label="Nome" />
          <BlankField label="Identidade (RG) / Órgão emissor" />
          <BlankField label="Endereço" />
          <BlankField label="Cidade / UF" />
          <BlankField label="Telefone" />
        </View>
        <View style={s.box}>
          <Text style={s.boxTitle}>IDENTIFICAÇÃO DO FORNECEDOR</Text>
          <BlankField label="Farmácia / Estabelecimento" />
          <BlankField label="Farmacêutico responsável" />
          <BlankField label="Data" />
          <BlankField label="Assinatura" />
        </View>
      </View>

      <Text style={s.disclaimer}>{DISCLAIMER}</Text>
    </View>
  );
}

export async function renderReceituarioControleEspecialPDF(
  data: ReceituarioControleEspecialPdfData,
  branding: PdfBranding,
  doctor: PdfDoctor,
): Promise<Buffer> {
  return renderToBuffer(
    <Document>
      <Page size="A4" style={s.page}>
        <Via
          data={data}
          branding={branding}
          doctor={doctor}
          viaLabel="1ª via – Farmácia/Drogaria"
        />
        <View style={s.cut} />
        <Via data={data} branding={branding} doctor={doctor} viaLabel="2ª via – Paciente" />
        <Text style={s.genBy}>Gerado por Qoro — qoro.dev</Text>
      </Page>
    </Document>,
  );
}

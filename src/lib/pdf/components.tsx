/**
 * Componentes compartilhados dos PDFs (C7) — white-label leve.
 *
 * Cabeçalho: logo + nome + endereço + CNPJ + CNES (faixa na cor primária).
 * Rodapé FIXO em toda página: "Gerado por Qoro — qoro.dev".
 * Bloco de assinatura: nome do médico + CRM/UF (obrigatório) + espaço físico.
 */
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';

import type { PdfBranding, PdfDoctor } from './types';

const DEFAULT_PRIMARY = '#0F766E';
const FOOTER_TEXT = 'Gerado por Qoro — qoro.dev';

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** ISO → dd/mm/aaaa (UTC, determinístico — sem dependência de locale do runtime). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

export const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 56,
    paddingHorizontal: 44,
    fontSize: 11,
    fontFamily: 'Helvetica',
    color: '#1f2937',
    lineHeight: 1.4,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  logo: { width: 56, height: 56, marginRight: 12, objectFit: 'contain' },
  clinicNome: { fontSize: 15, fontFamily: 'Helvetica-Bold' },
  clinicMeta: { fontSize: 9, color: '#4b5563' },
  band: { height: 3, marginTop: 6, marginBottom: 14, borderRadius: 2 },
  docTitle: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 10, textTransform: 'uppercase' },
  label: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#6b7280', marginBottom: 2 },
  paragraph: { marginBottom: 10 },
  patientLine: { marginBottom: 12, fontSize: 12 },
  itemRow: { marginBottom: 8 },
  itemNome: { fontFamily: 'Helvetica-Bold' },
  itemDetail: { fontSize: 10, color: '#374151' },
  signatureWrap: { marginTop: 48, alignItems: 'center' },
  signatureLine: { borderTopWidth: 1, borderTopColor: '#1f2937', width: 260, marginBottom: 4 },
  signatureName: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  signatureMeta: { fontSize: 9, color: '#4b5563' },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 44,
    right: 44,
    textAlign: 'center',
    fontSize: 8,
    color: '#9ca3af',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 6,
  },
  dateLine: { marginTop: 24, fontSize: 11 },
});

export function Header({ branding }: { branding: PdfBranding }): ReactNode {
  const meta = [
    branding.endereco,
    branding.cnpj ? `CNPJ: ${branding.cnpj}` : null,
    branding.cnes ? `CNES: ${branding.cnes}` : null,
  ].filter(Boolean) as string[];
  return (
    <View>
      <View style={styles.headerRow}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image não é <img> HTML; não tem prop alt. */}
        {branding.logoUrl ? <Image style={styles.logo} src={branding.logoUrl} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.clinicNome}>{branding.nome}</Text>
          {meta.map((m, i) => (
            <Text key={i} style={styles.clinicMeta}>
              {m}
            </Text>
          ))}
        </View>
      </View>
      <View style={[styles.band, { backgroundColor: branding.primaryColor ?? DEFAULT_PRIMARY }]} />
    </View>
  );
}

export function Footer(): ReactNode {
  return (
    <Text style={styles.footer} fixed>
      {FOOTER_TEXT}
    </Text>
  );
}

/** Bloco de assinatura — CRM obrigatório (a action nunca chega aqui sem CRM). */
export function SignatureBlock({ doctor }: { doctor: PdfDoctor }): ReactNode {
  const crmLine = doctor.crmUf ? `CRM ${doctor.crmUf} ${doctor.crm}` : `CRM ${doctor.crm}`;
  return (
    <View style={styles.signatureWrap}>
      <View style={styles.signatureLine} />
      <Text style={styles.signatureName}>{doctor.nome}</Text>
      <Text style={styles.signatureMeta}>{crmLine}</Text>
      {doctor.especialidade ? (
        <Text style={styles.signatureMeta}>{doctor.especialidade}</Text>
      ) : null}
    </View>
  );
}

/** Casca padrão: Page + Header + título + corpo + assinatura + rodapé fixo. */
export function DocShell({
  branding,
  doctor,
  title,
  children,
}: {
  branding: PdfBranding;
  doctor: PdfDoctor;
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Header branding={branding} />
        <Text style={styles.docTitle}>{title}</Text>
        {children}
        <SignatureBlock doctor={doctor} />
        <Footer />
      </Page>
    </Document>
  );
}

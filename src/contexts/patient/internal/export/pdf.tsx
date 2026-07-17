/**
 * LGPD export PDF renderer (C5). Pure: takes the assembled export JSON and
 * returns PDF bytes. No DB, no decryption (data arrives already decrypted from
 * the central query). Layout is intentionally minimal — §5.18 lets it evolve.
 *
 * C7: migrado de pdf-lib para @react-pdf/renderer (engine único do projeto).
 * react-pdf pagina o conteúdo que transborda automaticamente; o consumidor
 * (lgpd-export-requested) não muda — Buffer é compatível com o upload.
 */
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';

export interface ExportDocument {
  requestId: string;
  patientId: string;
  clinicId: string;
  exportedAt: string;
  sections: Record<string, unknown>;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 48,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#1a1a1a',
    lineHeight: 1.4,
  },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 8 },
  meta: { marginBottom: 2 },
  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4 },
  line: { marginLeft: 12, marginBottom: 1 },
});

/** Flatten a JSON value into human-readable "key: value" lines. */
function stringifyValue(value: unknown, prefix = ''): string[] {
  if (value === null || value === undefined) return [`${prefix}: —`];
  if (typeof value !== 'object') return [`${prefix}: ${String(value)}`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}: (vazio)`];
    return value.flatMap((v, i) => stringifyValue(v, `${prefix}[${i}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    stringifyValue(v, prefix ? `${prefix}.${k}` : k),
  );
}

export async function renderExportPdf(doc: ExportDocument): Promise<Buffer> {
  return renderToBuffer(
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>Qoro — Exportação de Dados Pessoais (LGPD Art. 18)</Text>
        <Text style={styles.meta}>Solicitação: {doc.requestId}</Text>
        <Text style={styles.meta}>Paciente: {doc.patientId}</Text>
        <Text style={styles.meta}>Gerado em: {doc.exportedAt}</Text>
        {Object.entries(doc.sections).map(([sectionKey, value]) => (
          <View key={sectionKey} wrap>
            <Text style={styles.sectionTitle}>{sectionKey.toUpperCase()}</Text>
            {stringifyValue(value).map((line, i) => (
              <Text key={i} style={styles.line}>
                {line}
              </Text>
            ))}
          </View>
        ))}
      </Page>
    </Document>,
  );
}

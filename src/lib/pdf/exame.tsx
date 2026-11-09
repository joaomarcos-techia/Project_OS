import { renderToBuffer, Text, View } from '@react-pdf/renderer';

import { DocShell, formatDate, styles } from './components';
import type { ExamePdfData, PdfBranding, PdfDoctor } from './types';

export async function renderExamePDF(
  data: ExamePdfData,
  branding: PdfBranding,
  doctor: PdfDoctor,
): Promise<Buffer> {
  return renderToBuffer(
    <DocShell branding={branding} doctor={doctor} title="Solicitação de Exames">
      <Text style={styles.patientLine}>Paciente: {data.patientNome}</Text>
      <View style={styles.paragraph}>
        <Text style={styles.label}>Solicito os seguintes exames</Text>
        {data.exames.map((ex, i) => (
          <Text key={i} style={styles.itemRow}>
            {i + 1}. {ex}
          </Text>
        ))}
      </View>
      {data.indicacaoClinica ? (
        <View style={styles.paragraph}>
          <Text style={styles.label}>Indicação clínica</Text>
          <Text>{data.indicacaoClinica}</Text>
        </View>
      ) : null}
      <Text style={styles.dateLine}>Data: {formatDate(data.issuedAt, data.timeZone)}</Text>
    </DocShell>,
  );
}

import { renderToBuffer, Text, View } from '@react-pdf/renderer';

import { DocShell, formatDate, styles } from './components';
import type { EncaminhamentoPdfData, PdfBranding, PdfDoctor } from './types';

export async function renderEncaminhamentoPDF(
  data: EncaminhamentoPdfData,
  branding: PdfBranding,
  doctor: PdfDoctor,
): Promise<Buffer> {
  return renderToBuffer(
    <DocShell branding={branding} doctor={doctor} title="Encaminhamento">
      <Text style={styles.patientLine}>Paciente: {data.patientNome}</Text>
      <View style={styles.paragraph}>
        <Text>Encaminho o(a) paciente acima para avaliação em {data.especialidade}.</Text>
      </View>
      <View style={styles.paragraph}>
        <Text style={styles.label}>Motivo do encaminhamento</Text>
        <Text>{data.motivo}</Text>
      </View>
      <Text style={styles.dateLine}>Data: {formatDate(data.issuedAt)}</Text>
    </DocShell>,
  );
}

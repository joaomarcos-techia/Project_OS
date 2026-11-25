import { renderToBuffer, Text, View } from '@react-pdf/renderer';

import { DocShell, formatDate, styles } from './components';
import type { DeclaracaoPdfData, PdfBranding, PdfDoctor } from './types';

export async function renderDeclaracaoPDF(
  data: DeclaracaoPdfData,
  branding: PdfBranding,
  doctor: PdfDoctor,
): Promise<Buffer> {
  return renderToBuffer(
    <DocShell branding={branding} doctor={doctor} title="Declaração">
      <View style={styles.paragraph}>
        <Text>
          Declaro, para os devidos fins, que o(a) paciente {data.patientNome} {data.texto}
        </Text>
      </View>
      {data.periodo ? (
        <View style={styles.paragraph}>
          <Text style={styles.label}>Período</Text>
          <Text>{data.periodo}</Text>
        </View>
      ) : null}
      <Text style={styles.dateLine}>Data: {formatDate(data.issuedAt, data.timeZone)}</Text>
    </DocShell>,
  );
}

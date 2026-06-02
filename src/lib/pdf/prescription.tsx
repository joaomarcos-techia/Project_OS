import { renderToBuffer, Text, View } from '@react-pdf/renderer';

import { DocShell, formatDate, styles } from './components';
import type { PdfBranding, PdfDoctor, PrescriptionPdfData } from './types';

export async function renderPrescriptionPDF(
  data: PrescriptionPdfData,
  branding: PdfBranding,
  doctor: PdfDoctor,
): Promise<Buffer> {
  return renderToBuffer(
    <DocShell branding={branding} doctor={doctor} title="Prescrição Médica">
      <Text style={styles.patientLine}>Paciente: {data.patientNome}</Text>
      <View>
        {data.medicamentos.map((m, i) => (
          <View key={i} style={styles.itemRow}>
            <Text style={styles.itemNome}>
              {i + 1}. {m.nome}
              {m.dosagem ? ` — ${m.dosagem}` : ''}
            </Text>
            {m.posologia ? <Text style={styles.itemDetail}>Posologia: {m.posologia}</Text> : null}
            {m.via ? <Text style={styles.itemDetail}>Via: {m.via}</Text> : null}
            {m.quantidade ? <Text style={styles.itemDetail}>Quantidade: {m.quantidade}</Text> : null}
          </View>
        ))}
      </View>
      {data.observacoes ? (
        <View style={styles.paragraph}>
          <Text style={styles.label}>Observações</Text>
          <Text>{data.observacoes}</Text>
        </View>
      ) : null}
      <Text style={styles.dateLine}>Data: {formatDate(data.issuedAt)}</Text>
    </DocShell>,
  );
}

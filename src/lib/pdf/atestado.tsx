import { renderToBuffer, Text, View } from '@react-pdf/renderer';

import { DocShell, formatDate, styles } from './components';
import type { AtestadoPdfData, PdfBranding, PdfDoctor } from './types';

export async function renderAtestadoPDF(
  data: AtestadoPdfData,
  branding: PdfBranding,
  doctor: PdfDoctor,
): Promise<Buffer> {
  return renderToBuffer(
    <DocShell branding={branding} doctor={doctor} title="Atestado Médico">
      <View style={styles.paragraph}>
        <Text>
          Atesto, para os devidos fins, que o(a) paciente {data.patientNome} {data.descricao}
        </Text>
      </View>
      {typeof data.dias === 'number' ? (
        <View style={styles.paragraph}>
          <Text>
            Necessita de afastamento de suas atividades por {data.dias}{' '}
            {data.dias === 1 ? 'dia' : 'dias'}.
          </Text>
        </View>
      ) : null}
      {data.cid ? (
        <View style={styles.paragraph}>
          <Text style={styles.label}>CID</Text>
          <Text>{data.cid}</Text>
        </View>
      ) : null}
      <Text style={styles.dateLine}>Data: {formatDate(data.issuedAt)}</Text>
    </DocShell>,
  );
}

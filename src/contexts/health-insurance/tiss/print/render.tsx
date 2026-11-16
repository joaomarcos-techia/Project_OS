/**
 * PDF oficial das guias (P7.6 Consulta; P8.5 SP/SADT de cobrança e de solicitação):
 * desenha as operações de `layoutGuide` com o @react-pdf (o mesmo motor dos PDFs
 * clínicos, `src/lib/pdf`). Puro: entrada tipada → Buffer, sem banco, sem log de
 * conteúdo. Gerado em memória; quem persiste ou entrega é o chamador (P12.7).
 *
 * Metadados do PDF sem dado pessoal: título com o tipo e o número da guia.
 */
import { Document, Page, renderToBuffer, Text, View } from '@react-pdf/renderer';

import { textWidth } from './text-metrics';
import { layoutGuide, type DrawOp, type PrintLayout, type PrintMeta } from './layout';
import type { GuidePrintView } from './values';

/**
 * Do topo da caixa de texto do @react-pdf à linha de base, em corpos (Helvetica,
 * `lineHeight: 1`). Calibrado contra o PDF gerado (teste de posição dos rótulos).
 */
export const TEXT_ASCENT = 0.9;

function Op({ op }: { op: DrawOp }) {
  if (op.t === 'box') {
    return (
      <View
        style={{
          position: 'absolute',
          left: op.x,
          top: op.y,
          width: op.w,
          height: op.h,
          ...(op.fill ? { backgroundColor: op.fill } : {}),
          ...(op.stroke ? { borderWidth: op.lineWidth, borderColor: op.stroke, borderStyle: 'solid' } : {}),
        }}
      />
    );
  }
  return (
    <Text
      style={{
        position: 'absolute',
        left: op.x,
        top: op.y - TEXT_ASCENT * op.size,
        width: textWidth(op.text, op.size, op.bold) * 1.15 + 6,
        fontSize: op.size,
        lineHeight: 1,
        fontFamily: op.bold ? 'Helvetica-Bold' : 'Helvetica',
        color: '#000000',
      }}
    >
      {op.text}
    </Text>
  );
}

function ContinuationPage({ layout, meta }: { layout: PrintLayout; meta: PrintMeta }) {
  return (
    <Page size={[layout.model.width, layout.model.height]} style={{ padding: 48, fontFamily: 'Helvetica', fontSize: 9 }}>
      <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 11, marginBottom: 4 }}>
        FOLHA DE CONTINUAÇÃO — {layout.title}
      </Text>
      <Text style={{ marginBottom: 14 }}>
        Guia nº {meta.guideNumber}
        {meta.revision !== null ? `, revisão ${meta.revision}` : ''}. Texto integral dos campos que não couberam no modelo.
      </Text>
      {layout.continuation.map((c) => (
        <View key={`${c.field}-${c.label}`} style={{ marginBottom: 10 }} wrap={false}>
          <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>
            Campo {c.field} — {c.label}
          </Text>
          <Text>{c.text}</Text>
        </View>
      ))}
    </Page>
  );
}

const DOC_TITLE: Record<GuidePrintView['kind'], string> = {
  consulta: 'Guia de Consulta',
  sp_sadt_cobranca: 'Guia SP/SADT',
  sp_sadt_solicitacao: 'Guia SP/SADT (solicitação)',
};

export function renderGuidePdfFromLayout(layout: PrintLayout, meta: PrintMeta, kind: GuidePrintView['kind']): Promise<Buffer> {
  const docTitle = `${meta.copy === 'attendance' ? 'Via de atendimento — ' : ''}${DOC_TITLE[kind]} nº ${meta.guideNumber}`;
  return renderToBuffer(
    <Document title={docTitle} author={meta.software.name} creator={meta.software.name} producer={meta.software.name}>
      {layout.pages.map((ops, i) => (
        <Page key={i} size={[layout.model.width, layout.model.height]} style={{ position: 'relative', fontFamily: 'Helvetica' }}>
          {ops.map((op, j) => (
            <Op key={j} op={op} />
          ))}
        </Page>
      ))}
      {layout.continuation.length > 0 ? <ContinuationPage layout={layout} meta={meta} /> : null}
    </Document>,
  );
}

/** Guia (Consulta, SP/SADT de cobrança ou de solicitação) no modelo oficial. */
export async function renderGuidePdf(view: GuidePrintView, meta: PrintMeta): Promise<{ pdf: Buffer; layout: PrintLayout }> {
  const layout = layoutGuide(view, meta);
  return { pdf: await renderGuidePdfFromLayout(layout, meta, view.kind), layout };
}

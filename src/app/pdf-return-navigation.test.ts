import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const documentPage = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/documentos/[id]/pdf/page.tsx'),
  'utf8',
);
const prescriptionPage = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/prescricoes/[id]/pdf/page.tsx'),
  'utf8',
);
const documentRegenerate = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/documentos/[id]/pdf/regenerate-button.tsx'),
  'utf8',
);
const prescriptionRegenerate = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/prescricoes/[id]/pdf/regenerate-button.tsx'),
  'utf8',
);
const patientHubPage = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/pacientes/[id]/page.tsx'),
  'utf8',
);

describe('P-26 — retorno dos visualizadores de PDF', () => {
  it('leva o documento ao prontuário do patientId associado', () => {
    expect(documentPage).toContain('href={`/pacientes/${doc.patientId}?tab=prontuarios`}');
    expect(documentPage).not.toContain('/pacientes/${doc.patientId}/prontuarios');
  });

  it('leva a prescrição ao prontuário do patientId associado', () => {
    expect(prescriptionPage).toContain('href={`/pacientes/${presc.patientId}?tab=prontuarios`}');
    expect(prescriptionPage).not.toContain('/pacientes/${presc.patientId}/prontuarios');
  });

  it('aponta para o hub existente que reconhece a tab de prontuários', () => {
    expect(patientHubPage).toContain('tab?: string');
    expect(patientHubPage).toContain("rawTab === 'prontuarios'");
  });
});

describe('P-20 — visualizadores de PDF seguem os tokens do produto', () => {
  it.each([
    ['documento', documentPage, documentRegenerate],
    ['prescrição', prescriptionPage, prescriptionRegenerate],
  ])('%s não usa cores cruas e possui fallback temático', (_name, pageSource, actionSource) => {
    expect(pageSource).not.toMatch(/(?:border|bg|text)-(?:gray|amber|red)-\d+/u);
    expect(actionSource).not.toMatch(/(?:border|bg|text)-(?:gray|amber|red)-\d+/u);
    expect(pageSource).toContain('border-border bg-surface');
    expect(pageSource).toContain('<Alert variant="warning"');
    expect(actionSource).toContain('<Button');
    expect(actionSource).toContain('<Alert variant="danger"');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('P-21/P-37 — conteúdo de alta exposição', () => {
  it('usa acentuação consistente nos fluxos auditados', () => {
    const agenda = [
      source('src/app/(app)/(shell)/agenda/page.tsx'),
      source('src/app/(app)/(shell)/agenda/agenda-page-actions.tsx'),
    ].join('\n');
    const importer = source('src/app/(app)/(shell)/agenda/importar/page.tsx');
    const death = source('src/app/(app)/(shell)/pacientes/[id]/patient-death-form.tsx');
    const lgpd = [
      source('src/app/(app)/(shell)/configuracoes/lgpd/page.tsx'),
      source('src/app/(app)/(shell)/configuracoes/lgpd/lgpd-work-queue.tsx'),
    ].join('\n');

    expect(agenda).toContain('Importar histórico');
    expect(agenda).toContain('Ausências médicas');
    expect(importer).toContain('Importar histórico da agenda');
    expect(death).toContain('Esta ação bloqueia novas consultas');
    expect(lgpd).toContain('Solicitações LGPD');
    expect(lgpd).toContain('Histórico de tratamento');
  });

  it('usa Qoro nos textos institucionais corrigidos', () => {
    const suggestions = source('src/app/(app)/(shell)/configuracoes/sugestoes/page.tsx');
    const whatsapp = source('src/app/(app)/(shell)/configuracoes/whatsapp/whatsapp-connect.tsx');

    expect(suggestions).toContain('time da Qoro');
    expect(whatsapp).toContain('pela Qoro');
  });
});

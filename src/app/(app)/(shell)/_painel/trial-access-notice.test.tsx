import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TrialAccessNotice } from './trial-access-notice';

describe('trial usage notice', () => {
  it('shows the approved limits, shared documents and paid integrations', () => {
    const html = renderToStaticMarkup(
      <TrialAccessNotice snapshot={{ restricted: true, usage: { patients: 10, documents: 15 } }} />,
    );
    expect(html).toContain('10/10');
    expect(html).toContain('15/15');
    expect(html).toContain('WhatsApp');
    expect(html).toContain('Asaas');
    expect(html).toContain('convênios');
    expect(html).toContain('agentes de IA');
    expect(html).toContain('pagar não');
    expect(html).toContain('convites de equipe');
    expect(html).toContain('excluir ou cancelar não devolve a cota');
    expect(html).toContain('href="/configuracoes/assinatura"');
  });
  it('removes the notice after release and preserves legacy accounts', () => {
    expect(renderToStaticMarkup(<TrialAccessNotice snapshot={null} />)).toBe('');
    expect(
      renderToStaticMarkup(
        <TrialAccessNotice snapshot={{ restricted: false, usage: { patients: 10 } }} />,
      ),
    ).toBe('');
  });
});

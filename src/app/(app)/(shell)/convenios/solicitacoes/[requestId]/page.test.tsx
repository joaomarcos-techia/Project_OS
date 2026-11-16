// @vitest-environment happy-dom
/**
 * Regressão do 500 visto no Preview (12/11): a tela de detalhe da solicitação SP/SADT renderiza
 * com o objeto que a consulta real devolve (rascunho, sem autorização, com atendimentos para
 * ligar) e com o pedido já conferido (documento oficial gerado ou pendente).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SadtRequestDetail } from '@/contexts/health-insurance/queries';

import type * as AccessModule from '../../_lib/access';

const m = vi.hoisted(() => ({ conveniosAccess: vi.fn(), getSadtRequestDetail: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/convenios/solicitacoes',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  notFound: () => {
    throw new Error('404');
  },
}));
vi.mock('@/contexts/health-insurance/actions', () => {
  const a = () => Object.assign(vi.fn(), { bind: () => vi.fn() });
  return {
    cancelSadtRequestAction: a(), cancelSadtRequestItemAction: a(), checkSadtRequestAction: a(), completeSadtRequestAction: a(),
    createSadtRequestAction: a(), denySadtRequestAction: a(), exportSadtRequestDocumentAction: a(), linkAppointmentToSadtItemAction: a(),
    recordSadtAuthorizationAction: a(), setSadtClinicalIndicationAction: a(),
  };
});
vi.mock('../../_lib/access', async (orig) => {
  const real = await orig<typeof AccessModule>();
  return { ...real, conveniosAccess: m.conveniosAccess };
});
vi.mock('@/contexts/health-insurance/queries', () => ({ getSadtRequestDetail: m.getSadtRequestDetail }));

import SolicitacaoPage from './page';
import { accessFor, PROFILES } from '../../_lib/access-fixture';

const ID = '978e5d9b-fcb0-4a70-b76c-fcfaeee7ec11';
const draft: SadtRequestDetail = {
  id: ID,
  requestNumber: null,
  status: 'draft',
  version: 1,
  patientName: 'Paciente Sintético E2E Três',
  insurerName: 'Operadora Sintética E2E',
  requestedOn: '2026-11-12',
  requesterName: 'Dra. Sintética E2E',
  authorizationRequirement: 'unknown',
  items: 1,
  requested: 4,
  executed: 0,
  createdAt: '2026-11-13T01:10:00.000Z',
  patientId: '11111111-1111-4111-8111-111111111111',
  membershipId: '22222222-2222-4222-8222-222222222222',
  requesterKind: 'internal',
  requesterProfessionalId: '33333333-3333-4333-8333-333333333333',
  careCharacter: '1',
  careType: '03',
  consultationType: null,
  hasClinicalIndication: false,
  issues: [],
  note: null,
  cancelReason: null,
  authorization: null,
  itemRows: [
    { id: '44444444-4444-4444-8444-444444444444', sequence: 1, tableCode: '22', procedureCode: '50000470', description: 'Sessão de psicoterapia individual', quantityRequested: 4, quantityAuthorized: null, executed: 0, status: 'active', cancelReason: null },
  ],
  events: [{ from: null, to: 'draft', note: null, at: '2026-11-13T01:10:00.000Z', via: 'user' }],
  guides: [],
  linkableAppointments: [
    { id: '55555555-5555-4555-8555-555555555555', scheduledAt: '2026-11-20T13:00:00.000Z', status: 'agendado' },
    { id: '66666666-6666-4666-8666-666666666666', scheduledAt: '2026-11-27T13:00:00.000Z', status: 'agendado' },
  ],
  document: null,
};

describe('detalhe da solicitação SP/SADT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.conveniosAccess.mockResolvedValue(accessFor(PROFILES.gestor, { commercial: null }));
  });
  afterEach(cleanup);

  it('rascunho (o que a consulta real devolve): renderiza, com "Conferir solicitação" para quem gerencia', async () => {
    m.getSadtRequestDetail.mockResolvedValue(draft);
    render(await SolicitacaoPage({ params: Promise.resolve({ requestId: ID }) }));
    expect(screen.getByRole('button', { name: 'Conferir solicitação' })).toBeTruthy();
  });

  it('aguardando a operadora: documento oficial gerado (abrir PDF) ou pendente (gerar)', async () => {
    const auth = { status: 'requested', operatorGuideNumber: null, operatorProtocol: null, authorizedOn: null, passwordValidUntil: null, hasPassword: false, denialReason: null };
    m.getSadtRequestDetail.mockResolvedValue({ ...draft, status: 'awaiting_authorization', requestNumber: '7', authorizationRequirement: 'required', authorization: auth, document: { pdfFileId: 'f1', xmlFileId: 'f2', generatedAt: '2026-11-13T01:12:00.000Z' } });
    render(await SolicitacaoPage({ params: Promise.resolve({ requestId: ID }) }));
    expect(screen.getByRole('link', { name: 'Abrir PDF' }).getAttribute('href')).toBe(`/financeiro/convenios/solicitacoes/${ID}/pdf`);
    cleanup();
    m.getSadtRequestDetail.mockResolvedValue({ ...draft, status: 'awaiting_authorization', requestNumber: '7', authorizationRequirement: 'required', authorization: auth, document: { pdfFileId: null, xmlFileId: null, generatedAt: null } });
    render(await SolicitacaoPage({ params: Promise.resolve({ requestId: ID }) }));
    expect(screen.getByRole('button', { name: 'Gerar documento oficial' })).toBeTruthy();
  });
});

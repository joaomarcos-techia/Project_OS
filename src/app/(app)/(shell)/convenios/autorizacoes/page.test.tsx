// @vitest-environment happy-dom
/**
 * P6.3 — telas das autorizações da operadora: a fila (vencendo ou acabando, aguardando a
 * operadora, concedidas, encerradas), o detalhe (sem a senha), quem pode registrar a resposta e o
 * caminho da SP/SADT pela solicitação. Acesso e consultas simulados; o servidor é testado à parte.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AccessModule from '../_lib/access';
import type { AuthorizationListRow } from '@/contexts/health-insurance/queries';

const m = vi.hoisted(() => ({
  conveniosAccess: vi.fn(),
  listAuthorizations: vi.fn(),
  getAuthorization: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/convenios/autorizacoes',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  notFound: () => {
    throw new Error('404');
  },
}));
vi.mock('@/contexts/health-insurance/actions', () => ({ recordConsultaAuthorizationResponseAction: vi.fn() }));
vi.mock('../_lib/access', async (orig) => {
  const real = await orig<typeof AccessModule>();
  return { ...real, conveniosAccess: m.conveniosAccess };
});
vi.mock('@/contexts/health-insurance/queries', () => ({
  listAuthorizations: m.listAuthorizations,
  getAuthorization: m.getAuthorization,
}));

import AutorizacaoPage from './[authorizationId]/page';
import AutorizacoesPage from './page';
import { accessFor, PROFILES } from '../_lib/access-fixture';

const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const A3 = '33333333-3333-4333-8333-333333333333';
const A4 = '44444444-4444-4444-8444-444444444444';

const row = (over: Partial<AuthorizationListRow>): AuthorizationListRow => ({
  id: A1,
  guideType: 'consulta',
  status: 'authorized',
  origin: 'manual',
  version: 2,
  insurerName: 'Operadora Um',
  patientName: 'Paciente Sintético',
  requestedOn: '2026-11-10',
  authorizedOn: '2026-11-11',
  operatorGuideNumber: '998877',
  operatorProtocol: null,
  hasPassword: true,
  passwordValidUntil: '2026-11-17',
  denialReason: null,
  sadtRequestId: null,
  sadtRequestNumber: null,
  receipts: 0,
  items: [{ id: 'i1', tableCode: '22', procedureCode: '10101012', quantityRequested: 1, quantityAuthorized: 1, quantityConsumed: 0 }],
  shownState: 'authorized',
  remaining: 1,
  authorizedTotal: 1,
  ...over,
});

const rows = [
  row({ id: A1, patientName: 'Ana Sintética' }),
  row({ id: A2, patientName: 'Bruno Sintético', status: 'requested', shownState: 'requested', authorizedOn: null, operatorGuideNumber: null, hasPassword: false, passwordValidUntil: null, remaining: 0, authorizedTotal: 0 }),
  row({ id: A3, patientName: 'Carla Sintética', guideType: 'sp_sadt', status: 'pending_operator', shownState: 'pending_operator', sadtRequestId: A4, sadtRequestNumber: 'S-7', remaining: 0, authorizedTotal: 0 }),
  row({ id: A4, patientName: 'Davi Sintético', status: 'denied', shownState: 'denied', denialReason: 'Fora da cobertura' }),
];

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  m.conveniosAccess.mockResolvedValue(accessFor(PROFILES.gestor, { commercial: null }));
  m.listAuthorizations.mockResolvedValue({
    today: '2026-11-16',
    rows,
    alerts: [{ kind: 'password_expiring', authorizationId: A1, validUntil: '2026-11-17', daysLeft: 1 }],
  });
});

describe('fila das autorizações', () => {
  it('mostra o alerta antes do vencimento, o que aguarda a operadora, o que está em uso e o que encerrou', async () => {
    render(await AutorizacoesPage());
    expect(screen.getByRole('region', { name: 'Autorizações vencendo ou acabando' }).textContent).toContain('Senha vence amanhã (17/11/2026)');
    const waiting = screen.getByRole('region', { name: 'Autorizações aguardando a operadora' });
    expect(waiting.textContent).toContain('Bruno Sintético');
    expect(waiting.textContent).toContain('Carla Sintética');
    expect(screen.getByRole('region', { name: 'Autorizações concedidas' }).textContent).toContain('1 de 1');
    expect(screen.getByRole('region', { name: 'Autorizações encerradas' }).textContent).toContain('Negada');
  });

  it('a SP/SADT aguardando é respondida pela solicitação; a Consulta, pela própria autorização', async () => {
    render(await AutorizacoesPage());
    expect(screen.getByRole('link', { name: /Responder pela solicitação S-7/u }).getAttribute('href')).toBe(`/convenios/solicitacoes/${A4}`);
    expect(screen.getByRole('link', { name: 'Registrar a resposta' }).getAttribute('href')).toBe(`/convenios/autorizacoes/${A2}`);
  });

  it('sem autorização nenhuma: estado vazio explicando de onde elas vêm', async () => {
    m.listAuthorizations.mockResolvedValueOnce({ today: '2026-11-16', rows: [], alerts: [] });
    render(await AutorizacoesPage());
    expect(screen.getByText('Nenhuma autorização')).toBeTruthy();
  });

  it('sem acesso: a tela de acesso e nenhuma consulta', async () => {
    m.conveniosAccess.mockResolvedValueOnce({ ok: false, view: <p>Sem acesso</p> });
    render(await AutorizacoesPage());
    expect(screen.getByText('Sem acesso')).toBeTruthy();
    expect(m.listAuthorizations).not.toHaveBeenCalled();
  });
});

describe('detalhe da autorização', () => {
  const params = (id: string) => ({ params: Promise.resolve({ authorizationId: id }) });

  it('concedida: mostra número, validade e saldo; a senha aparece só como "registrada"', async () => {
    m.getAuthorization.mockResolvedValueOnce({ today: '2026-11-16', row: rows[0], events: [], receipts: [] });
    render(await AutorizacaoPage(params(A1)));
    const box = screen.getByRole('region', { name: 'Situação da autorização' });
    expect(box.textContent).toContain('998877');
    expect(box.textContent).toContain('registrada (guardada cifrada)');
    expect(screen.queryByRole('button', { name: 'Registrar resposta da operadora' })).toBeNull();
  });

  it('Consulta aguardando: quem gerencia registra a resposta; sem permissão ou com restrição comercial, não', async () => {
    m.getAuthorization.mockResolvedValue({ today: '2026-11-16', row: rows[1], events: [], receipts: [] });
    render(await AutorizacaoPage(params(A2)));
    expect(screen.getByRole('button', { name: 'Registrar resposta da operadora' })).toBeTruthy();
    cleanup();
    m.conveniosAccess.mockResolvedValueOnce(accessFor(PROFILES.leitura, { commercial: null }));
    render(await AutorizacaoPage(params(A2)));
    expect(screen.queryByRole('button', { name: 'Registrar resposta da operadora' })).toBeNull();
    cleanup();
    m.conveniosAccess.mockResolvedValueOnce(accessFor(PROFILES.gestor, { commercial: 'trial' }));
    render(await AutorizacaoPage(params(A2)));
    expect(screen.queryByRole('button', { name: 'Registrar resposta da operadora' })).toBeNull();
  });

  it('SP/SADT aguardando: aponta para a solicitação, sem formulário próprio', async () => {
    m.getAuthorization.mockResolvedValueOnce({ today: '2026-11-16', row: rows[2], events: [], receipts: [] });
    render(await AutorizacaoPage(params(A3)));
    expect(screen.getByRole('link', { name: /solicitação S-7/u }).getAttribute('href')).toBe(`/convenios/solicitacoes/${A4}`);
    expect(screen.queryByRole('button', { name: 'Registrar resposta da operadora' })).toBeNull();
  });

  it('id que não é UUID ou de outra clínica (consulta devolve nulo): não encontrada', async () => {
    await expect(AutorizacaoPage(params('abc'))).rejects.toThrow('404');
    expect(m.getAuthorization).not.toHaveBeenCalled();
    m.getAuthorization.mockResolvedValueOnce(null);
    await expect(AutorizacaoPage(params(A1))).rejects.toThrow('404');
  });

  it('histórico com o autor e a rotina do sistema; comprovante só com os metadados', async () => {
    m.getAuthorization.mockResolvedValueOnce({
      today: '2026-11-16',
      row: rows[0],
      events: [
        { fromStatus: null, toStatus: 'requested', note: 'pedido manual (Guia de Consulta)', actorName: 'Recepção Sintética', createdAt: '2026-11-10T12:00:00Z' },
        { fromStatus: 'authorized', toStatus: 'expired', note: 'senha vencida em 2026-11-09', actorName: null, createdAt: '2026-11-10T13:00:00Z' },
      ],
      receipts: [{ id: 'r1', mediaType: 'application/pdf', sizeBytes: 2048, uploadedByName: 'Recepção Sintética', createdAt: '2026-11-11T12:00:00Z' }],
    });
    render(await AutorizacaoPage(params(A1)));
    const history = screen.getByRole('region', { name: 'Histórico da autorização' }).textContent ?? '';
    expect(history).toContain('Pedida · Recepção Sintética');
    expect(history).toContain('Autorizada → Vencida · rotina do sistema');
    expect(screen.getByRole('region', { name: 'Comprovantes da autorização' }).textContent).toContain('PDF · 2 KB');
  });
});

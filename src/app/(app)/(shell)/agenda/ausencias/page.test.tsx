import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  administersTeamSchedule,
  getClinicTimezone,
  getProfileNames,
  isPractitioner,
  listDoctorAbsencesPage,
  listEmployees,
  redirect,
  requireClinicId,
  requireUser,
} = vi.hoisted(() => ({
  administersTeamSchedule: vi.fn(),
  getClinicTimezone: vi.fn(),
  getProfileNames: vi.fn(),
  isPractitioner: vi.fn(),
  listDoctorAbsencesPage: vi.fn(),
  listEmployees: vi.fn(),
  redirect: vi.fn(),
  requireClinicId: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock('@/contexts/identity', () => ({ isPractitioner }));
vi.mock('@/contexts/identity/queries', () => ({ getProfileNames, listEmployees }));
vi.mock('@/contexts/scheduling/internal/availability-scope', () => ({
  administersTeamSchedule,
}));
vi.mock('@/contexts/scheduling/queries', () => ({ listDoctorAbsencesPage }));
vi.mock('@/contexts/tenancy/queries', () => ({ getClinicTimezone }));
// A página lê o usuário por `requirePageUser` (sessão morta vai para /login, OBS-001). Aqui ele
// delega ao `requireUser` simulado, para os cenários continuarem os mesmos; o redirecionamento
// tem teste próprio em `src/lib/auth/page-guard.test.ts`.
vi.mock('@/lib/auth/page-guard', () => ({
  requirePageUser: async () => (await import('@/lib/auth/tenant-context')).requireUser(),
}));
vi.mock('@/lib/auth/tenant-context', () => ({ requireClinicId, requireUser }));
vi.mock('next/navigation', () => ({ redirect }));

import { PERMISSIONS } from '@/lib/auth/permissions';

import DoctorAbsencesPage from './page';

const clinicId = '00000000-0000-4000-8000-00000000000a';
const doctorId = '00000000-0000-4000-8000-00000000000d';
const emptyPage = { items: [], total: 0, page: 1, pageSize: 30 };
const pageSource = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/agenda/ausencias/page.tsx'),
  'utf8',
);

describe('/agenda/ausencias pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({
      userId: doctorId,
      permissions: [PERMISSIONS.MANAGE_AVAILABILITY],
    });
    requireClinicId.mockResolvedValue(clinicId);
    administersTeamSchedule.mockReturnValue(true);
    isPractitioner.mockReturnValue(true);
    listEmployees.mockResolvedValue([
      { id: doctorId, nome: 'Dra. Ana', ativo: true, pending: false },
    ]);
    listDoctorAbsencesPage.mockResolvedValue(emptyPage);
    getClinicTimezone.mockResolvedValue('America/Sao_Paulo');
    getProfileNames.mockResolvedValue(new Map());
  });

  it('aplica o gate de permissão antes de qualquer leitura tenant-scoped', async () => {
    requireUser.mockResolvedValue({ userId: doctorId, permissions: [] });

    await DoctorAbsencesPage({ searchParams: Promise.resolve({}) });

    expect(requireClinicId).not.toHaveBeenCalled();
    expect(listEmployees).not.toHaveBeenCalled();
    expect(listDoctorAbsencesPage).not.toHaveBeenCalled();
  });

  it('orienta o gestor de uma clínica sem médicos sem alegar falta de permissão', async () => {
    listEmployees.mockResolvedValue([]);

    const html = renderToStaticMarkup(
      await DoctorAbsencesPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain('Ausências médicas');
    expect(html).toContain('Nenhum profissional disponível');
    expect(html).toContain('href="/equipe"');
    expect(html).not.toContain('Sem permissão');
  });

  it('mantém o bloqueio para quem não administra a equipe e não tem agenda própria', async () => {
    administersTeamSchedule.mockReturnValue(false);
    listEmployees.mockResolvedValue([]);

    const html = renderToStaticMarkup(
      await DoctorAbsencesPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain('Sem permissão');
    expect(html).not.toContain('href="/equipe"');
  });

  it('consulta somente a página e os filtros validados da URL', async () => {
    await DoctorAbsencesPage({
      searchParams: Promise.resolve({
        profissional: doctorId,
        periodo: 'past',
        page: '2',
      }),
    });

    expect(listDoctorAbsencesPage).toHaveBeenCalledWith(clinicId, {
      doctorId,
      period: 'past',
      page: 2,
      asOf: expect.any(Date),
    });
  });

  it('normaliza página e filtros externos inválidos', async () => {
    await DoctorAbsencesPage({
      searchParams: Promise.resolve({
        profissional: 'id-fora-da-equipe',
        periodo: 'amanha',
        page: '-4',
      }),
    });

    expect(listDoctorAbsencesPage).toHaveBeenCalledWith(clinicId, {
      period: 'upcoming',
      page: 1,
      asOf: expect.any(Date),
    });
  });

  it('redireciona overflow para a última página preservando filtros', async () => {
    listDoctorAbsencesPage.mockResolvedValue({ items: [], total: 61, page: 9, pageSize: 30 });

    await DoctorAbsencesPage({
      searchParams: Promise.resolve({
        profissional: doctorId,
        periodo: 'past',
        page: '9',
      }),
    });

    expect(redirect).toHaveBeenCalledWith(
      `/agenda/ausencias?profissional=${doctorId}&periodo=past&page=3`,
    );
  });

  it('redireciona página excedente de uma lista vazia para a URL base', async () => {
    await DoctorAbsencesPage({ searchParams: Promise.resolve({ page: '2' }) });

    expect(redirect).toHaveBeenCalledWith('/agenda/ausencias');
  });

  it('usa a moldura canônica do design system, não uma montada à mão', () => {
    // A moldura (scroll, rodapé, contagem, paginação) mudou de mão: era montada
    // aqui e passou a viver no DataTable. A asserção acompanha — e a segunda
    // metade é a que importa, porque impede a volta do cerco copiado por rota,
    // que era o que fazia a contagem divergir entre telas.
    expect(pageSource).toContain('<DataTable');
    expect(pageSource).not.toContain('<TableFoot');
    expect(pageSource).not.toContain('<TablePager');
  });
});

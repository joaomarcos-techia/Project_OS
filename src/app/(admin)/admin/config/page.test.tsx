// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  guardAdminAccess,
  getPlatformSettingsMeta,
  listAnnouncementsForAdmin,
  listJobs,
  getRetention,
} = vi.hoisted(() => ({
  guardAdminAccess: vi.fn(),
  getPlatformSettingsMeta: vi.fn(),
  listAnnouncementsForAdmin: vi.fn(),
  listJobs: vi.fn(),
  getRetention: vi.fn(),
}));

vi.mock('@/contexts/ai-agent/prompts/system', () => ({
  PROMPT_HASH: '0123456789abcdef0123456789abcdef',
  PROMPT_VERSION: 'prompt-v42',
  RAW_TEMPLATE: 'Template global de teste',
}));

vi.mock('@/lib/env', () => ({
  env: {
    GEMINI_API_KEY: 'gemini-secret-test',
    META_APP_SECRET: undefined,
    META_WEBHOOK_VERIFY_TOKEN: 'meta-secret-test',
    META_TEMPLATE_CONFIRMATION_REMINDER_ID: 'reminder-template',
    META_TEMPLATE_DUNNING_FRIENDLY_ID: undefined,
    META_TEMPLATE_FOLLOWUP_RETURN_ID: 'followup-template',
    META_TEMPLATE_NO_SHOW_FOLLOWUP_ID: 'no-show-template',
    META_TEMPLATE_LANG: 'pt_BR',
    ASAAS_API_KEY: 'asaas-secret-test',
    ASAAS_WEBHOOK_TOKEN: undefined,
    CRON_SECRET: 'cron-secret-test',
    UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
    UPSTASH_REDIS_REST_TOKEN: 'redis-secret-test',
    CRYPTO_MASTER_KEY_V1: undefined,
    IMPERSONATION_SECRET: 'impersonation-secret-test',
    LOGIN_HASH_PEPPER: 'pepper-secret-test',
  },
}));

vi.mock('@/lib/platform-settings', () => ({
  PLATFORM_FLAG_KEYS: {
    proactiveEnabled: 'proactive_enabled',
    aiAgentMode: 'ai_agent_mode',
  },
  getPlatformSettingsMeta,
}));

vi.mock('@/lib/platform-announcements', () => ({ listAnnouncementsForAdmin }));
vi.mock('../_lib/guard', () => ({ guardAdminAccess }));
vi.mock('../_lib/repositories/jobs-health.repo', () => ({
  jobsHealthRepository: { list: listJobs },
}));
vi.mock('../_lib/repositories/retention.repo', () => ({
  retentionRepository: { get: getRetention },
}));

vi.mock('./operation-controls', () => ({
  FlagToggle: ({ flagKey, on, label }: { flagKey: string; on: boolean; label: string }) => (
    <button type="button" aria-label={label} aria-pressed={on} data-flag-key={flagKey}>
      {label}
    </button>
  ),
}));

vi.mock('./announcement-form', () => ({
  AnnouncementForm: () => <form aria-label="Compor aviso" />,
  DeactivateAnnouncementButton: ({ id }: { id: string }) => (
    <button type="button" data-announcement-id={id}>
      Desativar
    </button>
  ),
}));

import ConfigPage from './page';

const settingsRows = [
  {
    key: 'proactive_enabled',
    value: false,
    updatedAt: new Date('2026-08-20T12:00:00.000Z'),
  },
  {
    key: 'ai_agent_mode',
    value: 'fallback_only',
    updatedAt: new Date('2026-08-20T12:30:00.000Z'),
  },
];

const jobs = [
  {
    job: 'outbox',
    label: 'Outbox worker',
    cadence: 'a cada 1 min',
    lastRunAt: '2026-08-20T12:00:00.000Z',
    lastStatus: 'ok',
    health: 'ok',
  },
  {
    job: 'billing',
    label: 'Billing worker',
    cadence: 'a cada 15 min',
    lastRunAt: '2026-08-20T09:00:00.000Z',
    lastStatus: 'error',
    health: 'late',
  },
  {
    job: 'retention',
    label: 'Retention worker',
    cadence: 'mensal',
    lastRunAt: null,
    lastStatus: null,
    health: 'never',
  },
];

const retention = {
  partitions: [
    {
      parent: 'audit_events',
      count: 4,
      latest: '2026-10',
      monthsAhead: 2,
      defaultCount: 0,
    },
    {
      parent: 'ai_messages',
      count: 2,
      latest: '2026-08',
      monthsAhead: 0,
      defaultCount: 3,
    },
  ],
  idempotencyExpired: 12,
  proactiveByStatus: [{ status: 'pending', n: 5 }],
};

const announcements = [
  {
    id: 'announcement-1',
    title: 'Manutenção programada',
    message: 'Sistema indisponível por dez minutos',
    level: 'warning',
    createdAt: '2026-08-20T12:00:00.000Z',
    endsAt: '2026-08-21T12:00:00.000Z',
  },
];

async function renderTab(tab?: string) {
  return render(await ConfigPage({ searchParams: Promise.resolve(tab ? { tab } : {}) }));
}

function expectNoLegacyStructures(container: HTMLElement) {
  expect(
    container.querySelector(
      '.cardblock, .cardblock-head, .listrows, .listrow, .lr-main, .lr-sub, .lr-end, .st-ico, .hc-dot',
    ),
  ).toBeNull();
}

describe('ConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardAdminAccess.mockResolvedValue(undefined);
    getPlatformSettingsMeta.mockResolvedValue(settingsRows);
    listJobs.mockResolvedValue(jobs);
    getRetention.mockResolvedValue(retention);
    listAnnouncementsForAdmin.mockResolvedValue(announcements);
  });

  afterEach(() => {
    cleanup();
  });

  it('renderiza operação por padrão, preserva as flags e marca a navegação atual', async () => {
    const { container } = await renderTab('desconhecida');

    const navigation = screen.getByRole('navigation', { name: 'Seções de configuração' });
    expect(within(navigation).getAllByRole('link')).toHaveLength(6);
    expect(within(navigation).getByRole('link', { name: 'Operação' }).getAttribute('href')).toBe(
      '/admin/config?tab=operacao',
    );
    expect(
      within(navigation).getByRole('link', { name: 'Operação' }).getAttribute('aria-current'),
    ).toBe('page');

    const section = screen.getByRole('region', { name: 'Kill-switches operacionais' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    expect(within(section).getByText('Jobs proativos')).toBeTruthy();
    expect(within(section).getByText('Desligado')).toBeTruthy();
    expect(within(section).getByText('Fallback')).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Alternar jobs proativos' })).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Alternar agente de IA' })).toBeTruthy();
    expect(getPlatformSettingsMeta).toHaveBeenCalledWith(['proactive_enabled', 'ai_agent_mode']);
    expect(listJobs).not.toHaveBeenCalled();
    expect(getRetention).not.toHaveBeenCalled();
    expect(listAnnouncementsForAdmin).not.toHaveBeenCalled();
    expectNoLegacyStructures(container);
  });

  it('renderiza saúde, status dos jobs e retenção sem carregar outras abas', async () => {
    const { container } = await renderTab('saude');

    const health = screen.getByRole('region', { name: 'Saúde dos jobs' });
    expect(within(health).getAllByRole('listitem')).toHaveLength(3);
    expect(within(health).getByText('Em dia')).toBeTruthy();
    expect(within(health).getByText('Atrasado')).toBeTruthy();
    expect(within(health).getByText('Sem registro')).toBeTruthy();

    const retentionSection = screen.getByRole('region', { name: 'Retenção & partições' });
    expect(within(retentionSection).getByText('audit_events')).toBeTruthy();
    expect(within(retentionSection).getByText(/4 partições · cobre \+2 mês/u)).toBeTruthy();
    expect(within(retentionSection).getByText('criar partição')).toBeTruthy();
    expect(within(retentionSection).getByText('default 3')).toBeTruthy();
    expect(within(retentionSection).getByText('12 a limpar')).toBeTruthy();
    expect(listJobs).toHaveBeenCalledOnce();
    expect(getRetention).toHaveBeenCalledOnce();
    expect(getPlatformSettingsMeta).not.toHaveBeenCalled();
    expect(listAnnouncementsForAdmin).not.toHaveBeenCalled();
    expectNoLegacyStructures(container);
  });

  it('renderiza a fila de broadcast e preserva o id da ação de desativação', async () => {
    const { container } = await renderTab('broadcast');

    expect(screen.getByRole('region', { name: 'Novo aviso' })).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Compor aviso' })).toBeTruthy();
    const queue = screen.getByRole('region', { name: 'Avisos ativos' });
    expect(within(queue).getAllByRole('listitem')).toHaveLength(1);
    expect(within(queue).getByText('Manutenção programada')).toBeTruthy();
    expect(within(queue).getByText(/Sistema indisponível por dez minutos/u)).toBeTruthy();
    expect(
      within(queue).getByRole('button', { name: 'Desativar' }).getAttribute('data-announcement-id'),
    ).toBe('announcement-1');
    expect(listAnnouncementsForAdmin).toHaveBeenCalledOnce();
    expect(getPlatformSettingsMeta).not.toHaveBeenCalled();
    expect(listJobs).not.toHaveBeenCalled();
    expect(getRetention).not.toHaveBeenCalled();
    expectNoLegacyStructures(container);
  });

  it('mostra estado vazio compacto quando não há broadcast ativo', async () => {
    listAnnouncementsForAdmin.mockResolvedValue([]);

    const { container } = await renderTab('broadcast');

    expect(screen.getByText('Nenhum aviso ativo.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Desativar' })).toBeNull();
    expectNoLegacyStructures(container);
  });

  it('mostra somente presença das integrações, sem expor valores secretos', async () => {
    const { container } = await renderTab('integracoes');

    expect(screen.getByRole('region', { name: 'IA' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'WhatsApp (Meta)' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Pagamentos (Asaas)' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Infra & segurança' })).toBeTruthy();
    expect(screen.getAllByText('Configurado')).toHaveLength(10);
    expect(screen.getAllByText('Pendente')).toHaveLength(4);
    for (const secret of [
      'gemini-secret-test',
      'meta-secret-test',
      'asaas-secret-test',
      'cron-secret-test',
      'redis-secret-test',
      'impersonation-secret-test',
      'pepper-secret-test',
    ]) {
      expect(screen.queryByText(secret)).toBeNull();
    }
    expect(getPlatformSettingsMeta).not.toHaveBeenCalled();
    expect(listJobs).not.toHaveBeenCalled();
    expect(getRetention).not.toHaveBeenCalled();
    expect(listAnnouncementsForAdmin).not.toHaveBeenCalled();
    expectNoLegacyStructures(container);
  });

  it('preserva prompt, versão e hash no modo somente leitura', async () => {
    const { container } = await renderTab('prompt');

    expect(screen.getByRole('region', { name: 'Prompt do sistema · global' })).toBeTruthy();
    expect(screen.getByText('Template global de teste')).toBeTruthy();
    expect(screen.getAllByText('prompt-v42')).toHaveLength(2);
    expect(screen.getByText('0123456789abcdef01234567…')).toBeTruthy();
    expect(screen.getByText('somente leitura')).toBeTruthy();
    expectNoLegacyStructures(container);
  });

  it('preserva templates, idioma, ids configurados e estados pendentes', async () => {
    const { container } = await renderTab('emails');

    const section = screen.getByRole('region', { name: 'Templates (Meta WhatsApp)' });
    expect(within(section).getByText('Idioma pt_BR')).toBeTruthy();
    expect(within(section).getAllByRole('listitem')).toHaveLength(4);
    expect(within(section).getByText('Lembrete (confirmação)')).toBeTruthy();
    expect(within(section).getByText('Dunning (cobrança)')).toBeTruthy();
    expect(within(section).getByText('Follow-up (retorno)')).toBeTruthy();
    expect(within(section).getByText('Recuperação após falta')).toBeTruthy();
    expect(within(section).getByText('reminder-template')).toBeTruthy();
    expect(within(section).getByText('followup-template')).toBeTruthy();
    expect(within(section).getByText('no-show-template')).toBeTruthy();
    expect(within(section).getAllByText('Configurado')).toHaveLength(3);
    expect(within(section).getByText('Pendente')).toBeTruthy();
    expectNoLegacyStructures(container);
  });

  it('não inicia leituras quando o guard admin bloqueia a rota', async () => {
    guardAdminAccess.mockRejectedValue(new Error('forbidden'));

    await expect(ConfigPage({ searchParams: Promise.resolve({ tab: 'saude' }) })).rejects.toThrow(
      'forbidden',
    );

    expect(getPlatformSettingsMeta).not.toHaveBeenCalled();
    expect(listJobs).not.toHaveBeenCalled();
    expect(getRetention).not.toHaveBeenCalled();
    expect(listAnnouncementsForAdmin).not.toHaveBeenCalled();
  });
});

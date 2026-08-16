/**
 * RBAC-001 — guard de CI contra permission code ÓRFÃO.
 *
 * O achado: `export:audit` e `manage:agent` existiam no catálogo, apareciam no
 * diálogo de permissões e completavam grant/deny/default, mas NENHUMA página ou
 * action os consumia. O owner podia delegar e revogar uma capacidade sem efeito
 * observável — a matriz de least privilege virava enganosa e a auditoria de
 * acesso, mais difícil. A causa foi drift: as features evoluíram e os codes
 * antigos ficaram sem remoção nem remapeamento.
 *
 * Este teste falha quando um code novo nasce sem enforcement e sem allowlist
 * explícita. Ele NÃO substitui a implementação das capacidades — só impede que
 * o mesmo drift volte em silêncio.
 *
 * O que conta como enforcement: uma referência a `PERMISSIONS.<CODE>` em código
 * de produção FORA do catálogo e do diálogo de permissões da Equipe. O diálogo
 * é excluído de propósito: ele lista todos os codes por construção, então
 * aceitá-lo como consumidor tornaria o guard sempre verde — que é exatamente
 * como o drift passou despercebido.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from './permissions';

const SRC = resolve(process.cwd(), 'src');

/**
 * O catálogo e quem o ENUMERA não provam enforcement.
 *
 * A exclusão é por ARQUIVO, não por diretório: `equipe/page.tsx` e
 * `equipe/actions.ts` aplicam gates de verdade (`manage:employees`,
 * `manage:permissions`) e contam. Só o diálogo que lista todos os codes por
 * construção fica de fora — aceitá-lo tornaria o guard sempre verde, que é
 * como o drift passou despercebido.
 */
const NOT_ENFORCEMENT = [
  'src/lib/auth/permissions.ts',
  'src/lib/auth/claims.ts',
  'src/app/(app)/(shell)/equipe/member-row-actions.tsx',
];
const NOT_ENFORCEMENT_DIRS: string[] = [];

/**
 * Exceções — cada uma precisa ser explícita, justificada e DATADA.
 *
 * Vazia hoje: `export:audit` e `manage:agent` deixaram de ser órfãos nesta
 * mesma remediação (export de auditoria tenant e configuração do agente). Um
 * code novo que precise entrar aqui deve trazer a razão e a data no comentário.
 */
const ALLOWLIST: Record<string, { reason: string; since: string }> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(full))) out.push(full);
  }
  return out;
}

const files = walk(SRC).filter((file) => {
  const rel = relative(process.cwd(), file).replaceAll('\\', '/');
  if (NOT_ENFORCEMENT.includes(rel)) return false;
  if (NOT_ENFORCEMENT_DIRS.some((dir) => rel.startsWith(dir))) return false;
  // Testes não provam que a aplicação aplica a permissão.
  return !rel.includes('.test.');
});

const sources = files.map((file) => readFileSync(file, 'utf8'));

/** Chaves do catálogo (`EXPORT_AUDIT`) → code (`export:audit`). */
const CATALOG = Object.entries(PERMISSIONS) as Array<[string, string]>;

function enforcementPointsFor(key: string): number {
  const needle = `PERMISSIONS.${key}`;
  return sources.filter((source) => source.includes(needle)).length;
}

describe('RBAC-001 — nenhuma permissão sem consumidor', () => {
  it('o catálogo não está vazio e o scan encontrou arquivos', () => {
    expect(CATALOG.length).toBeGreaterThan(20);
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(CATALOG)('%s (%s) tem enforcement em código de produção', (key, code) => {
    const allowed = ALLOWLIST[code];
    const points = enforcementPointsFor(key);
    if (allowed) {
      // Allowlist é dívida declarada, não desculpa permanente.
      expect(allowed.reason.length, `${code}: allowlist precisa de razão`).toBeGreaterThan(20);
      expect(allowed.since, `${code}: allowlist precisa de data`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      return;
    }
    expect(
      points,
      `${code} não é consumido por nenhuma página/action fora do catálogo e do diálogo de permissões. ` +
        'Ligue-o a um gate real ou adicione-o à ALLOWLIST com razão e data.',
    ).toBeGreaterThan(0);
  });
});

describe('RBAC-001 — as duas capacidades do achado são reais e SEPARADAS', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

  it('export:audit gateia um export tenant, não o de plataforma', () => {
    const page = read('src/app/(app)/(shell)/configuracoes/auditoria/page.tsx');
    const action = read('src/app/(app)/(shell)/configuracoes/auditoria/actions.ts');
    expect(page).toContain('pageGate([PERMISSIONS.EXPORT_AUDIT])');
    expect(action).toContain('requireFreshPermission(PERMISSIONS.EXPORT_AUDIT)');
    // Tenant-scoped: o clinicId vem do request, nunca do cliente.
    expect(action).toContain('await requireClinicId()');
    expect(action).not.toContain('clinicId: input');
    // Não empresta a superfície de super-admin.
    expect(action).not.toContain('requireSuperAdmin');
    expect(action).not.toContain('audit-export.service');
  });

  it('o export tenant não vaza o conteúdo alterado (LGPD)', () => {
    const lib = read('src/lib/audit/tenant-export.ts');
    expect(lib).toContain('withTenant(clinicId');
    // `before`/`after` carregam estado de registro de paciente.
    expect(lib).not.toContain('auditEvents.before');
    expect(lib).not.toContain('auditEvents.after');
  });

  it('manage:agent gateia capacidade PRÓPRIA — sem alias para manage:settings', () => {
    const page = read('src/app/(app)/(shell)/configuracoes/agente/page.tsx');
    const actions = read('src/contexts/ai-agent/config-actions.ts');
    expect(page).toContain('pageGate([PERMISSIONS.MANAGE_AGENT])');
    expect(actions).toContain('requireFreshPermission(PERMISSIONS.MANAGE_AGENT)');
    // O alias silencioso é justamente o que o achado proíbe.
    expect(page).not.toContain('MANAGE_SETTINGS');
    expect(actions).not.toContain('MANAGE_SETTINGS');
  });

  it('manage:agent controla parâmetros que o agente REALMENTE lê', () => {
    // Nada de escopo inventado só para o code aparecer como usado: estes
    // campos alimentam o context-builder e a tool provide_clinic_info.
    const actions = read('src/contexts/ai-agent/config-actions.ts');
    const contextBuilder = read('src/contexts/ai-agent/internal/context-builder.ts');
    expect(actions).toContain('aiClinicConfig');
    expect(actions).toContain('canDisclosePaymentsViaAgent');
    expect(actions).toContain('maxDaysAhead');
    expect(contextBuilder).toContain('aiClinicConfig');
  });

  it('a conexão do WhatsApp CONTINUA em manage:settings — as duas não se fundiram', () => {
    const whatsapp = read('src/app/(app)/(shell)/configuracoes/whatsapp/page.tsx');
    expect(whatsapp).toContain('pageGate([PERMISSIONS.MANAGE_SETTINGS])');
  });
});

describe('RBAC-001 — bundle do perfil Financeiro', () => {
  it('a migration remove export:audit do financial e bumpa o epoch', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'drizzle/migrations/0076_financial_audit_export_least_privilege.sql'),
      'utf8',
    );
    expect(migration).toContain('DELETE FROM role_permissions');
    expect(migration).toContain("role = 'financial' AND permission_code = 'export:audit'");
    // Sem o bump, o JWT em uso continuaria apresentando a permissão removida.
    expect(migration).toContain('claims_version = claims_version + 1');
    expect(migration).toContain("WHERE role = 'financial'");
  });

  it('o code permanece no catálogo — a decisão foi de BUNDLE, não de remoção', () => {
    // Remover do catálogo quebraria os overrides já persistidos e tiraria do
    // owner a opção de delegar explicitamente.
    expect(PERMISSIONS.EXPORT_AUDIT).toBe('export:audit');
    expect(PERMISSIONS.MANAGE_AGENT).toBe('manage:agent');
  });
});

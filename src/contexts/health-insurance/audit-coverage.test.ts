/**
 * P12.4 — auditoria completa: TODA server action de Convênios grava trilha (`logAudit`) na mesma
 * transação do efeito, direto, pelo helper `write` ou pelo serviço que ela chama, e TODA rota de
 * download chama a leitura auditada. A exceção é explícita, com o motivo (leitura sem dado da clínica
 * ou do paciente, ou etapa transitória cujo efeito final é auditado). Guarda estática: uma action
 * nova sem trilha reprova aqui.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** Funções de topo (declaração `function`) do arquivo: nome → corpo, até a chave na coluna 0. */
function functionsOf(text: string): Map<string, { exported: boolean; body: string }> {
  const out = new Map<string, { exported: boolean; body: string }>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(export )?(?:async )?function\*? (\w+)/u.exec(lines[i]!);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && lines[j] !== '}') j++;
    out.set(m[2]!, { exported: Boolean(m[1]), body: lines.slice(i, j + 1).join('\n') });
    i = j;
  }
  return out;
}

function tsFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) return tsFiles(rel);
    return /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name) ? [rel] : [];
  });
}

/** Índice global das funções do módulo (serviços e actions), para seguir a chamada até o `logAudit`. */
const index = new Map<string, Array<{ file: string; body: string }>>();
for (const file of tsFiles('src/contexts/health-insurance')) {
  for (const [name, f] of functionsOf(read(file))) {
    index.set(name, [...(index.get(name) ?? []), { file, body: f.body }]);
  }
}

const callees = (body: string) => [...body.matchAll(/\b(\w+)\(/gu)].map((m) => m[1]!);

/** A função grava trilha: chama `logAudit` ou outra função do módulo que grava (busca em profundidade). */
function audits(body: string, local: Map<string, { body: string }>, seen = new Set<string>()): boolean {
  if (/\blogAudit\(/u.test(body)) return true;
  return callees(body).some((name) => {
    if (seen.has(name)) return false;
    seen.add(name);
    const defs = local.has(name) ? [local.get(name)!] : (index.get(name) ?? []);
    return defs.some((d) => audits(d.body, local, seen));
  });
}

const ACTION_FILES = [
  'src/contexts/health-insurance/actions.ts',
  'src/contexts/health-insurance/config-actions.ts',
  'src/app/(app)/(shell)/convenios/_lib/batch-export-actions.ts',
  'src/app/(app)/(shell)/convenios/_lib/copay-review-actions.ts',
];

/** Sem trilha própria, com o motivo. Qualquer outra action sem trilha reprova. */
const NO_AUDIT_BY_DESIGN: Record<string, string> = {
  searchOfficialTermsAction: 'busca no catálogo público da ANS (terminologia TISS), sem dado da clínica nem do paciente',
  listSchedulingCardsAction: 'lista só a carteirinha mascarada (últimos 4) para escolher no agendamento; o número completo sai por readMembershipCardNumberAudited',
  beginAuthorizationReceiptUploadAction: 'abre o envio em partes (token assinado, nada gravado no banco); o comprovante só existe pela finishAuthorizationReceiptUploadAction, auditada',
  uploadAuthorizationReceiptChunkAction: 'parte temporária no armazenamento privado, sem efeito no registro; o fecho é auditado',
  abortAuthorizationReceiptUploadAction: 'descarta partes temporárias do próprio envio; nenhum comprovante é criado nem apagado',
  loadSessionExtraItemsAction:
    'leitura do consultório (P8.4-r): itens da própria sessão sem valor, sem decisão de faturamento e sem dado clínico; o registro sai por recordOwnSessionExtraItemAction, auditada',
};

describe('auditoria completa das actions e downloads de Convênios (P12.4)', () => {
  it('toda server action exportada grava trilha na transação do efeito (ou está na lista de exceções, com o motivo)', () => {
    const missing: string[] = [];
    const exempted: string[] = [];
    let total = 0;
    for (const file of ACTION_FILES) {
      const local = functionsOf(read(file));
      for (const [name, f] of local) {
        if (!f.exported || !name.endsWith('Action')) continue;
        total += 1;
        if (audits(f.body, local)) continue;
        if (NO_AUDIT_BY_DESIGN[name]) exempted.push(name);
        else missing.push(`${file}#${name}`);
      }
    }
    expect(total).toBeGreaterThanOrEqual(80);
    expect(missing).toEqual([]);
    // A lista de exceções não acumula nome morto nem action que passou a auditar.
    expect(exempted.sort()).toEqual(Object.keys(NO_AUDIT_BY_DESIGN).sort());
  });

  it('o helper `write` das actions grava a trilha depois do efeito, na mesma transação', () => {
    for (const file of ACTION_FILES.slice(0, 2)) {
      const body = functionsOf(read(file)).get('write')!.body;
      expect(body, file).toMatch(/withTenant\(/u);
      expect(body.indexOf('logAudit('), file).toBeGreaterThan(body.indexOf('await fn('));
    }
  });

  it('a leitura do XML do pedido de cancelamento é auditada (achado da P12.4, corrigido)', () => {
    const body = functionsOf(read(ACTION_FILES[0]!)).get('readGuideCancellationXmlAction')!.body;
    expect(body).toMatch(/write\('health_insurance\.guide\.substitution_xml_read'/u);
  });

  it('toda rota de download de Convênios chama a leitura auditada', () => {
    const routes = tsFiles('src/app/(app)/(shell)/financeiro/convenios').filter((f) => f.endsWith('/route.ts'));
    expect(routes.length).toBeGreaterThanOrEqual(5);
    for (const file of routes) {
      const local = functionsOf(read(file));
      const handler = local.get('GET');
      expect(handler, file).toBeDefined();
      expect(audits(handler!.body, local), file).toBe(true);
    }
  });
});

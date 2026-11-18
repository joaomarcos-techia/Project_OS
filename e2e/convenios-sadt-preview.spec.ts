/**
 * SP/SADT — jornada pela tela no Preview ligado ao DEV (navegador remoto). Clínica sintética
 * `e2e-hi-sadt` (fixture `setup-sadt --run <MARCA>`), contrato de psicoterapia que exige autorização.
 *
 * Fase 1 (`E2E_HI_SADT_PHASE=1`):
 *   1. recepção registra a solicitação (paciente e carteirinha, solicitante da clínica, procedimento
 *      do contrato, quantidade) e confere: vai para "Aguardando a operadora";
 *   2. a médica solicitante informa a indicação clínica (cifrada; a recepção nunca a vê);
 *   3. outra médica não abre a solicitação e o servidor recusa a indicação dela;
 *   4. recepção gera o documento oficial: XML validado no XSD (baixado e conferido) e PDF;
 *   5. recepção registra a resposta SINTÉTICA da operadora (concedeu 8 de 10, senha e validade);
 *   6. recepção liga as três sessões de hoje à solicitação;
 *   7. financeiro não registra solicitação (o servidor recusa a action chamada direto);
 *   8. outra clínica não vê a solicitação nem registra com dado desta; sem sessão, nada abre.
 * Entre as fases, a fixture `complete-sadt` conclui as sessões ligadas pelo caminho real.
 * Fase 2 (`E2E_HI_SADT_PHASE=2`, `E2E_HI_SADT_REQUEST=<id>`):
 *   9. a guia SP/SADT nasceu das três sessões; a gestora confere, aprova, monta o lote SP/SADT, gera o
 *      XML (validado no XSD, baixado e conferido), registra o envio e o protocolo; a solicitação
 *      mostra 3 de 10 executadas e a guia na operadora;
 *  10. recepção vê a guia, sem os controles de faturamento.
 *
 * Nada é transmitido a operadora nenhuma: resposta, envio e protocolo são registros sintéticos.
 */
import { readFileSync } from 'node:fs';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

const BASE = process.env.E2E_BASE_URL;
const ACCOUNTS = process.env.E2E_HI_SADT_ACCOUNTS;
const OTHER_ACCOUNTS = process.env.E2E_HI_ACCOUNTS;
const STATE = process.env.E2E_HI_SADT;
const PHASE = process.env.E2E_HI_SADT_PHASE ?? '1';
const REQUEST = process.env.E2E_HI_SADT_REQUEST;

test.skip(!BASE || !ACCOUNTS || !OTHER_ACCOUNTS || !STATE, 'requer E2E_BASE_URL (Preview no DEV) e a fixture setup-sadt');
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 45_000 });

type Account = { email: string; password: string; userId: string; clinic: string; role: string };
const accounts: Record<string, Account> = {
  ...(ACCOUNTS ? (JSON.parse(readFileSync(ACCOUNTS, 'utf8')) as Record<string, Account>) : {}),
  ...(OTHER_ACCOUNTS ? { 'outra-gestor': (JSON.parse(readFileSync(OTHER_ACCOUNTS, 'utf8')) as Record<string, Account>).gestor! } : {}),
};
const fx = STATE
  ? (JSON.parse(readFileSync(STATE, 'utf8')) as {
      run: string; today: string; insurerName: string; patientName: string; cardLast4: string; procedureCode: string;
    })
  : null;
const INTERNAL = /(?:\bat\s+\S+\s+\(|node_modules|drizzle|postgres|SQLSTATE|stack)/iu;

type Session = { context: BrowserContext; page: Page; errors: string[] };
const sessions = new Map<string, Session>();
async function session(browser: Browser, key: string): Promise<Session> {
  const open = sessions.get(key);
  if (open) return open;
  const account = accounts[key];
  if (!account) throw new Error(`conta ${key} ausente na fixture`);
  const context = await browser.newContext({ baseURL: BASE!, extraHTTPHeaders: vercelBypassHeaders() });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.message} @ ${new URL(page.url()).pathname}`));
  await page.goto('/login', { waitUntil: 'load' });
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  const s = { context, page, errors };
  sessions.set(key, s);
  return s;
}
test.beforeAll(async () => {
  await assertPreviewRuntimeIsDev(BASE!);
});
test.afterAll(async () => {
  for (const s of sessions.values()) await s.context.close();
});

async function done(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 60_000 });
}
type Captured = { id: string; body: string; contentType: string; routerTree?: string | undefined };
async function capture(page: Page, marker: string, trigger: () => Promise<void>): Promise<Captured> {
  let got: Captured | null = null;
  const handler = async (route: import('@playwright/test').Route) => {
    const req = route.request();
    const h = req.headers();
    const body = req.postData();
    if (req.method() === 'POST' && h['next-action'] && body?.includes(marker) && !got) {
      got = { id: h['next-action'], body, contentType: h['content-type'] ?? 'text/plain;charset=UTF-8', routerTree: h['next-router-state-tree'] };
    }
    return route.continue();
  };
  await page.route('**/*', handler);
  try {
    await trigger();
    await expect.poll(() => got !== null, { timeout: 30_000 }).toBe(true);
  } finally {
    await page.unroute('**/*', handler);
  }
  return got!;
}
async function replay(page: Page, action: Captured, body = action.body): Promise<{ status: number; text: string }> {
  return page.evaluate(
    async ({ id, b, contentType, routerTree }) => {
      const headers: Record<string, string> = { 'Next-Action': id, 'Content-Type': contentType, Accept: 'text/x-component' };
      if (routerTree) headers['Next-Router-State-Tree'] = routerTree;
      const r = await fetch(location.pathname, { method: 'POST', headers, body: b });
      return { status: r.status, text: await r.text() };
    },
    { id: action.id, b: body, contentType: action.contentType, routerTree: action.routerTree },
  );
}
function expectRefused(res: { text: string }) {
  expect(res.text).toContain('"ok":false');
  expect(res.text).not.toContain('"ok":true');
  expect(res.text).not.toMatch(INTERNAL);
}
/** Baixa um arquivo do app pela sessão da página (mesmos cookies), sem abrir aba. */
async function fetchFile(page: Page, href: string): Promise<{ status: number; type: string; text: string }> {
  return page.evaluate(async (u) => {
    const r = await fetch(u);
    const buf = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get('content-type') ?? '', text: new TextDecoder('latin1').decode(buf) };
  }, href);
}
const plusDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const situation = (page: Page) => page.getByRole('region', { name: 'Situação da solicitação' });

let requestPath = REQUEST ? `/convenios/solicitacoes/${REQUEST}` : '';
let createAction: Captured | null = null;
let indicationAction: Captured | null = null;

test.describe('fase 1: solicitação, indicação, documento, autorização e sessões pela tela', () => {
  test.skip(PHASE !== '1', 'fase 2 nesta execução');

  test('recepção registra a solicitação e confere: aguardando a operadora', async ({ browser }) => {
    test.setTimeout(240_000);
    const s = await session(browser, 'sadt-recepcao');
    await s.page.goto('/convenios/solicitacoes');
    const form = s.page.getByRole('region', { name: 'Nova solicitação' });
    const card = form.getByLabel('Paciente e carteirinha');
    const cardValue = await card.locator('option', { hasText: fx!.patientName }).first().getAttribute('value');
    await card.selectOption(cardValue!);
    await form.getByLabel('Data da solicitação').fill(fx!.today);
    const prof = form.getByLabel('Profissional solicitante');
    await prof.selectOption((await prof.locator('option', { hasText: 'Dra. Solicitante SP/SADT E2E' }).first().getAttribute('value'))!);
    await form.getByLabel('Procedimento 1').selectOption(`22:${fx!.procedureCode}`);
    await form.getByLabel('Quantidade').fill('10');
    await form.getByLabel('Observação administrativa (opcional)').fill(`Pedido sintético ${fx!.run}`);
    createAction = await capture(s.page, fx!.procedureCode, async () => {
      await form.getByRole('button', { name: 'Registrar solicitação' }).click();
    });
    await s.page.waitForURL(/\/convenios\/solicitacoes\/[0-9a-f-]{36}$/u, { timeout: 60_000 });
    requestPath = new URL(s.page.url()).pathname;
    console.log(`SADT_REQUEST ${requestPath.split('/').pop()}`);
    await expect(situation(s.page)).toContainText('Rascunho');
    await expect(situation(s.page)).toContainText('não informada');
    await situation(s.page).getByRole('button', { name: 'Conferir solicitação' }).click();
    await done(s.page, 'Conferência registrada');
    await s.page.reload();
    await expect(situation(s.page)).toContainText('Aguardando a operadora');
    await expect(situation(s.page)).toContainText('exigida pelo contrato');
    await expect(s.page.getByRole('region', { name: 'Procedimentos solicitados' })).toContainText(fx!.procedureCode);
    expect(s.errors).toEqual([]);
  });

  test('médica solicitante informa a indicação clínica (cifrada; a recepção só vê que existe)', async ({ browser }) => {
    test.setTimeout(180_000);
    const s = await session(browser, 'sadt-medica');
    await s.page.goto(requestPath);
    await expect(situation(s.page)).toContainText('Aguardando a operadora');
    // A médica não tem os controles da recepção.
    await expect(s.page.getByRole('button', { name: 'Registrar autorização da operadora' })).toHaveCount(0);
    await situation(s.page).getByRole('button', { name: 'Informar indicação clínica' }).click();
    const text = `Indicação sintética de teste ${fx!.run}: psicoterapia semanal.`;
    await situation(s.page).getByLabel('Indicação clínica').fill(text);
    indicationAction = await capture(s.page, 'psicoterapia semanal', async () => {
      await situation(s.page).getByRole('button', { name: 'Confirmar' }).click();
    });
    await done(s.page, 'Indicação registrada');
    await s.page.reload();
    await expect(situation(s.page)).toContainText('informada (cifrada)');
    const r = await session(browser, 'sadt-recepcao');
    await r.page.goto(requestPath);
    await expect(situation(r.page)).toContainText('informada (cifrada)');
    await expect(r.page.locator('body')).not.toContainText(text);
    expect(s.errors).toEqual([]);
  });

  test('outra médica: não abre a solicitação e o servidor recusa a indicação dela', async ({ browser }) => {
    const s = await session(browser, 'sadt-medica2');
    const res = await s.page.goto(requestPath);
    expect(res?.status()).toBe(404);
    await s.page.goto('/convenios/solicitacoes');
    expectRefused(await replay(s.page, indicationAction!, indicationAction!.body.replace('psicoterapia semanal', 'texto de outra profissional')));
  });

  test('recepção gera o documento oficial: XML validado no XSD (baixado) e PDF', async ({ browser }) => {
    test.setTimeout(240_000);
    const s = await session(browser, 'sadt-recepcao');
    await s.page.goto(requestPath);
    const doc = s.page.getByRole('region', { name: 'Documento oficial do pedido à operadora' });
    await doc.getByRole('button', { name: 'Gerar documento oficial' }).click();
    await done(s.page, 'Documento gerado e validado no XSD');
    await s.page.reload();
    const xmlHref = await doc.getByRole('link', { name: 'Baixar XML (TISS)' }).getAttribute('href');
    const xml = await fetchFile(s.page, xmlHref!);
    expect(xml.status).toBe(200);
    expect(xml.text).toContain('4.03.00');
    expect(xml.text).toMatch(/solicitacaoSP-SADT|solicitacaoSPSADT/u);
    expect(xml.text).toContain(fx!.procedureCode);
    const pdf = await fetchFile(s.page, (await doc.getByRole('link', { name: 'Abrir PDF' }).getAttribute('href'))!);
    expect(pdf.status).toBe(200);
    expect(pdf.type).toContain('application/pdf');
    expect(pdf.text.startsWith('%PDF')).toBe(true);
    expect(s.errors).toEqual([]);
  });

  test('recepção registra a resposta sintética da operadora (8 de 10, senha e validade)', async ({ browser }) => {
    test.setTimeout(180_000);
    const s = await session(browser, 'sadt-recepcao');
    await s.page.goto(requestPath);
    await situation(s.page).getByRole('button', { name: 'Registrar autorização da operadora' }).click();
    await s.page.getByLabel('Data da autorização').fill(fx!.today);
    await s.page.getByLabel('Número da guia na operadora').fill(`OPS${fx!.run}`.slice(0, 20));
    await s.page.getByLabel('Senha', { exact: true }).fill(`SENHA${fx!.run}`.slice(0, 20));
    await s.page.getByLabel('Validade da senha').fill(plusDays(fx!.today, 30));
    await s.page.getByLabel(new RegExp(`${fx!.procedureCode}.*\\(pedido: 10\\)`, 'u')).fill('8');
    await situation(s.page).getByRole('button', { name: 'Confirmar' }).click();
    await done(s.page, 'Autorização registrada');
    await s.page.reload();
    await expect(situation(s.page)).toContainText('Autorizada em parte');
    const resp = s.page.getByRole('region', { name: 'Resposta da operadora' });
    await expect(resp).toContainText(`OPS${fx!.run}`.slice(0, 20));
    await expect(resp).toContainText('registrada, válida até');
    await expect(resp).not.toContainText(`SENHA${fx!.run}`);
    await expect(s.page.getByRole('region', { name: 'Procedimentos solicitados' }).getByRole('row').nth(1)).toContainText('8');
    expect(s.errors).toEqual([]);
  });

  test('recepção liga as três sessões de hoje à solicitação', async ({ browser }) => {
    test.setTimeout(240_000);
    const s = await session(browser, 'sadt-recepcao');
    for (let i = 0; i < 3; i++) {
      await s.page.goto(requestPath);
      const proc = s.page.getByRole('region', { name: 'Procedimentos solicitados' });
      await proc.getByRole('button', { name: 'Ligar sessão' }).click();
      await done(s.page, 'Sessão ligada à solicitação');
    }
    await s.page.goto(requestPath);
    await expect(s.page.getByRole('region', { name: 'Procedimentos solicitados' })).toContainText(
      'Nenhum atendimento de convênio agendado deste paciente sem sessão ligada.',
    );
    await expect(s.page.getByRole('region', { name: 'Guias da solicitação' })).toContainText('Nenhuma sessão executada ainda');
    expect(s.errors).toEqual([]);
  });

  test('financeiro não registra solicitação: o servidor recusa a action chamada direto', async ({ browser }) => {
    const s = await session(browser, 'sadt-financeiro');
    await s.page.goto('/convenios/solicitacoes');
    await expect(s.page.getByRole('region', { name: 'Nova solicitação' })).toHaveCount(0);
    expectRefused(await replay(s.page, createAction!));
  });

  test('outra clínica não vê a solicitação nem registra com a carteirinha desta; sem sessão, nada abre', async ({ browser }) => {
    const s = await session(browser, 'outra-gestor');
    const res = await s.page.goto(requestPath);
    expect(res?.status()).toBe(404);
    await s.page.goto('/convenios/solicitacoes');
    expectRefused(await replay(s.page, createAction!));
    const anon = await browser.newContext({ baseURL: BASE!, extraHTTPHeaders: vercelBypassHeaders() });
    const p = await anon.newPage();
    await p.goto(requestPath);
    await expect(p).toHaveURL(/\/login/u);
    await anon.close();
  });
});

test.describe('fase 2: guia SP/SADT das sessões concluídas, lote, XML e protocolo', () => {
  test.skip(PHASE !== '2' || !REQUEST, 'fase 1 nesta execução (ou sem E2E_HI_SADT_REQUEST)');

  test('gestora: guia nascida das 3 sessões; confere, aprova, lote SP/SADT, XML no XSD, envio e protocolo', async ({ browser }) => {
    test.setTimeout(480_000);
    const s = await session(browser, 'sadt-gestor');
    await s.page.goto(requestPath);
    await expect(situation(s.page)).toContainText('3 de 10');
    const guides = s.page.getByRole('region', { name: 'Guias da solicitação' });
    await expect(guides).toContainText('3 sessão(ões)');
    await guides.getByRole('link').first().click();
    await s.page.waitForURL(/\/convenios\/guias\/[0-9a-f-]{36}$/u, { timeout: 60_000 });
    const guidePath = new URL(s.page.url()).pathname;
    if (await s.page.getByRole('button', { name: 'Marcar como conferida' }).isVisible().catch(() => false)) {
      await s.page.getByRole('button', { name: 'Marcar como conferida' }).click();
      await done(s.page, 'Guia conferida');
      await s.page.reload();
    }
    await s.page.getByRole('button', { name: 'Aprovar e emitir' }).click();
    await done(s.page, 'Guia aprovada e emitida');

    await s.page.goto('/convenios/lotes');
    const ins = s.page.getByLabel('Operadora').first();
    await ins.selectOption((await ins.locator('option', { hasText: fx!.insurerName }).first().getAttribute('value'))!);
    await s.page.getByLabel('Tipo de guia').selectOption('sp_sadt');
    await s.page.getByText('Todas (até 100)').click();
    await s.page.getByRole('button', { name: 'Montar lote' }).click();
    await s.page.waitForURL(/\/convenios\/lotes\/[0-9a-f-]{36}$/u, { timeout: 60_000 });
    const batch = new URL(s.page.url()).pathname;
    await s.page.getByRole('button', { name: 'Gerar e validar XML' }).click();
    await done(s.page, 'XML gerado e validado');
    await s.page.goto(batch);
    const xmlHref = await s.page.getByRole('link', { name: 'Baixar XML' }).first().getAttribute('href');
    const xml = await fetchFile(s.page, xmlHref!);
    expect(xml.status).toBe(200);
    expect(xml.text).toContain('4.03.00');
    expect(xml.text).toMatch(/guiaSP-SADT/u);
    expect(xml.text).toContain(fx!.procedureCode);
    expect(xml.text).toContain(`OPS${fx!.run}`.slice(0, 20));
    await s.page.getByRole('button', { name: 'Marcar como enviado' }).click();
    await s.page.getByLabel('Como o lote foi enviado').fill('Enviado pelo portal da operadora sintética, comprovante de teste');
    await s.page.getByRole('button', { name: 'Confirmar' }).click();
    await done(s.page, 'Envio registrado');
    await s.page.goto(batch);
    await s.page.getByRole('button', { name: 'Registrar protocolo' }).click();
    await s.page.getByLabel('Protocolo da operadora').fill(String(Date.now()).slice(-12));
    await s.page.getByLabel('Recibo emitido pela operadora').setInputFiles({
      name: 'recibo-sintetico.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(`%PDF-1.4\n% recibo sintetico de teste ${fx!.run}\n%%EOF\n`),
    });
    await s.page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await done(s.page, 'Protocolo registrado');
    await s.page.goto(guidePath);
    await expect(s.page.getByRole('button', { name: 'Aprovar e emitir' })).toHaveCount(0);
    await s.page.goto(requestPath);
    await expect(s.page.getByRole('region', { name: 'Guias da solicitação' })).not.toContainText('Pronta para conferir');
    expect(s.errors).toEqual([]);
  });

  test('recepção vê a guia da solicitação sem os controles de faturamento', async ({ browser }) => {
    const s = await session(browser, 'sadt-recepcao');
    await s.page.goto(requestPath);
    await s.page.getByRole('region', { name: 'Guias da solicitação' }).getByRole('link').first().click();
    await s.page.waitForURL(/\/convenios\/guias\/[0-9a-f-]{36}$/u, { timeout: 60_000 });
    await expect(s.page.getByRole('button', { name: 'Aprovar e emitir' })).toHaveCount(0);
    await expect(s.page.getByRole('link', { name: 'Ver PDF da guia' })).toHaveCount(0);
  });
});

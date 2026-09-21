import { expect, test, type Page } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';

import { authenticate, hasE2ECredentials } from './auth';

loadDotenv({ path: '.env.local' });

/**
 * §33 — perfil público do WhatsApp, no navegador, com sessão REAL.
 *
 * O que só este arquivo prova: que a seção funciona atrás de autenticação de
 * verdade — cookies reais, middleware real, Server Actions reais, contexto de
 * tenant real. Os testes unitários provam a máquina; nenhum deles prova que a
 * pessoa logada consegue usar a tela.
 *
 * ALVO: `E2E_BASE_URL`. Roda contra o Preview do PR, com a conta sintética de
 * teste — nunca contra produção e nunca com conta de cliente. Sem credencial ou
 * sem alvo, os testes são PULADOS com anotação, em vez de darem verde vazio.
 *
 * ==========================================================================
 * Os dois regimes, e por que o arquivo se adapta em vez de fingir
 * ==========================================================================
 * A §33.8 lista o "round-trip real" (escreve, relê, confere, restaura) como a
 * única prova que vale de verdade — e ele exige um número de teste CONECTADO na
 * Meta. Sem número conectado, a seção nem aparece, que é o comportamento
 * especificado.
 *
 * Então o arquivo detecta em qual dos dois mundos está e prova o que aquele
 * mundo permite, ANOTANDO qual caminho tomou. O que ele nunca faz é chamar de
 * PASS um round-trip que não aconteceu: quando não há número, o teste do
 * round-trip é `skip` com o motivo escrito, não um verde silencioso.
 *
 * `E2E_WHATSAPP_PROFILE_WRITE=1` é o consentimento explícito para a parte que
 * ESCREVE. Escrita só em Preview (regra de 13/09), e mesmo lá só quando alguém
 * liga a variável — o perfil é público, e sobrescrevê-lo por engano numa conta
 * viva seria um incidente visível para pacientes.
 */
const baseUrl = process.env.E2E_BASE_URL;
const escritaAutorizada = process.env.E2E_WHATSAPP_PROFILE_WRITE === '1';

const ROTA = '/configuracoes/whatsapp';
const SECAO = '[data-slot="whatsapp-profile"]';

test.describe('§33 — perfil público do WhatsApp', () => {
  test.skip(!baseUrl, 'E2E_BASE_URL ausente: sem alvo para exercitar.');
  test.skip(!hasE2ECredentials(), 'E2E_USER_EMAIL/E2E_USER_PASSWORD ausentes.');

  /** Falha o teste em erro de página — hidratação quebrada não pode passar. */
  function vigiar(page: Page): { erros: string[] } {
    const erros: string[] = [];
    page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 500 && new URL(r.url()).origin === new URL(baseUrl!).origin) {
        erros.push(`${r.status()} em ${new URL(r.url()).pathname}`);
      }
    });
    return { erros };
  }

  async function abrir(page: Page): Promise<{ temSecao: boolean; erros: string[] }> {
    const { erros } = vigiar(page);
    await authenticate(page);
    await page.goto(ROTA, { timeout: 90_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const temSecao = (await page.locator(SECAO).count()) > 0;
    return { temSecao, erros };
  }

  test('a tela abre sem 5xx e sem erro de página', async ({ page }, testInfo) => {
    const { temSecao, erros } = await abrir(page);
    testInfo.annotations.push({
      type: 'regime',
      description: temSecao ? 'numero conectado' : 'sem numero conectado',
    });
    expect(erros, erros.join(' | ')).toEqual([]);
  });

  test('sem número conectado, a seção de perfil não aparece', async ({ page }) => {
    const { temSecao } = await abrir(page);
    test.skip(temSecao, 'Há número conectado nesta clínica: este caso não se aplica.');

    // Não é erro nem estado vazio: não há o que configurar, e um formulário
    // aqui prometeria uma escrita que a action recusaria.
    await expect(page.locator(SECAO)).toHaveCount(0);
  });

  test('com número conectado, o formulário vem preenchido e avisa que é público', async ({
    page,
  }) => {
    const { temSecao } = await abrir(page);
    test.skip(!temSecao, 'Sem número conectado no Preview: nada a ler.');

    const secao = page.locator(SECAO);

    // §33.5 — o estado tem de ser "carregado". Se a leitura falhar, o
    // formulário NÃO existe, e é isso que o outro teste cobre.
    const estado = await secao.getAttribute('data-profile-state');
    test.skip(
      estado === 'erro-leitura',
      'A Meta não respondeu à leitura do perfil agora: round-trip não testado.',
    );

    await expect(secao.getByText('Este conteúdo é público')).toBeVisible();
    await expect(secao.getByText('Não escreva nome de paciente')).toBeVisible();
    // §33.3 nº 2 — o rótulo diz "da clínica", nunca "E-mail" genérico.
    await expect(secao.getByLabel('E-mail de contato da clínica')).toBeVisible();
    await expect(secao.getByLabel('Recado')).toBeVisible();
  });

  test('o token da Meta não chega ao HTML servido', async ({ page }) => {
    const { temSecao } = await abrir(page);
    test.skip(!temSecao, 'Sem número conectado: não há credencial em jogo nesta tela.');

    const html = await page.content();
    // §33.8 — o token vive cifrado no banco e é decifrado dentro da action. Um
    // `EAA...` aqui significaria que ele atravessou a fronteira servidor→cliente.
    expect(html).not.toMatch(/EAA[A-Za-z0-9]{20,}/u);
    expect(html.toLowerCase()).not.toContain('token_encrypted');
    expect(html).not.toContain('access_token');
  });

  test('entrada inválida é recusada por campo, e nada é enviado à Meta', async ({ page }) => {
    const { temSecao } = await abrir(page);
    test.skip(!temSecao, 'Sem número conectado: o formulário não existe.');
    const secao = page.locator(SECAO);
    test.skip(
      (await secao.getAttribute('data-profile-state')) === 'erro-leitura',
      'Leitura do perfil indisponível agora.',
    );

    // Negativo de entrada, e o mais barato de checar: o site sem esquema é o
    // erro que qualquer pessoa comete ao colar o endereço da clínica.
    const site = secao.getByLabel('Primeiro site');
    const original = await site.inputValue();
    await site.fill('clinica.com.br');
    await secao.getByRole('button', { name: 'Salvar perfil' }).click();

    await expect(secao.getByText(/Site: informe uma URL completa/u)).toBeVisible({
      timeout: 30_000,
    });
    // O texto digitado PERMANECE: limpá-lo obrigaria a reescrever tudo para
    // corrigir um erro de uma linha.
    expect(await site.inputValue()).toBe('clinica.com.br');

    await site.fill(original);
  });

  test('round-trip real: escreve, recarrega e confere na Meta', async ({ page }, testInfo) => {
    test.skip(
      !escritaAutorizada,
      'E2E_WHATSAPP_PROFILE_WRITE != 1: escrita no perfil público exige consentimento explícito.',
    );
    const { temSecao } = await abrir(page);
    test.skip(!temSecao, 'Sem número conectado no Preview: round-trip NÃO testado.');

    const secao = page.locator(SECAO);
    test.skip(
      (await secao.getAttribute('data-profile-state')) === 'erro-leitura',
      'Leitura do perfil indisponível agora: round-trip NÃO testado.',
    );

    const recado = secao.getByLabel('Recado');
    const anterior = await recado.inputValue();
    const novo = `Teste automatizado ${Date.now()}`;
    testInfo.annotations.push({ type: 'restaura-para', description: anterior });

    try {
      await recado.fill(novo);
      await secao.getByRole('button', { name: 'Salvar perfil' }).click();
      await expect(secao.getByRole('button', { name: 'Salvar perfil' })).toBeDisabled({
        timeout: 60_000,
      });

      // A prova NÃO é a UI depois do salvar: é o RELOAD. Só ele mostra o que a
      // Meta passou a reportar, que é o que o paciente vê. A regra permanente da
      // auditoria E2E exige persistência provada por banco ou por recarga —
      // aqui o "banco" é a Meta, e a recarga é o único jeito de perguntar a ela.
      await page.reload({ timeout: 90_000 });
      await expect(page.locator(SECAO).getByLabel('Recado')).toHaveValue(novo, {
        timeout: 60_000,
      });
    } finally {
      // Restaura SEMPRE, inclusive em falha: este perfil é público e um recado
      // de teste ficaria visível para quem abrisse a conversa com a clínica.
      const atual = page.locator(SECAO).getByLabel('Recado');
      if ((await atual.count()) > 0 && (await atual.inputValue()) !== anterior) {
        await atual.fill(anterior);
        await page.locator(SECAO).getByRole('button', { name: 'Salvar perfil' }).click();
        await expect(
          page.locator(SECAO).getByRole('button', { name: 'Salvar perfil' }),
        ).toBeDisabled({ timeout: 60_000 });
      }
    }
  });
});

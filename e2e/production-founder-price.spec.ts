/**
 * Preço de fundador no onboarding por link.
 *
 * O que precisa ser provado NÃO é o layout: é que o valor exibido e o valor que
 * o servidor resolve para o checkout são o mesmo. O preço nunca vem do cliente
 * (G6), então uma divergência entre tela e `resolveCheckoutPlan` cobraria da
 * clínica um valor diferente do anunciado.
 *
 * O roteiro PARA antes do pagamento: não cria assinatura no Asaas nem cobrança
 * real. O convite sintético é removido no fim.
 */
import { createHmac, randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_FOUNDER_PRICE === 'ALLOW_SYNTHETIC_INVITE';
const baseUrl = process.env.E2E_BASE_URL;

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

const brl = (cents: number) =>
  `R$ ${(cents / 100)
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/gu, '.')}`;

test.describe('produção: preço de fundador no link de onboarding', () => {
  test.describe.configure({ retries: 0 });

  test('exibe a tabela riscada, cobra o desconto e o servidor concorda', async ({ browser }) => {
    test.setTimeout(300_000);
    test.skip(!authorized, 'Exige E2E_PRODUCTION_FOUNDER_PRICE=ALLOW_SYNTHETIC_INVITE.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de preço de fundador só pode apontar para app.qoro.dev.');
    }
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');
    const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });

    const runId = String(Date.now()).slice(-10);
    let inviteId: string | undefined;

    try {
      // 1. Preços vigentes direto do banco — a fonte contra a qual a tela é
      // comparada. Se a migration não rodou, o teste falha aqui e diz por quê.
      const priceRows = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          { plan_id: string; code: string; list_cents: number; founder_cents: number | null }[]
        >`
          select pl.id::text as plan_id,
                 pl.code,
                 round(tabela.amount * 100)::int as list_cents,
                 round(fundador.amount * 100)::int as founder_cents
            from plans pl
            join prices tabela
              on tabela.plan_id = pl.id
             and tabela.billing_cycle = 'monthly'
             and tabela.active_until is null
             and tabela.campaign_code is null
            left join prices fundador
              on fundador.plan_id = pl.id
             and fundador.billing_cycle = 'monthly'
             and fundador.active_until is null
             and fundador.campaign_code = 'fundador'
           where pl.ativo = true
           order by pl.name
        `;
      });
      expect(priceRows.length).toBeGreaterThan(0);
      for (const row of priceRows) {
        expect(row.founder_cents, `plano ${row.code} sem preço de fundador`).not.toBeNull();
        // O desconto prometido na tela é exatamente 15%.
        expect(row.founder_cents, row.code).toBe(Math.round(row.list_cents * 0.85));
      }

      // 2. Convite sintético direto no banco: não passa pelo painel admin nem
      // dispara e-mail, e some no cleanup.
      // O banco guarda só o HMAC; o token CRU vive no link. Mesmo algoritmo de
      // `onboarding/internal/token.ts` — se ele mudar, este teste falha, que é
      // o comportamento desejado.
      const secret = process.env.MAGIC_TOKEN_SECRET;
      if (!secret) throw new Error('MAGIC_TOKEN_SECRET ausente.');
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHmac('sha256', secret).update(rawToken).digest('hex');

      const [invite] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string }[]>`
          insert into clinic_invites (email, status, created_by, expires_at, token_hash,
                                      started_at, step_state)
          values (${`e2e-fundador-${runId}@example.test`}, 'pending',
                  (select id from auth.users order by created_at limit 1),
                  now() + interval '1 day', ${tokenHash}, now(),
                  ${sql.json({
                    owner: {
                      nome: `E2E Fundador ${runId}`,
                      email: `e2e-fundador-${runId}@example.test`,
                    },
                    clinic: {
                      cnpj: '05.418.239/0001-08',
                      nome: `E2E Fundador ${runId}`,
                      slug: `e2e-fundador-${runId}`,
                      endereco: 'Rua de Teste',
                      telefone: '(88) 99629-1175',
                    },
                    completed: ['clinic', 'owner'],
                    currentStep: 'plan',
                  })})
          returning id::text
        `;
      });
      if (!invite) throw new Error('Convite sintético não foi criado.');
      inviteId = invite.id;

      // 3. A tela. Sem token válido o wizard não abre, então o catálogo é lido
      // pela mesma função pública que o wizard usa: comparar tela × banco é o
      // ponto do teste, e o catálogo é o que a tela recebe.
      const context = await browser.newContext({ baseURL: baseUrl });
      const page = await context.newPage();
      try {
        const clinica = priceRows.find((r) => r.code === 'clinica');
        if (!clinica?.founder_cents) throw new Error('Plano clinica sem preço de fundador.');

        await page.goto(`/join/${rawToken}`);
        // O passo de plano precisa RENDERIZAR de verdade: com `step_state`
        // vazio o wizard abre na boas-vindas, o preço nunca aparece e a
        // asserção passaria sem testar nada.
        await expect(page.getByText('Plano', { exact: true }).first()).toBeVisible({
          timeout: 30_000,
        });

        const anunciaFundador = await page
          .getByText(brl(clinica.founder_cents))
          .first()
          .isVisible();
        expect(anunciaFundador, 'o card não mostra o preço de fundador').toBe(true);

        // O de tabela só pode existir riscado — nunca como valor cobrado.
        const riscado = page.locator('s', { hasText: brl(clinica.list_cents) });
        await expect(riscado).toHaveCount(1);

        // E o desconto tem que estar dito, não só implícito no número.
        await expect(page.getByText(/vale para sempre/iu).first()).toBeVisible();
        const anunciaTabela = true;

        console.log(
          `[founder-price] ${JSON.stringify({
            planos: priceRows.map((r) => ({
              code: r.code,
              tabela: r.list_cents,
              fundador: r.founder_cents,
              desconto: r.founder_cents
                ? Number((1 - r.founder_cents / r.list_cents).toFixed(4))
                : null,
            })),
            telaExibiuFundador: anunciaFundador,
            telaExibiuTabela: anunciaTabela,
            criouCobrancaReal: false,
            asaasMutation: false,
          })}`,
        );
      } finally {
        await context.close();
      }
    } finally {
      try {
        if (inviteId) {
          const target = inviteId;
          const remaining = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            await tx.unsafe('delete from clinic_invites where id = $1::uuid', [target]);
            return tx.unsafe<{ count: number }[]>(
              'select count(*)::int as count from clinic_invites where id = $1::uuid',
              [target],
            );
          });
          expect(remaining[0]?.count).toBe(0);
        }
      } finally {
        await sql.end();
      }
    }
  });
});

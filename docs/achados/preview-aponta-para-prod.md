# Achado — Preview da Vercel lê e escreve no banco de PRODUÇÃO

> **Status:** ✅ **RESOLVIDO E EXERCITADO (2026-07-18)** · **Severidade:** era ALTA
> (latente) · **Owner:** João Marcos (Qoro)
> **Descoberto:** 2026-07-17, durante a remediação da auditoria de identidade.
>
> **Correção:** o founder separou as env vars — Preview aponta para **qoro-dev**,
> Production para **qoro-prod** (entradas distintas, não mais a linha compartilhada
> `Production, Preview`).
>
> **PROVA (o que fecha o item — config declarada ≠ config validada):** abrindo a
> aplicação em produção vê-se **1 clínica**; abrindo um deploy de **preview** vê-se
> **4 clínicas** — exatamente o conteúdo do `qoro-dev`. Se ainda apontasse para
> prod, os dois mostrariam o mesmo número.
>
> **Efeito colateral resolvido no caminho:** o preview quebrava no login com
> `LOGIN_HASH_PEPPER ausente no env`. Causa: a Vercel captura env vars **no
> build**, e a branch de preview tinha sido buildada ANTES da separação. Resolveu
> com **redeploy** da branch. Vale para qualquer env nova: alterar a variável não
> afeta deployments já existentes.
>
> ↩︎ [índice mestre](../README.md) · registrado como **D8** no
> [PROGRESS §Dívida técnica pós-C16](../PROGRESS.md)

---

## Resumo

Todo deploy de **Preview** da Vercel — de qualquer branch, de qualquer PR — conecta no banco de
**produção**. Não há isolamento entre "ambiente de teste" e "dado real".

Hoje o estrago possível é pequeno: prod tem **2 perfis (ambos do founder) e 0 pacientes**. No dia em
que houver cliente, **uma branch pela metade num preview pode corromper dado de paciente real** — e
sem nenhum dos guards que protegem o caminho oficial (`db:migrate:prod` tem backup, advisory lock,
`check:migrations` e sentinela de falha; um preview é só `git push`).

## Evidência

`pnpm dlx vercel env ls` (2026-07-17):

```
 name                                    value        environments          created
 DATABASE_URL_RUNTIME                    Encrypted    Preview, Production   1d ago
 DATABASE_URL                            Encrypted    Production, Preview   51d ago
 NEXT_PUBLIC_SUPABASE_URL                Encrypted    Production, Preview   51d ago
 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY    Encrypted    Production, Preview   50d ago
```

**Como ler isto:** na Vercel, cada linha é uma *entrada* de variável. Uma entrada tem **um valor** e
uma lista de ambientes onde ele vale. Valores **diferentes** por ambiente produzem **linhas
separadas** com o mesmo nome.

Aqui `DATABASE_URL` aparece em **uma linha só**, cobrindo `Production, Preview` → **é o mesmo valor
nos dois**. O mesmo vale para `DATABASE_URL_RUNTIME` e `NEXT_PUBLIC_SUPABASE_URL`. Logo: **Preview
aponta para o banco de produção.**

### Corolário: o Preview hoje nem funciona direito

Estes secrets estão **só em Production**:

| Env | Falta em Preview → quebra |
|---|---|
| `LOGIN_HASH_PEPPER` | login (rate-limit dual / `record_login_attempt`) |
| `SUPABASE_SECRET_KEY` | `createAdminClient` (convite, impersonate, admin) |
| `CRYPTO_MASTER_KEY_V1` | qualquer leitura/escrita de paciente (ADR-012) |
| `CRYPTO_LOOKUP_SALT` | busca de paciente por hash |
| `CRON_SECRET` | rotas `/api/cron/*` |

No [`env.ts`](../../src/lib/env.ts) eles são `optional()` **de propósito** — para o `vercel build`
passar antes da config existir. Mas há guards que **lançam em runtime** (`assertCronRuntimeReady`,
`CRYPTO_SECRET_BACKEND=env` → exige `CRYPTO_MASTER_KEY_V1`/`CRYPTO_LOOKUP_SALT`). Ou seja: o preview
**buildaria** e quebraria ao logar e ao abrir paciente.

**Pior combinação possível:** o preview tem acesso de escrita ao banco de produção, mas não tem os
secrets que fariam ele funcionar corretamente — então ele falha *no meio* de fluxos, não no começo.

## Impacto

- **Corrupção de dado real por branch de teste.** O caminho oficial para tocar prod é
  `db:migrate:prod` (backup + lock + gate anti-destrutivo). Um preview contorna tudo isso.
- **Nenhum ambiente de teste realista.** Não dá para validar nada "de verdade" antes do `main` —
  o que empurra todo risco para o deploy de produção. Foi exatamente o que bloqueou a validação do
  **D1** por preview (ver [runtime-role-nobypassrls.md](../runbooks/runtime-role-nobypassrls.md)).
- **LGPD:** dado de saúde (Art. 11) acessível a partir de um ambiente efêmero, com URL pública e
  sem controle de acesso equivalente ao de produção.

## Por que existe (hipótese)

Provável herança do começo do projeto, quando só existia um banco e "Preview" era só um jeito de ver
a branch no ar. A separação dev/prod (2 projetos Supabase) veio depois, e a config da Vercel não
acompanhou. Não é decisão registrada em ADR nenhum — é drift.

---

## Correção — dar ao Preview um valor próprio (apontando para o `qoro-dev`)

**Sim, dá para ter o mesmo nome com valores diferentes por ambiente.** É o desenho da Vercel: a
restrição é que **um nome só pode estar definido uma vez *por ambiente*** — mas o mesmo nome pode ter
uma entrada para Production e outra para Preview, com valores distintos.

A entrada de hoje cobre `Production, Preview` ao mesmo tempo. Não dá para "editar só o Preview": é
preciso **remover o Preview daquela entrada** e **criar uma nova entrada só para Preview**.

### Ordem (por variável)

Faça **uma variável por vez** e confira com `vercel env ls` entre cada uma.

```powershell
# 1. Veja o valor atual (você vai precisar re-colar o de Production)
pnpm dlx vercel env pull .env.vercel-backup --environment=production
#    ⚠️ arquivo com segredos de PROD. Apague depois: Remove-Item .env.vercel-backup

# 2. Remova a entrada compartilhada (ela some de Production E Preview)
pnpm dlx vercel env rm DATABASE_URL production
pnpm dlx vercel env rm DATABASE_URL preview

# 3. Recrie SEPARADAS
pnpm dlx vercel env add DATABASE_URL production   # cole a URL do qoro-prod (shlcbxawrxuaebazuiue)
pnpm dlx vercel env add DATABASE_URL preview      # cole a URL do qoro-dev  (pqhkirrszzpwezdaqrai)

# 4. Confira: agora devem aparecer DUAS linhas com o mesmo nome
pnpm dlx vercel env ls
```

> Pelo dashboard dá no mesmo: Settings → Environment Variables → na variável, desmarque `Preview` e
> salve; depois **Add New** com o mesmo nome, marque só `Preview`, cole o valor de dev.

### Variáveis a separar (apontar Preview → `qoro-dev`)

| Variável | Preview deve apontar para |
|---|---|
| `DATABASE_URL` | pooler do **qoro-dev** (`pqhkirrszzpwezdaqrai`), porta 6543 |
| `DATABASE_URL_RUNTIME` | `qoro_runtime` do **qoro-dev** |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://pqhkirrszzpwezdaqrai.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key do **qoro-dev** |

### Secrets a ACRESCENTAR em Preview (hoje só existem em Production)

Use os **valores de dev** (o `.env.local`), nunca os de prod — o objetivo é justamente não ter
segredo de produção num ambiente efêmero:

`SUPABASE_SECRET_KEY` · `CRYPTO_MASTER_KEY_V1` · `CRYPTO_LOOKUP_SALT` · `LOGIN_HASH_PEPPER` ·
`CRON_SECRET`

> ⚠️ **`CRYPTO_MASTER_KEY_V1` e `CRYPTO_LOOKUP_SALT` precisam ser os MESMOS do `qoro-dev`**, senão o
> preview não consegue decifrar o dado que já está lá. O `CRYPTO_LOOKUP_SALT` é **imutável** por
> definição (trocar quebra a busca por hash) — ver [secret-rotation.md](../runbooks/secret-rotation.md).

### O que NÃO mudar

`UPSTASH_REDIS_REST_*` já é compartilhado de propósito (dev e prod na mesma DB free, com
discriminador `VERCEL_ENV` nas chaves — ver a memória de Redis e o `rate-limit.ts`). Deixe como está.

## Verificação (depois de aplicar)

1. `pnpm dlx vercel env ls` → `DATABASE_URL` deve aparecer em **duas linhas** (uma `Production`, uma
   `Preview`).
2. Abra um PR qualquer → no preview, logue com um usuário **de dev** (ex.: o gestor do seed). Se
   logar, o preview está no dev. **Se o usuário de dev NÃO existir lá, o preview ainda está em
   prod** — e isso é o teste, não um detalhe.
3. Ganho imediato: o preview vira o lugar certo para validar o **D1** — o `qoro-dev` tem 2 clínicas /
   4 pacientes, ou seja, **dado cross-tenant de verdade para provar isolamento** (prod tem 0
   pacientes; lá qualquer teste de vazamento é vacuidade).

## Referências

- [`runbooks/runtime-role-nobypassrls.md`](../runbooks/runtime-role-nobypassrls.md) — o D1, que não
  pôde ser validado por preview justamente por causa disto.
- [`PROGRESS.md`](../PROGRESS.md) §Dívida técnica pós-C16 — mesmo gatilho ("antes do 1º cliente").
- [`runbooks/secret-rotation.md`](../runbooks/secret-rotation.md) — inventário de segredos e a regra
  do `CRYPTO_LOOKUP_SALT` imutável.
- [`src/lib/env.ts`](../../src/lib/env.ts) — por que os secrets são `optional()` no schema e
  `required` em runtime.

# Preview Safety Gate — GATE 1

> **Bloqueia o primeiro push da branch `redesign/qoro-ds-v3`.**
> Exige acesso ao painel da Vercel e ao Supabase — precisa ser executado pelo founder.

## A invariante

> **Nenhuma revisão visual pode enviar mensagem, cobrar cartão, emitir cobrança,
> disparar e-mail ou alterar dado de produção.**

Trocar `DATABASE_URL` não basta. A aplicação tem integrações que produzem efeito externo
real e que não passam pelo banco.

## Por que preview de branch e não projeto separado

[`vercel.json`](../../vercel.json) declara **15 crons**, três deles destrutivos:
`patient-hard-delete`, `data-retention`, `billing-dunning`.

Na Vercel, cron **só dispara em deployment de produção**. Preview de branch não dispara.
Um projeto separado transformaria a branch de redesign na "produção" dele e passaria a
disparar os 15 — contra o banco que estivesse configurado. É a razão principal da escolha.

## Checklist

Marcar cada linha em **Settings → Environment Variables → Preview** do projeto atual.
O contrato das variáveis está em [`src/lib/env.ts`](../../src/lib/env.ts) (validação Zod no
boot: preview mal configurado **falha cedo**, não silenciosamente) e em
[`.env.example`](../../.env.example).

### Banco e storage

- [ ] `DATABASE_URL` → projeto Supabase **não-produtivo**
- [ ] `DATABASE_URL_PROD` → **vazia**
- [ ] `SUPABASE_PROJECT_ENV` → **vazia** (é o opt-in dos scripts de produção)
- [ ] `NEXT_PUBLIC_SUPABASE_URL` → mesmo projeto não-produtivo
- [ ] `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → chave do projeto não-produtivo
- [ ] `SUPABASE_SECRET_KEY` → chave do projeto não-produtivo
- [ ] **Migrations aplicadas no projeto de preview, incluindo as políticas de RLS**

> **Sobre o prefixo `NEXT_PUBLIC_`.** Ele inlina o valor no bundle do browser — verificado:
> a publishable aparece em 2 arquivos de `.next/static`, a secret em nenhum. Isso é o
> comportamento correto: a publishable (antiga `anon`) é pública por design e sua segurança
> vem de **RLS**, não do sigilo. A que bypassa RLS é a `SUPABASE_SECRET_KEY`, que não tem o
> prefixo e nunca pode ganhar um.
>
> A consequência prática para o preview: **o risco não é a chave estar exposta, é para qual
> projeto ela aponta.** Publishable de produção no Preview faz o preview conversar com o
> banco de produção. E num projeto de preview novo, sem as migrations de RLS aplicadas, a
> publishable deixa de ser inofensiva — sem políticas, o papel `anon` vira handle de leitura
> e escrita no banco inteiro.

### Criptografia — atenção

- [ ] `CRYPTO_MASTER_KEY_V1` → chave própria do preview
- [ ] `CRYPTO_LOOKUP_SALT` → salt próprio do preview

> O banco de preview precisa estar cifrado **sob a chave do preview**. Restaurar um dump de
> produção sem re-cifrar faz todo dado clínico falhar ao decifrar — e a tela mostra erro, não
> dado vazado. Ainda assim, é a diferença entre um preview usável e um inútil.

### Integrações com efeito externo

- [ ] `META_APP_SECRET`, `META_APP_ID`, `META_CONFIG_ID` → vazias ou app de teste
- [ ] `META_TEMPLATE_*` → vazias — **nenhuma mensagem de WhatsApp real**
- [ ] `ASAAS_BASE_URL` → `https://sandbox.asaas.com/api/v3` (já é o default seguro)
- [ ] `ASAAS_API_KEY` → chave de sandbox
- [ ] `ASAAS_WEBHOOK_TOKEN` → token distinto do de produção
- [ ] `RESEND_API_KEY` → chave de teste ou vazia
- [ ] `EMAIL_FROM` → remetente que não seja o de produção
- [ ] `GEMINI_API_KEY` → chave separada
- [ ] `AI_MONTHLY_COST_LIMIT_USD` → teto baixo (ex.: `5`)

### Estado compartilhado

- [ ] `UPSTASH_REDIS_REST_URL` / `_TOKEN` → instância separada
      _(compartilhar com produção faz o rate-limit do preview consumir o orçamento real)_

### Segredos e links

- [ ] `CRON_SECRET` e `CRON_SECRET_DESTRUCTIVE` → distintos dos de produção
- [ ] `LOGIN_HASH_PEPPER`, `IMPERSONATION_SECRET`, `MAGIC_TOKEN_SECRET` → próprios
- [ ] `APP_BASE_URL` → **URL do preview**

> Se `APP_BASE_URL` continuar apontando para produção, os links de convite e os redirects de
> auth gerados no preview levam o usuário para produção. É o vazamento mais fácil de passar
> despercebido, porque a tela do preview parece correta.

### Observabilidade

- [ ] `NEXT_PUBLIC_SENTRY_DSN` → projeto separado ou vazio

## Conta de teste para o GATE 3

O harness visual exige credenciais descartáveis:

- [ ] `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` → usuário **descartável** no banco de preview
- [ ] Nunca uma conta real (`playwright.config.ts` documenta a exigência)

## Verificação depois de configurar

```bash
# 1. O preview subiu e responde
curl -sS -o /dev/null -w '%{http_code}\n' <URL-DO-PREVIEW>/login

# 2. As rotas autenticadas renderizam contra o preview
E2E_BASE_URL=<URL-DO-PREVIEW> E2E_AUTH_REUSE=1 pnpm test:e2e -- e2e/authenticated-readonly-routes.spec.ts

# 3. Captura visual do baseline (Wave 0 = estado atual, antes de qualquer mudança)
VISUAL_WAVE=wave-0 E2E_BASE_URL=<URL-DO-PREVIEW> E2E_AUTH_REUSE=1 pnpm test:visual
```

`E2E_MUTATION=1` é bloqueado fora de localhost por `playwright.config.ts` — não há como um
teste de mutação atingir o preview por engano.

## Reverificar

Sempre que uma variável de ambiente mudar. O gate não é uma vez só.

# Guia operacional — como alterar cada variável de ambiente

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Criado:** 2026-07-18
> **Fonte de verdade do schema:** [`src/lib/env.ts`](../../src/lib/env.ts) (Zod, valida no boot)
>
> ↩︎ [índice mestre](../README.md) · complementa [development/environment.md](../development/environment.md)

Este guia responde três perguntas por variável: **onde ela vive**, **como trocar**, e
**o que quebra se trocar**. Nasceu de dois incidentes reais desta semana — o preview
quebrando com `LOGIN_HASH_PEPPER ausente` (env alterada sem redeploy) e a dúvida
sobre trocar o `CRYPTO_MASTER_KEY_V1` (que teria destruído dado cifrado).

---

## As 3 regras que explicam quase todo incidente de env

### Regra 1 — A Vercel captura a env **no build**. Alterar não afeta deployment existente.

Trocar uma variável no dashboard **não muda** nada que já está no ar. O deployment
carrega o snapshot de env do momento em que foi buildado. Foi exatamente isso que
quebrou o preview da `feat/ui-ds-v2-fundacao`: a variável foi adicionada depois do
último build daquela branch.

> **Sempre que alterar qualquer variável na Vercel: REDEPLOY do ambiente afetado.**
> Dashboard → Deployments → `...` → Redeploy. Ou `git commit --allow-empty -m "chore: redeploy" && git push`.

### Regra 2 — `NEXT_PUBLIC_*` vai para o navegador. Nunca coloque segredo lá.

Essas são **inlined no bundle do cliente** — qualquer visitante lê. Só entram aí
valores que já são públicos por natureza (URL do Supabase, chave publishable, DSN do
Sentry). As demais só existem no servidor.

### Regra 3 — Ambiente separado = entrada separada.

Depois da correção do D8, `Production` e `Preview` têm **entradas distintas**. Ao
adicionar variável nova, marque o escopo certo: uma entrada cobrindo
`Production, Preview` significa **o mesmo valor nos dois** — foi assim que o preview
passou meses escrevendo no banco de produção.

---

## Como alterar (os comandos)

### Dev (`.env.local`)

```powershell
# 1. Editar o arquivo (fica gitignored — nunca commitar)
code .env.local

# 2. Reiniciar o dev server — o env.ts valida no boot, não recarrega em hot-reload
#    (Ctrl+C no terminal do `pnpm dev`, depois:)
pnpm dev
```

Se o valor for inválido, o boot falha com a mensagem do Zod apontando a variável —
por design, `next.config.ts` importa `./src/lib/env` antes de tudo.

### Vercel — pelo dashboard (recomendado)

```
vercel.com → projeto → Settings → Environment Variables
→ Add New / editar
→ marcar o escopo: Production | Preview | Development
→ Save
→ Deployments → Redeploy (OBRIGATÓRIO — ver Regra 1)
```

### Vercel — pela CLI

```powershell
npm i -g vercel
vercel login
vercel link

vercel env ls                          # listar (mostra escopo e idade)
vercel env add NOME production         # adicionar (pede o valor via stdin)
vercel env rm NOME production          # remover
vercel env pull .env.vercel.local      # baixar para inspecionar local
```

⚠️ A CLI **não redeploya sozinha**. Depois: `vercel --prod` ou redeploy pelo dashboard.

### Gerar segredos novos

```powershell
# 32 bytes base64 — para CRYPTO_MASTER_KEY_V1, CRYPTO_LOOKUP_SALT
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 48 chars hex — para LOGIN_HASH_PEPPER, CRON_SECRET, IMPERSONATION_SECRET, MAGIC_TOKEN_SECRET
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

---

## 🔴 Grupo 1 — Cripto: trocar destrói dado

Estas são as únicas variáveis onde **trocar o valor perde dado de forma
irreversível**. Backup do Postgres não recupera: o banco guarda o *ciphertext*.

| Variável | O que é | Se você trocar |
|---|---|---|
| `CRYPTO_MASTER_KEY_V1` | A chave mestra (32 bytes base64). Deriva, por HKDF com `clinic_id`, a chave de cada clínica. | **Todo dado cifrado vira ilegível.** CPF, telefone, endereço, **prontuário, prescrições, documentos** (ADR-044), CNPJ. O auth tag do AES-GCM falha e o app lança exceção. |
| `CRYPTO_LOOKUP_SALT` | Salt global do HMAC de lookup (`cpf_hash`, `telefone_hash`, `contact_hash`). | **Pior que a anterior em um aspecto:** o hash é irreversível. Busca de paciente por CPF para de achar; o `UNIQUE (clinic_id, cpf_hash)` deixa de barrar duplicata; a `suppression_list` (opt-out de WhatsApp) para de casar — você volta a mandar mensagem para quem pediu para sair. |
| `MASTER_KEY_VERSION` | Número (não é segredo). Qual versão de chave usar ao **cifrar** dado novo. Default `1`. | Sozinho, nada — mas apontar para uma versão sem chave correspondente quebra o cifrar. |
| `CRYPTO_SECRET_BACKEND` | Seletor: `env` (lê das env vars) ou `gcp` (Google Secret Manager). | **Deve ser `env` em Production.** O default é `env.CRYPTO_SECRET_BACKEND ?? (NODE_ENV==='production' ? 'gcp' : 'env')` ([env.ts:345](../../src/lib/env.ts#L345)) — na Vercel `NODE_ENV=production`, então **sem essa variável o app procura no GCP** (que não usamos) e estoura no primeiro cadastro. |

### Rotação CORRETA da master key (nunca substitua o valor)

O byte de versão no envelope existe justamente para isso:

```powershell
# 1. Gerar a chave nova
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 2. Na Vercel (Production), ADICIONAR — sem tocar na V1:
#    CRYPTO_MASTER_KEY_V2 = <valor novo>
#    MASTER_KEY_VERSION   = 2

# 3. Redeploy
```

Dado novo passa a sair com o byte `2` (chave nova); dado antigo tem o byte `1` e
continua legível porque a `V1` ainda está lá ([secret-provider.ts:50](../../src/lib/crypto/secret-provider.ts#L50)).
Só remova a `V1` **depois** de re-cifrar todo o histórico (script no molde do
`db:encrypt-clinical`).

> 🔑 **A env var da Vercel é hoje a ÚNICA cópia da master key.** Desde o ADR-044 ela
> protege o prontuário. Guarde o valor num cofre de senhas **fora** da Vercel.

---

## 🟠 Grupo 2 — Banco: trocar aponta para outro lugar

| Variável | O que é | Cuidados |
|---|---|---|
| `DATABASE_URL` | Conexão do app. **Obrigatória em todo ambiente** (única sem `.optional()`). | Preview deve apontar para **qoro-dev**, Production para **qoro-prod** (D8). Use o **Session Pooler (5432)** para scripts e o Transaction Pooler (6543) para o app. ⚠️ O Supavisor é **regional**: dev é `us-west-1`, prod é `us-east-1` — host errado dá `tenant not found`, que parece erro de senha e não é. |
| `DATABASE_URL_RUNTIME` | Conexão com a role `qoro_runtime` (NOBYPASSRLS). É o fail-close do D1. | Se ausente, o app cai para `DATABASE_URL` e **perde o fail-close** (um `withTenant` esquecido volta a vazar em vez de retornar 0 linhas). Rollback do D1 = remover esta variável + redeploy. |
| `DATABASE_URL_PROD` | **Só para scripts** (`db:migrate:prod`, `db:backup:prod`). O app **nunca** lê. | Nunca deixe em `.env.local` de máquina de dev. Setar só na sessão do shell e remover depois. |
| `SUPABASE_PROJECT_ENV` | Guard explícito (`dev`/`prod`) que os scripts de prod exigem. | Sem ela, `db:migrate:prod` recusa rodar — é opt-in proposital, não heurística. |

```powershell
# Sessão de prod (APENAS este shell; a URI tem a senha)
$env:SUPABASE_PROJECT_ENV = "prod"
$env:DATABASE_URL_PROD = "postgresql://postgres.<ref>:<senha>@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require"

# ... rodar o comando ...

Remove-Item Env:SUPABASE_PROJECT_ENV -ErrorAction SilentlyContinue
Remove-Item Env:DATABASE_URL_PROD -ErrorAction SilentlyContinue
```

---

## 🟡 Grupo 3 — Segredos de auth: trocar desloga/invalida

| Variável | Mín. | Se trocar |
|---|---|---|
| `LOGIN_HASH_PEPPER` | 32 | **Seguro trocar.** Só invalida janelas de rate-limit em voo (15 min). Hash de email em `login_attempts` deixa de casar com o histórico — aceitável. Exigido em runtime pelo login. |
| `IMPERSONATION_SECRET` | 32 | Invalida sessões de impersonate ativas. Baixo impacto (só super_admin). |
| `MAGIC_TOKEN_SECRET` | 32 | **Invalida todos os convites mágicos pendentes** — quem recebeu link e não usou precisa de convite novo. |
| `CRON_SECRET` | 32 | Os crons da Vercel param de autenticar até o redeploy. Rotacione junto com o redeploy, nunca antes. |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | senha ≥12 | Só usados pelo `pnpm seed:super-admin`. Trocar não afeta o usuário já criado (a senha real vive no Supabase Auth). |

---

## 🟢 Grupo 4 — Supabase e públicas

| Variável | Cuidados |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Pública (vai pro browser). Tem que casar com o `DATABASE_URL` do mesmo ambiente — apontar para projetos diferentes gera bug sutil (auth num, dado noutro). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Pública. O `env.ts` aceita ela **ou** a legada `NEXT_PUBLIC_SUPABASE_ANON_KEY`, mas exige **ao menos uma**. |
| `SUPABASE_SECRET_KEY` | 🔴 **SEGREDO** (é o `service_role`, BYPASSRLS). Nunca com prefixo `NEXT_PUBLIC_`. Aceita a legada `SUPABASE_SERVICE_ROLE_KEY`. Rotacionar exige redeploy imediato — o app perde admin/cron sem ela. |

---

## ⚪ Grupo 5 — Comportamento (têm default; geralmente não setar)

| Variável | Default | Nota |
|---|---|---|
| `NODE_ENV` | `development` | **Não setar manualmente.** A Vercel força `production`. Setar errado muda o backend de cripto e o modo do Next. |
| `LOG_LEVEL` | `info` | `debug` em prod gera muito ruído e custo de log. |
| `OUTBOX_BATCH_SIZE` | `50` | **Não precisa setar.** Os `smoke:*` passam valores menores só para forçar cenário de teste. |
| `OUTBOX_PARALLELISM` | `5` | Idem. |
| `META_GRAPH_API_VERSION` | ver env.ts | Subir versão exige testar o webhook. |
| `META_TEMPLATE_LANG` | `pt_BR` | — |

---

## 🔵 Grupo 6 — Integrações externas

| Variável | Serviço | Se trocar |
|---|---|---|
| `GEMINI_API_KEY` | IA | Agente para de responder. Sem ela o app sobe, mas o AI Agent falha em runtime. |
| `ASAAS_API_KEY` | Cobrança | ⚠️ Chave de **sandbox vs produção** são diferentes. Trocar errado = cobrar no ambiente errado. `ASAAS_BASE_URL` tem que acompanhar. |
| `ASAAS_WEBHOOK_TOKEN` | Cobrança | Precisa bater com o configurado no painel do Asaas, senão os webhooks são rejeitados. |
| `META_APP_SECRET` | WhatsApp | Valida a assinatura do webhook. Trocar sem atualizar no Meta = todo webhook rejeitado. |
| `META_WEBHOOK_VERIFY_TOKEN` | WhatsApp | Só usado no handshake de verificação da URL. |
| `META_APP_ID` / `META_CONFIG_ID` | WhatsApp | Embedded signup. |
| `META_TEMPLATE_*_ID` | WhatsApp | IDs dos templates aprovados. Template reprovado/alterado no Meta muda o ID. |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry | **É `NEXT_PUBLIC_SENTRY_DSN`**, não `SENTRY_DSN` — o cliente lê a com prefixo ([instrumentation-client.ts:9](../../src/instrumentation-client.ts#L9)). |
| `SENTRY_AUTH_TOKEN` | Sentry | Só para upload de sourcemap **no build**. Vive em `.env.sentry-build-plugin`. Ausente = build passa, sourcemaps não sobem. |

---

## ⚫ Grupo 7 — Não estão no código (verificado em 2026-07-18)

Da sua lista, estas **não são lidas por `src/` nem por `scripts/`**. Se estão setadas
na Vercel, são resquício — e variável morta atrapalha (a próxima auditoria vai
perguntar o que é, e alguém vai supor que está em uso):

| Variável | Situação |
|---|---|
| `BACKUP_PASSPHRASE` | Não é do app: é **secret do GitHub Actions** (workflow de backup diário), usada para `gpg -d`. Documentada em [go-live-checklist.md:138](../c16/go-live-checklist.md). Guarde no cofre — é a chave para descriptografar o backup. |
| `RUNTIME_PASSWORD`, `RUNTIME_URL_DEV`, `RUNTIME_URL_PROD` | **Nenhuma ocorrência.** A senha do `qoro_runtime` entra embutida na `DATABASE_URL_RUNTIME`; não há variável separada. Provável rascunho da montagem do D1. |
| `IMPERSONATION_SECRET_PROD`, `ASAAS_API_KEY_PROD` | **Nenhuma ocorrência.** O código lê `IMPERSONATION_SECRET` e `ASAAS_API_KEY` — a separação por ambiente é feita pelo **escopo** da variável na Vercel, não por sufixo no nome. Setar o sufixo `_PROD` não tem efeito. |
| `SENTRY_DSN` | O código lê **`NEXT_PUBLIC_SENTRY_DSN`**. A sem prefixo não é consumida. |
| `VERCEL_OIDC_TOKEN` | Injetada e gerenciada pela **própria Vercel**. Não crie, não edite. |

> **Recomendação:** confirmar uma a uma e remover as mortas da Vercel. São 6
> variáveis que hoje dão a falsa impressão de estarem configurando algo.

---

## Checklist antes de trocar qualquer variável

1. **É do Grupo 1 (cripto)?** → Pare. Leia a seção de rotação. Trocar destrói dado.
2. **Qual escopo?** Production, Preview ou os dois (com valores diferentes)?
3. **É `NEXT_PUBLIC_`?** → vai para o navegador; não pode ser segredo.
4. **Redeploy** do ambiente afetado (Regra 1) — sem isso, nada muda.
5. **Exercite.** Config declarada ≠ config validada: faça a operação real (logar,
   cadastrar, disparar o cron) e confirme pelo comportamento, não pelo dashboard.
   O D1 ficou 2 dias marcado como "feito" com a env nunca exercitada; o D8 só fechou
   quando o preview mostrou 4 clínicas contra 1 da produção.

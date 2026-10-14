# Testes E2E

Os cenários padrão usam Playwright e Chromium e não criam nem alteram dados.
Os fluxos mutáveis exigem opt-in explícito e seguem as proteções descritas
abaixo.

## Três famílias, propósitos diferentes

| Família | Precisa de | Roda em CI? |
| --- | --- | --- |
| `public-surface.spec.ts` | nada (ou `E2E_BASE_URL`) | **sim** — `pnpm test:e2e:ci` |
| `signup-session-api.spec.ts` | `E2E_BASE_URL`; casos de Turnstile exigem `E2E_TURNSTILE_MODE` no Preview | não (precisa de banco) |
| `admin-boundary-rbac.spec.ts` | `E2E_BASE_URL` + conta de clínica descartável | não (precisa de credencial) |
| `payments-account-lifecycle.spec.ts` | `E2E_BASE_URL` **de Preview** + `ASAAS_CLINIC_SANDBOX_KEY` | não (cria estado no Asaas) |
| `admin-superadmin-journey.spec.ts` | `E2E_BASE_URL` **de Preview** + `SUPER_ADMIN_*_DEV` + `DATABASE_URL` | não (muta estado GLOBAL) |
| `tenant-settings-screens.spec.ts` | `E2E_BASE_URL` + conta de clínica descartável | não (cria e apaga modelo de receita) |
| `advanced-financial-entitlement-preview.spec.ts` | Preview + conta Pro/Clínica; `E2E_EXPECT_ADVANCED_FINANCIAL=1`; negativo exige `E2E_EXPECT_NO_METHOD_PRICES=1` e segredo do probe assinado | não (depende de fixture DEV) |
| `production-*.spec.ts` (44) | variável de autorização + credenciais de clínica sintética + `DATABASE_URL_PROD` | não, por design |
| mutáveis locais | `E2E_MUTATION=1` + banco de desenvolvimento | não |

No Preview, declare `E2E_TURNSTILE_MODE=always-pass` somente se a configuração
remota usa a secret de teste correspondente; nesse modo, o teste de token
forjado fica **SKIPPED** por desenho. Use `reject-invalid` para uma secret real
ou de teste always-fail, que permite provar a recusa. Sem modo declarado, os
dois casos condicionais ficam **SKIPPED**: a secret local não é evidência da
configuração remota. Os demais casos da suíte continuam executando.

**Regra do fundador (13/09): escrita e alteração acontecem SOMENTE em Preview.**
`payments-account-lifecycle` e `admin-superadmin-journey` recusam `app.qoro.dev`
com **erro**, não com skip: o primeiro pode registrar webhook no Asaas, o segundo
muta o kill-switch GLOBAL e cria sessão de impersonate.

O ciclo mutável de `payments-account-lifecycle` exige ainda
`E2E_PAYMENT_ACCOUNT_MUTATION=dev-sandbox`. Esse opt-in declara que o Preview foi
conferido como isolado no banco DEV e na conta Asaas Sandbox. A URL, sozinha, não
faz essa prova. Falha de autenticação também não vira skip: só um 429 observado
pode ser classificado como rate limit.

Quando não houver uma conta de clínica descartável, o modo
`E2E_PAYMENT_ACCOUNT_ISOLATED=1` cria um tenant e um owner exclusivos no DEV,
confere que Database e Auth pertencem ao mesmo projeto, executa os dois casos e
remove clínica e usuário com readback zero. A senha é aleatória, existe apenas na
memória do processo e nunca é registrada. Esse modo continua exigindo o opt-in,
um Preview apontado para DEV e a chave da conta Asaas Sandbox da clínica.

O `admin-superadmin-journey` precisa de uma conta de plataforma própria, e ela se
prepara sozinha — sem passo manual:

```bash
# SUPER_ADMIN_EMAIL_DEV / SUPER_ADMIN_PASSWORD_DEV no .env.local
pnpm seed:super-admin        # cria o usuário e o profile super_admin
pnpm seed:super-admin-mfa    # enrollment do TOTP pela API pública
```

O segredo do TOTP **não** fica em arquivo: o spec o lê de `auth.mfa_factors` na
hora de rodar. Um segundo fator num `.env` deixa de ser segundo fator — e ler do
banco não amplia exposição, porque quem roda o teste já tem o `DATABASE_URL` de
admin, bem mais poderoso que seis dígitos.

Os `production-*` escrevem em **produção** com clínicas sintéticas: o atrito das
60 variáveis `E2E_*` é a proteção, não burocracia. A consequência é que eles são
uma **ferramenta de auditoria operada por gente** — o gate automático é só o
`public-surface`. O diagnóstico completo está em
[`docs/quality/e2e-coverage-audit.md`](../docs/quality/e2e-coverage-audit.md).

## Rodar localmente

1. Preencha `.env.local` com o ambiente de desenvolvimento.
2. Execute `pnpm test:e2e`.

O Playwright inicia a aplicação local em modo de desenvolvimento quando
`E2E_BASE_URL` não foi definida.

## E-mail real em DEV

Há dois runners fora da suíte Playwright padrão porque usam o Resend e criam
fixtures externas:

```powershell
npx tsx --conditions=react-server scripts/resend-inbox-check.ts
npx tsx --conditions=react-server scripts/team-invite-inbox-check.ts
```

Ambos recusam ambiente diferente de DEV e exigem
`E2E_RESEND_INBOX_ADDRESS`. O primeiro prova a cadeia enviada/entregue/recebida.
O segundo atravessa convite inicial, reenvio, link antigo negado, aceite no
tenant e replay, com cleanup obrigatório. Para Preview, informe `E2E_BASE_URL`
e o bypass da Vercel; sem deployment do mesmo source, o resultado é bloqueio de
versão e não prova remota.

## Validar rotas autenticadas

Use uma conta de uma clínica descartável, nunca uma conta operacional:

```powershell
$env:E2E_USER_EMAIL = 'smoke@clinicaos.dev'
$env:E2E_USER_PASSWORD = '<CONFIGURE_EM_VARIAVEL_DE_AMBIENTE>'
pnpm test:e2e
```

Para testar um Preview já publicado, configure também:

```powershell
$env:E2E_BASE_URL = 'https://seu-preview.vercel.app'
pnpm test:e2e
```

Trace, screenshot e vídeo ficam desligados por padrão porque podem registrar
cookies, DOM e valores digitados. Para uma investigação local controlada, use
`E2E_ARTIFACTS=1` somente com credenciais descartáveis; remova os artefatos e
rotacione a credencial depois. Nunca publique, anexe ou abra trace/relatório
autenticado sem sanitização.

Para uma auditoria autenticada ampla contra ambiente remoto, reutilize uma única
sessão. Assim cada spec não consome uma nova tentativa de login nem aciona o
rate limit da aplicação:

```powershell
$env:E2E_BASE_URL = 'https://seu-preview.vercel.app'
$env:E2E_USER_EMAIL = 'conta-descartavel@exemplo.test'
$env:E2E_USER_PASSWORD = '<CONFIGURE_EM_VARIAVEL_DE_AMBIENTE>'
$env:E2E_AUTH_REUSE = '1'
$env:E2E_ARTIFACTS = '1'
pnpm test:e2e
```

## Fluxos que alteram dados (somente desenvolvimento local)

Os testes de paciente, agenda e caixa exigem opt-in explícito. Eles aceitam
somente `localhost`, verificam que o banco é o de desenvolvimento e criam
profissional, procedimento e recebimento com o marcador `[E2E]`. Ao final,
removem exclusivamente os registros daquela execução.

```powershell
$env:E2E_USER_EMAIL = 'conta-descartavel@exemplo.test'
$env:E2E_USER_PASSWORD = '<CONFIGURE_EM_VARIAVEL_DE_AMBIENTE>'
$env:E2E_MUTATION = '1'
pnpm test:e2e
```

Não use `E2E_MUTATION=1` contra Preview ou produção. Se uma execução for
interrompida, a próxima execução mutável remove antes a fixture pendente.

`agent-convenios.spec.ts` usa o mesmo opt-in e uma conta descartável com
`manage:agent`. Ele salva uma lista controlada em `/configuracoes/agente`,
recarrega a página para provar a persistência e restaura o valor anterior no
`finally`. A resposta do agente pelo pipeline real, sem Meta/Gemini externos, é
validada também por `pnpm smoke:c11`.

## Auditoria visual responsiva

A matriz visual fica isolada dos specs de mutação e produção. Ela gera 40
capturas locais (5 rotas × 4 viewports × 2 temas), desliga trace/vídeo e valida
tema, overflow horizontal, foco inicial e ausência de telas de “Sem acesso”.

```powershell
$env:E2E_BASE_URL='https://preview.example.test'
$env:E2E_USER_EMAIL='conta-descartavel@example.test'
$env:E2E_USER_PASSWORD='...'
$env:E2E_AUTH_REUSE='1'
pnpm exec playwright test --config playwright.visual.config.ts
```

Os artefatos ficam em `.playwright/ui-visual-results/`, já ignorado pelo Git.
Sem as quatro variáveis, os cenários ficam explicitamente pulados; isso não deve
ser reportado como aprovação visual.

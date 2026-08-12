# Testes E2E

Os cenários padrão usam Playwright e Chromium e não criam nem alteram dados.
Os fluxos mutáveis exigem opt-in explícito e seguem as proteções descritas
abaixo.

## Rodar localmente

1. Preencha `.env.local` com o ambiente de desenvolvimento.
2. Execute `pnpm test:e2e`.

O Playwright inicia a aplicação local em modo de desenvolvimento quando
`E2E_BASE_URL` não foi definida.

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

Os artefatos de falha (trace, vídeo e relatório) são locais e ficam ignorados
no Git.

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

# Track O — handoff final (19/09/2026)

> Detalhe por fatia em [docs/evidence/track-o.md](evidence/track-o.md). Histórico narrativo em
> [§35 do qorov2](qorov2.md). O handoff de 18/09 permanece como registro daquela sessão.

## Estado final

| Fatia | Resultado | Onde a prova está |
| ----- | --------- | ----------------- |
| **O-1** | **PASS** (publicação BLOCKED) | `qoro/scripts/verificar-comecar.mjs` 19/19 + navegador |
| **O-5** | **PASS** | Sandbox 4/4 + webhook 9/9 |
| **O-6** | **PASS** | 8/8 contra 105 migrations reais |
| **O-7** | **PASS** | 13/13 em schema real + **5/5** E2E autenticado, sem skip |
| **O.H** | **PASS** | carga geral + carga Track O 8/8 + chaos 59/59 |
| **O.S** | **PASS** | kill switch 9/9 + simulação + Preview + CI |

## O que esta sessão acrescentou

### O-1 — a ponte existe

`/comecar` em `C:\dev\qoro`. O destino é **constante**; não existe parâmetro de destino. Isso elimina
a classe de open redirect por construção — 17 vetores recusados sem nenhum filtro, porque não há host
vindo de fora. Só os cinco UTM da allowlist atravessam; `clinic_id`, `role`, `price`, `trial` e
`token` são descartados. **Atribuição não é autorização.**

O linker cross-domain foi a peça que faltava: o Google tag já tinha Consent Mode v2 e
`url_passthrough`, mas não `linker.domains` — sem ele a conversão em `app.qoro.dev` apareceria como
"direta", pagando o clique sem creditar a venda.

Provado no navegador com a ponte apontada para o Preview: a URL capturada carregava
`?utm_source=google-ads&utm_medium=cpc&utm_campaign=clinicas-sp`, com hífen preservado e sem nenhum
parâmetro proibido.

### O-7 — o E2E autenticado, e o 500 que ele achou

3/3 contra o Preview com sessão real. Na PRIMEIRA execução falhou: `500 em /dashboard`. A causa era
minha — a leitura de `onboarding_progress` estava no layout do shell, por onde passa toda página
autenticada, e o banco do Preview não tem a migration 0104. Um tour derrubava agenda, consultório e
caixa. Corrigido com degradação observável.

### Carga e chaos

Carga específica do Track O: 8/8, 0 deadlock, todos os SLOs existentes respeitados sem afrouxar
nenhum. Chaos de Redis: 59/59, incluindo o caso que responde ao §27 — `fail-open NÃO é barra-livre`.

## Bugs desta sessão

| Bug | Como apareceu | Correção |
| --- | ------------- | -------- |
| `500 em /dashboard` no Preview | E2E autenticado, primeira execução | leitura do onboarding degrada e reporta |
| classe de regex degenerada recusando hífen | inspeção de bytes do arquivo | comparação por código + 2 regressões |
| dois testes de tour passando no vazio | leitura crítica do próprio verde | skip anotado quando a máquina não está viva |
| lint da landing vermelho em `main` | baseline antes de tocar no repo | supressão justificada no shim do gtag |
| asserção de carga global demais | falhou contra as próprias fixtures | escopada ao que nasce do provisionamento |

## Bloqueios, e como desbloquear

| Bloqueio | Por quê | Como desbloquear |
| -------- | ------- | ---------------- |
| **`PONTE_ATIVA = false`** | último interruptor: o cadastro já está aberto em produção | trocar para `true` em `src/lib/comecar.ts:40`, rodar `npm run comecar` (o verificador troca de ramo) e publicar |
| **`security:browser-session`** | falha pré-existente, atribuída ao commit `8df4ab7` | fora do escopo do Track O |
| **Product Acceptance humano** | exige julgamento de produto | roteiro completo em [runbooks/aceitacao-humana-cadastro](runbooks/aceitacao-humana-cadastro.md) — rodar no Preview, com Sandbox |

**Resolvidos em 19/09/2026:**

- **o cadastro autônomo aberto em produção** — as duas flags estavam só em Preview, e uma cópia da
  `SIGNUP_IDENTITY_ENABLED` tinha ido parar no projeto Vercel da landing, onde nada lê env;
- **`/comecar` publicado** na landing, no estado desligado (200, `noindex`, fora do sitemap, sem link para o app);
- os 2 skips do E2E de tour — DEV (banco do Preview) migrado, spec 5/5 sem skip em quatro execuções;
- o journal do drizzle parado na 0102, que faria `db:migrate` pular a 0103 e a 0104 em silêncio;
- **produção migrada** de 96 para 105, com backup pré-migration, advisory lock e leitura de
  conferência — ver a seção de produção na matriz de evidência.

## Ordem de release

1. ~~commitar a feature da landing + `/comecar`~~ — **feito** (`df44192`, publicado: `qoro.dev/comecar`
   responde 200 no estado desligado, fora do sitemap, com `noindex`);
2. ~~aplicar as migrations do Track O ao banco DEV~~ — **feito** (103 → 105);
3. ~~mesclar o PR #9~~ — **feito** (`7dbfa5d`);
4. ~~aplicar as migrations ao banco de PRODUÇÃO~~ — **feito** (96 → 105, com backup e advisory lock);
5. ~~abrir o cadastro autônomo em produção~~ — **feito** em 19/09/2026 22:30 UTC;
6. ligar `PONTE_ATIVA` na landing (`src/lib/comecar.ts`, `false` → `true`) — **pendente**;
7. rodar o roteiro de aceitação humana — **pendente**.

### O passo 5, e a variável que estava no projeto errado

O cadastro ficou fechado mais tempo do que devia por uma razão banal e difícil de enxergar: as duas
flags existiam **só em Preview** no projeto `project-os`, e uma cópia de `SIGNUP_IDENTITY_ENABLED`
tinha sido criada no projeto **da landing**, onde nada lê variável de ambiente — o `src` inteiro da
landing não tem um `process.env` sequer. Uma variável no projeto errado não dá erro: ela simplesmente
não faz nada, e parece feita.

O que fechou o diagnóstico foi comparar os **nomes** das variáveis entre Preview e Production no
projeto do app. A diferença era exatamente três: as duas flags e o `VERCEL_AUTOMATION_BYPASS_SECRET`
(que é de Preview por desenho). Todo o resto — Asaas, Turnstile, Upstash, Supabase — já estava lá.
Diffar nomes de configuração entre ambientes é mais barato que ler log de aplicação, e teria
encontrado isto em um minuto.

Estado final medido depois do redeploy:

| Verificação                                | Antes                          | Depois                     |
| ------------------------------------------ | ------------------------------ | -------------------------- |
| `/login`                                    | 200                            | 200 (app sobe, env válida) |
| `/dashboard` anônimo                        | 307                            | 307                        |
| `/cadastro`                                 | 200 "Cadastro indisponível"    | 200, funil aberto          |
| `POST /api/signup/draft` sem sessão         | **503** `{"error":"unavailable"}` | **403** `{"error":"blocked"}` |
| `POST /api/signup/sessions` (navegador)     | —                              | **201**                    |
| `GET /api/signup/sessions/me` (1ª visita)   | —                              | **410**, como esperado     |

O `503 → 403` é a prova exata de que o portão abriu: `unavailable` é a flag desligada; `blocked` é a
recusa de origem para uma requisição sem sessão. A segunda é a defesa normal funcionando.

**Uma sessão anônima foi criada em produção** pela verificação no navegador: `status=initiated`, sem
respostas, sem usuário, sem assinatura, com TTL ocioso de 15 min e absoluto de 60 min. O janitor
`signup-sessions-cleanup` está `success` e roda a cada 10 min — é ele que a remove. Nenhum dado
pessoal foi inserido e o funil não foi avançado além da primeira tela.

**A partir daqui há dinheiro real em jogo.** O cadastro aberto cria assinatura de verdade no Asaas de
produção no passo de checkout. O `ASAAS_API_KEY` de Production tem 94 dias e já atende clientes
pagantes; o webhook de assinatura responde 401 sem token no alias estável, que é a recusa correta.

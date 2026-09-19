# Track O — handoff final (19/09/2026)

> Detalhe por fatia em [docs/evidence/track-o.md](evidence/track-o.md). Histórico narrativo em
> [§35 do qorov2](qorov2.md). O handoff de 18/09 permanece como registro daquela sessão.

## Estado final

| Fatia | Resultado | Onde a prova está |
| ----- | --------- | ----------------- |
| **O-1** | **PASS** (publicação BLOCKED) | `qoro/scripts/verificar-comecar.mjs` 19/19 + navegador |
| **O-5** | **PASS** | Sandbox 4/4 + webhook 9/9 |
| **O-6** | **PASS** | 8/8 contra 105 migrations reais |
| **O-7** | **PASS** | 13/13 em schema real + 3/3 E2E autenticado |
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
| **Publicar `/comecar`** | a landing tem feature inteira do usuário não commitada | o dono commita a feature dele e a ponte junto |
| **2 skips do E2E de tour** | banco do Preview sem a migration 0104 | aplicar as migrations do Track O ao banco do Preview |
| **`PONTE_ATIVA = false`** | `app.qoro.dev/cadastro` responde 307 → /login | ligar junto com o merge do Track O |
| **`security:browser-session`** | falha pré-existente, atribuída ao commit `8df4ab7` | fora do escopo do Track O |
| **Product Acceptance humano** | exige julgamento de produto | roteiro em `handoff-track-o-2026-09-18.md` §10 |

## Ordem de release

1. commitar a feature da landing + `/comecar` (dono da landing);
2. aplicar as migrations do Track O ao banco do ambiente alvo;
3. mesclar o PR #9;
4. ligar `SIGNUP_IDENTITY_ENABLED` no app;
5. ligar `PONTE_ATIVA` na landing;
6. rodar o roteiro de aceitação humana.

A ordem importa: ligar a ponte antes do passo 2 leva campanha paga para um beco sem saída.

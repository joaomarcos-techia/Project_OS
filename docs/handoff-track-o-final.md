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
| **Publicar `/comecar`** | a landing tem feature inteira do usuário não commitada | o dono commita a feature dele e a ponte junto |
| **Migrar o banco de PRODUÇÃO** | fora da autorização desta sessão (só DEV) | `SUPABASE_PROJECT_ENV=prod ... pnpm db:migrate:prod`, **antes** de abrir `/cadastro` em produção |
| **`PONTE_ATIVA = false`** | `app.qoro.dev/cadastro` responde 307 → /login | trocar para `true` em `src/lib/comecar.ts` quando `/cadastro` estiver de pé |
| **`security:browser-session`** | falha pré-existente, atribuída ao commit `8df4ab7` | fora do escopo do Track O |
| **Product Acceptance humano** | exige julgamento de produto | roteiro em `handoff-track-o-2026-09-18.md` §10 |

**Resolvido em 19/09/2026:** os 2 skips do E2E de tour. As migrations do Track O foram aplicadas ao
banco DEV (que é o banco do Preview) e o spec passa 5/5, sem skip, em três execuções seguidas.

## Ordem de release

1. commitar a feature da landing + `/comecar` (dono da landing);
2. ~~aplicar as migrations do Track O ao banco DEV~~ — **feito em 19/09/2026** (103 → 105);
3. ~~mesclar o PR #9~~ — **feito em 19/09/2026**;
4. `SIGNUP_IDENTITY_ENABLED` no app — **já configurado**: ligado no Preview (`/cadastro` responde 200) e fechado em produção (307 → /login), que é exatamente a configuração que torna o merge seguro sem migrar produção;
5. ligar `PONTE_ATIVA` na landing;
6. rodar o roteiro de aceitação humana.

**O passo que ficou, e por que ele é o primeiro de verdade.** Mesclar o PR publica em produção, e o
banco de produção **não** foi migrado — isso está fora da autorização desta sessão. Hoje isso é
inofensivo: `app.qoro.dev/cadastro` responde 307 → `/login`, ou seja, o cadastro autônomo está
fechado em produção, e a única outra estrutura nova (`onboarding_progress`) é lida com degradação
provada — sem a tabela, o shell renderiza sem o tour em vez de devolver 500. Mas abrir `/cadastro` em
produção **antes** de rodar `db:migrate:prod` quebra o cadastro na primeira tentativa de cobrança:
as colunas `billing_*`/`asaas_*` de `signup_sessions` não existem lá.

A ordem importa: ligar a ponte (passo 5) antes de migrar produção leva campanha paga para um beco sem
saída.

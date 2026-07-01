# Testes manuais — C15 Platform Admin

> **Status:** Histórico · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01
>
> ↩︎ Registro histórico — volta para o [índice mestre](./README.md).


Roteiro de aceite do painel do fundador (`/admin`, admin.qoro.dev). Marque cada caixa ao confirmar.
O que já está coberto por testes automáticos (não precisa repetir aqui): typecheck, lint, `arch:db-check`,
`check:migrations` e 408 testes unitários (guard 404, HMAC do cookie, step-up MFA, hash do export,
conversão de centavos, arch read-only). Este documento cobre o que **só** dá para validar com o sistema rodando
(round-trips de banco/RLS, provedores reais, payload no browser).

> Legenda: **Valida** = o que o teste prova · **Passos** = o que fazer · **Esperado** = resultado correto ·
> **SQL** = verificação no banco (Supabase SQL Editor / psql) quando aplicável.

---

## 0. Pré-requisitos (uma vez, ambiente DEV)

- [x] Migração `0028` aplicada em dev (`pnpm db:migrate:dev`).
- [x] Migração `0028` aplicada em prod (`pnpm db:migrate:prod`).
- [x] Bucket privado `admin-exports` criado (dev e prod).
- [x] super_admin criado (dev e prod) + MFA enrolado.
- [x] Dados de teste em dev (`pnpm seed:c15` → `clinica-demo`).
- [ ] `IMPERSONATION_SECRET` no `.env.local` (dev) e na Vercel (prod).
- [ ] **Usuário tenant** para testar 404 por role. Em terminal **sem** `SUPABASE_PROJECT_ENV=prod`:
  ```powershell
  $env:SEED_USER_EMAIL="gestor@exemplo.com"; $env:SEED_USER_PASSWORD="senhaForte123!"; pnpm seed:clinic-user
  ```
- [ ] `pnpm dev` rodando; login como super_admin + TOTP (AAL2) → cai em `/admin`.

> Dica para achar IDs nas verificações SQL:
> `SELECT id, slug, nome FROM clinics WHERE slug='clinica-demo';`

---

## 1. Acesso e 404 absoluto (regra suprema do brief)

### 1.1 Usuário comum (role tenant) recebe 404
- [ ] **Valida:** não-super_admin não acessa nem descobre o painel (OR-A1/A2).
- **Passos:** logout. Login como `gestor@exemplo.com` (role `gestor`). Acesse `/admin`.
- **Esperado:** página **404** (igual a uma rota inexistente). **Nunca** redirect, "unauthorized" ou "forbidden".

### 1.2 Owner recebe 404
- [ ] **Valida:** nem o dono da clínica acessa.
- **Passos:** crie/seed um usuário `owner` (`SEED_USER_ROLE=owner`), login, acesse `/admin`.
- **Esperado:** **404**. (Obs.: não existe role literal "admin" no sistema — os roles tenant são gestor/doctor/attendant/financial/owner; todos devem dar 404.)

### 1.3 super_admin em AAL1 (sem passar o TOTP) recebe 404
- [ ] **Valida:** MFA é obrigatório, não só estar logado.
- **Passos:** logue como super_admin mas **interrompa antes do TOTP** (fique em AAL1) e tente abrir `/admin` direto na URL.
- **Esperado:** **404** (o guard exige `aal2`).

### 1.4 Somente super_admin AAL2 acessa
- [ ] **Valida:** o caminho feliz.
- **Passos:** login super_admin + TOTP → `/admin`.
- **Esperado:** dashboard carrega; sidebar mostra as 8 entradas (Visão geral, Clínicas, Billing, Conversas IA, Métricas, Auditoria, Saúde, Configurações).

### 1.5 Endpoint de export também é gateado
- [ ] **Valida:** o route handler não é uma porta lateral.
- **Passos:** logado como `gestor`, abra `/admin/clinicas/<id>/audit/export?from=2026-06-01&to=2026-06-30`.
- **Esperado:** **404**.

---

## 2. Dashboard / MRR

### 2.1 MRR bate com as faturas pagas do mês
- [ ] **Valida:** MRR = `SUM(invoices.total_amount)` pagas no mês corrente, em tempo real, sem cache (OR-D2 / AC-2).
- **Passos:** abra `/admin`. Anote o card **MRR**.
- **Esperado:** com o seed, **R$ 299,00** (1 fatura paga este mês).
- **SQL (tem que bater):**
  ```sql
  SELECT COALESCE(SUM(total_amount),0) AS mrr FROM invoices
  WHERE status='paid'
    AND paid_at >= date_trunc('month', now())
    AND paid_at <  date_trunc('month', now()) + interval '1 month';
  ```

### 2.2 Cards de clínicas e ARR
- [ ] **Valida:** contadores globais.
- **Esperado:** ARR = MRR×12 (R$ 3.588,00). "Ativas" ≥ 1 (clinica-demo). Churn/crescimento sem erro.

---

## 3. Clínicas

### 3.1 Lista: busca, filtros, paginação
- [ ] **Valida:** operação da lista.
- **Passos:** `/admin/clinicas`. Busque "demo"; filtre status=`active`; filtre billing=`active`; filtre plano `demo`.
- **Esperado:** `clinica-demo` aparece; filtros refinam; paginação aparece se houver muitas clínicas.

### 3.2 Detalhe da clínica
- [ ] **Valida:** agregação read-only por clínica.
- **Passos:** abra `clinica-demo`.
- **Esperado:** dados gerais, plano (Demo R$299/monthly), billing (1 aberta, 1 vencida, último pagamento), usuários, uso de IA (conversas/mensagens/tokens/custo), integrações, últimas auditorias, botão **Impersonar** e bloco **Exportar auditoria**.

### 3.3 UUID inválido → 404
- [ ] **Passos:** acesse `/admin/clinicas/nao-e-uuid`.
- **Esperado:** **404**.

---

## 4. Impersonate (núcleo de segurança)

### 4.1 Iniciar impersonate cria sessão + audit
- [ ] **Valida:** impersonate_start logado e sessão criada (OR-I2 / AC-4).
- **Passos:** no detalhe da `clinica-demo`, clique **Impersonar clínica**.
- **Esperado:** redireciona para `/dashboard` (app tenant), agora **no contexto da clínica**.
- **SQL:**
  ```sql
  SELECT * FROM impersonation_sessions ORDER BY started_at DESC LIMIT 3;
  SELECT action, target_clinic_id, payload, created_at
    FROM super_admin_actions ORDER BY created_at DESC LIMIT 5;   -- deve ter 'impersonate_start'
  ```

### 4.2 Banner permanente em toda tela tenant
- [ ] **Valida:** banner inescondível (OR-I9 / AC-4).
- **Passos:** navegue por várias telas do app tenant (`/dashboard`, `/pacientes`, etc.).
- **Esperado:** barra vermelha no topo em **todas**: "Você está visualizando a clínica **Clínica Demo (C15)** como Super Admin. Todas as ações estão sendo auditadas." Sem botão de fechar; não some ao rolar.

### 4.3 Mutação durante impersonate gera auditoria EXTRA (por referência)
- [ ] **Valida:** 2 registros atômicos por mutação (OR-I8 / AC-5).
- **Passos:** ainda impersonando, faça uma alteração real (ex.: `/pacientes` → criar/editar um paciente).
- **Esperado:** a alteração ocorre normalmente.
- **SQL:**
  ```sql
  -- linha NORMAL:
  SELECT id, action, clinic_id, user_id FROM audit_events ORDER BY created_at DESC LIMIT 3;
  -- linha EXTRA (referência, sem payload duplicado):
  SELECT action, target_clinic_id, payload FROM super_admin_actions
   WHERE action='impersonate_mutation' ORDER BY created_at DESC LIMIT 3;
  ```
  O `payload` da extra deve conter `{ impersonationId, auditEventId }`, e `auditEventId` deve **casar** com o `id` da linha de `audit_events`. "Mesma sessão" = mesmo `impersonationId`.

### 4.4 Encerrar impersonate
- [ ] **Valida:** stop limpa cookie + revoga + loga (OR-I10).
- **Passos:** clique **Encerrar impersonate** no banner.
- **Esperado:** volta para `/admin`; banner some. `super_admin_actions` recebe `impersonate_stop`; `impersonation_sessions.revoked_at` preenchido.

### 4.5 TTL de 1h encerra sozinho (simulado)
- [ ] **Valida:** expiração automática (OR-I4).
- **Passos:** inicie um novo impersonate. Force a expiração no banco e recarregue uma tela tenant:
  ```sql
  UPDATE impersonation_sessions SET expires_at = now() - interval '1 minute' WHERE revoked_at IS NULL;
  ```
- **Esperado:** ao recarregar, **banner some** e o escopo cai (o super_admin volta a não ter clínica — telas tenant que exigem clínica deixam de funcionar; o lugar dele é `/admin`).

### 4.6 Kill switch (revogação) tem efeito imediato
- [ ] **Valida:** revogação no próximo request (OR-I5).
- **Passos:** inicie impersonate; em outra aba, revogue no banco e recarregue a tela tenant:
  ```sql
  UPDATE impersonation_sessions SET revoked_at = now() WHERE revoked_at IS NULL;
  ```
- **Esperado:** banner some / escopo cai no próximo carregamento.

### 4.7 Step-up de MFA (≤10min) ao iniciar
- [ ] **Valida:** prova fresca de MFA para impersonar (OR-I1).
- **Passos:** opção (a) fique >10min logado sem reautenticar TOTP e clique Impersonar; opção (b) teste rápido trocando temporariamente `requireRecentAal2(10)` → `requireRecentAal2(0)` em `actions/impersonation.ts` e clicando Impersonar.
- **Esperado:** redireciona para `/login/mfa` (re-challenge); **nenhuma** sessão criada. (Reverta a alteração temporária.)

### 4.8 Super admin NÃO altera dados fora do impersonate
- [ ] **Valida:** painel read-only sobre dados de clínica (OR-A3 / AC-7).
- **Passos:** sem impersonar, navegue por todo o `/admin`.
- **Esperado:** não existe nenhum botão/form que edite dados de uma clínica (só Impersonar e Exportar). A única forma de alterar é via impersonate.

---

## 5. Billing (somente leitura)

### 5.1 Visão geral correta
- [ ] **Valida:** abertas/vencidas/dunning/refunds/MRR/ARR (AC-11).
- **Passos:** `/admin/billing`.
- **Esperado:** com o seed → 1 fatura **aberta** e 1 **vencida** listadas (R$299 cada); MRR R$299; ARR R$3.588. Dunning/refunds vazios (a menos que você crie). Nada editável.
- **SQL (conferir abertas/vencidas):**
  ```sql
  SELECT status, count(*) FROM invoices GROUP BY status;
  ```

---

## 6. Conversas IA (descriptografia server-side)

### 6.1 Mensagens aparecem em texto claro
- [ ] **Valida:** decrypt server-side (OR-D1 / AC-8).
- **Passos:** `/admin/conversas-ia` → filtre clínica `Clínica Demo (C15)` → clique na conversa.
- **Esperado:** as 2 mensagens do seed aparecem **legíveis** ("Olá, gostaria de agendar…" / "Claro! Temos horários…").

### 6.2 O browser NUNCA recebe ciphertext
- [ ] **Valida:** ciphertext não cruza servidor→cliente (OR-D1 / AC-8).
- **Passos:** com a conversa aberta, DevTools → aba **Network** → recarregue → abra a resposta do documento/RSC dessa rota. Ctrl-F por um trecho do `content_encrypted` (pegue do banco abaixo) e por "Olá, gostaria".
  ```sql
  SELECT left(content_encrypted, 24) FROM ai_messages
   WHERE clinic_id = (SELECT id FROM clinics WHERE slug='clinica-demo') LIMIT 1;
  ```
- **Esperado:** o **texto claro** aparece na resposta; o **base64 cifrado NÃO** aparece em lugar nenhum. Nenhuma chamada de API retornando ciphertext.

### 6.3 Falha de decrypt não vaza ciphertext
- [ ] **Valida:** degradação segura (edge case).
- **Passos (opcional):** corrompa o `content_encrypted` de 1 mensagem no banco (ex.: concatene "XX") e reabra a conversa.
- **Esperado:** aquela mensagem mostra `"[conteúdo indisponível]"`; as outras seguem legíveis; nenhum ciphertext exibido.

---

## 7. Métricas

### 7.1 Cards de uso (30 dias)
- [ ] **Valida:** DAU/WAU/clínicas ativas/conversas/mensagens/tokens/custo Gemini/média diária.
- **Passos:** `/admin/metricas`.
- **Esperado:** cards simples (sem gráfico), com números coerentes (ex.: mensagens ≥ 2 do seed; custo Gemini > 0).

---

## 8. Auditoria cross-tenant

### 8.1 Busca e filtros
- [ ] **Valida:** busca cross-tenant com filtros.
- **Passos:** `/admin/audit` → filtre por clínica `Clínica Demo (C15)`; por ação (ex.: `patient.created`); por período.
- **Esperado:** tabela com colunas timestamp / ação / entidade / tenant / usuário / IP / resultado; filtros refinam; paginação funciona.

---

## 9. Export PDF de auditoria (hash + signed URL)

### 9.1 Gera PDF com SHA256 e link de 7 dias
- [ ] **Valida:** export operacional + hash válido + signed URL (AC-9).
- **Passos:** detalhe da `clinica-demo` → bloco **Exportar auditoria** → escolha De/Até cobrindo hoje → **Exportar PDF**.
- **Esperado:** aparece um link "Baixar PDF (N eventos) — válido por 7 dias" + um **SHA256**. Clique no link.
- **Confirmações:**
  - [ ] O PDF abre (download via signed URL funciona).
  - [ ] O SHA256 no **rodapé do PDF** == o SHA256 mostrado na tela.
  - [ ] `super_admin_actions` recebeu `audit_export` com `{from,to,sha256,rowCount}`:
    ```sql
    SELECT action, payload FROM super_admin_actions WHERE action='audit_export' ORDER BY created_at DESC LIMIT 1;
    ```

### 9.2 Range inválido / vazio
- [ ] **Valida:** edge cases do export.
- **Passos:** tente De > Até; depois um período sem eventos.
- **Esperado:** De>Até → erro 400 (mensagem), nada gerado. Período vazio → PDF "sem eventos", `rowCount` 0, hash válido.

---

## 10. Saúde (health) — disponibilidade, não uso

> O painel faz **probe ativo** (chamada real) a cada carregamento. Estado normal em dev: Supabase verde,
> Gemini verde (chave válida), Meta verde (Graph alcançável), Asaas verde se `ASAAS_API_KEY` válida.

### 10.1 Baseline operacional
- [ ] **Passos:** `/admin/saude`.
- **Esperado:** 4 cards (Supabase / Gemini / Meta / Asaas) com cor, razão, latência e "último sucesso".

### 10.2 Gemini offline → VERMELHO (mesmo sem tráfego)
- [ ] **Valida:** mede disponibilidade, não volume (OR-H1 / AC-10).
- **Passos:** no `.env.local`, esvazie/invalide `GEMINI_API_KEY` (ex.: `GEMINI_API_KEY=`), reinicie `pnpm dev`, abra `/admin/saude`.
- **Esperado:** card Gemini **vermelho** ("GEMINI_API_KEY ausente" ou HTTP de erro). **Reverta** a chave depois.

### 10.3 Meta com falha de envio → VERMELHO; indeterminado → AMARELO
- [ ] **Valida:** regra existente (failed=down, unknown=degraded).
- **Passos (SQL, última hora):**
  ```sql
  -- vermelho (envio falho):
  INSERT INTO outbound_messages (clinic_id, idempotency_key, to_number_hash, content_encrypted, status, created_at)
  VALUES ((SELECT id FROM clinics WHERE slug='clinica-demo'), 'demo:'||gen_random_uuid(), 'hash', 'x', 'failed', now());
  -- amarelo (indeterminado): use status='unknown' (e garanta que não há 'failed' na última hora).
  ```
  Recarregue `/admin/saude`.
- **Esperado:** com `failed` na última hora → Meta **vermelho**; só com `unknown` → **amarelo**. (Limpe os registros de teste depois.)

### 10.4 Supabase down → VERMELHO
- [ ] **Valida:** liveness do banco.
- **Passos (opcional):** derrube a conectividade do banco (ou pause o projeto Supabase) e recarregue.
- **Esperado:** card Supabase **vermelho**.

---

## 11. Configurações (somente leitura)

### 11.1 Planos / prompt / templates
- [ ] **Valida:** read-only.
- **Passos:** `/admin/config`.
- **Esperado:** plano `demo` (R$299/monthly) listado; versão + hash do prompt da IA; idioma + nomes dos templates Meta. **Nada editável** (sem inputs/botões de salvar).

---

## 12. Regressão (não quebrou o resto)

### 12.1 App tenant normal segue funcionando
- [ ] **Valida:** as mudanças em tenant-context/funis de audit não afetaram clínicas.
- **Passos:** login como `gestor@exemplo.com` (sem impersonate) → use `/pacientes`, `/caixa`, etc.
- **Esperado:** tudo normal; **sem** banner de impersonate; criar/editar paciente gera `audit_events` normal e **NENHUMA** linha em `super_admin_actions`.
  ```sql
  -- não deve crescer ao mutar como tenant normal:
  SELECT count(*) FROM super_admin_actions WHERE action='impersonate_mutation';
  ```

---

## Mapa de cobertura (checklist obrigatória do brief)

| Item do brief | Teste |
|---|---|
| usuário comum → 404 | 1.1 |
| owner → 404 | 1.2 |
| "admin" (qualquer role tenant) → 404 | 1.1 / 1.2 |
| apenas super_admin acessa | 1.3 / 1.4 |
| impersonate cria audit | 4.1 |
| banner sempre aparece | 4.2 |
| TTL encerra impersonate | 4.5 |
| mutações geram auditoria extra | 4.3 |
| PDF export gera hash válido | 9.1 |
| signed URL funciona | 9.1 |
| MRR bate com invoices | 2.1 |
| billing overview correto | 5.1 |
| conversas IA descriptografadas server-side | 6.1 |
| browser nunca recebe ciphertext | 6.2 |
| health reflete falhas reais | 10.2 / 10.3 / 10.4 |
| Gemini offline → vermelho | 10.2 |
| Meta offline → amarelo/vermelho | 10.3 |
| (extra) kill switch / step-up MFA / read-only | 4.6 / 4.7 / 4.8 |

Quando todas as caixas estiverem marcadas, o C15 está aceito funcionalmente.

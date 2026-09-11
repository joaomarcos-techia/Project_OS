# Segurança do Qoro — o que foi feito, como, e o que falta

**Atualizado em 2026-09-11.** Este arquivo é o ponto de entrada. Ele não repete
evidência: aponta para onde ela está e diz, em uma linha por item, o que dá para
afirmar e o que não dá.

Regra que vale para o documento inteiro: **PASS é a asserção que rodou, não
liberação do produto.** Onde um teste usa dependência substituída, está escrito.
Onde nada foi executado, está escrito "não testado" — e não "provavelmente ok".

---

## 1. Mapa dos documentos

| Arquivo | O que é | Gerado? |
| --- | --- | --- |
| [model.md](./model.md) | Modelo de segurança do produto (camadas de controle) | manual |
| [endurecimento-local.md](./endurecimento-local.md) | Relatório da auditoria: achados, diffs, saídas brutas | manual |
| [acoes.md](./acoes.md) | Inventário vivo: 174 Server Actions + 33 métodos HTTP, guard por superfície | **gerado** — `pnpm security:inventory` |
| [riscos.md](./riscos.md) | Registro de risco com prazo; nenhum item aceito | **gerado** — `pnpm security:risks` |
| [SECURITY-DELTA.md](./SECURITY-DELTA.md) | Triagem da auditoria adversarial externa: SEC-001..050 confirmado/refutado contra o código | manual |
| [webhooks.md](./webhooks.md) | Ingress externo: os 3 webhooks, autenticação e dedup | manual |
| [ia-privacidade.md](./ia-privacidade.md) | Superfície da IA e privacidade | manual |
| [inventory-before.json](./inventory-before.json) | Snapshot imutável do estado inicial (baseline das catracas) | **gerado, não regravar** |

Arquivo gerado editado à mão reprova no CI. É de propósito: se a prosa que a
pessoa lê pode divergir da regra que o gate aplica, o documento deixa de ser
evidência.

---

## 2. Como rodar tudo

```bash
pnpm security:check
```

Encadeia seis etapas, nesta ordem, e para na primeira que falhar:

| Etapa | O que faz | Duração típica |
| --- | --- | --- |
| `security:inventory` | AST de `src`: toda action, rota e leitura de env; reprova guard não resolvido, `NEXT_PUBLIC_` sem dono e rota nova sem teste | ~1 min |
| `security:unit` | testes focados em segurança (252 na última execução) | ~40 s |
| `security:tenant` | Sobe um Postgres temporário próprio e exercita RLS real com duas clínicas | ~1 min |
| `security:build` | `next build` numa cópia SEM `.env`, com canários sintéticos | ~3,5 min |
| `security:bundle` | Varre os 166 arquivos de cliente por segredo, chave privada e script do Vercel Live | ~5 s |
| `security:http` | Sobe o build e ataca `127.0.0.1`: vetores de borda, CSRF, cabeçalhos, 306 requisições de action | ~2 min |

Pré-requisitos por máquina: Node 22, pnpm 11.17 e binários do Postgres 17
(`initdb`, `postgres`, `pg_ctl`). Se não estiverem no caminho padrão, exporte
`SECURITY_PG_BIN`. **Nenhum segredo novo é necessário** — os scripts não leem
`.env.local` nem aceitam URL externa.

Última execução completa, em processo único: **`EXIT=0`**. Suíte inteira do
repositório: **3251 testes, 350 arquivos, verde**.

---

## 3. O que foi corrigido, e como

Ordenado pelo peso do achado. "Como" descreve a decisão, não só o arquivo.

### Peso 9,5 — Webhook lia o corpo inteiro antes de aplicar o limite

Os dois webhooks Asaas alocavam o payload completo em memória e só então
checavam o tamanho — o teto não protegia contra o corpo grande, porque já tinha
sido pago. Passou a existir `src/lib/http/webhook-body.ts`, compartilhado com o
Meta, que **corta durante a leitura** e cancela o stream antes do restante.
Autenticação e dedup já existiam; nada de assinatura nova foi inventado.

### Peso 9 — Server Action exportada sem guard

`auditExportLimits` era export alcançável sem sessão. Devolvia só um número, mas
a questão é o padrão: export em arquivo `'use server'` é endpoint. Removida (não
tinha uso). O que impede a próxima é o inventário AST: toda superfície precisa
resolver até um guard conhecido, ou o CI reprova.

### Peso 9 — IA com acesso de escrita

15 vetores adversariais determinísticos rodando contra registry, schemas e
políticas **reais** no CI. Nenhuma tool de prontuário, criação de cobrança ou
mensagem em massa está exposta no catálogo. Isto não mede o modelo — ver §4.

### Peso 8,5 — Autorização no middleware

A decisão real já era no servidor (`authenticate()` confere epoch contra o banco
a cada request). O que faltava era prova e trava: 12 vetores de bypass de borda
contra `/api/health` no build real, mais o gate AST.

### Peso 8 — Isolamento entre clínicas

Postgres temporário próprio, helpers SQL e policy **reais** das migrations,
`withTenant` real com role `authenticated`. A leu, editou e apagou recurso de B:
zero linhas nos dois sentidos; INSERT com `clinic_id` estrangeiro rejeitado por
RLS (42501); teardown com zero fixtures.

### Peso 8 — O role-switch que isola podia falhar em silêncio

`withTenant` trocava o papel da transação para `authenticated` e seguia. Se essa
troca falhasse como erro duro, tudo bem — a transação abortava. Mas se ela
**silenciosamente não surtisse efeito**, todas as queries rodariam com o papel
BYPASSRLS do pool: dados de todos os tenants, sem erro, sem log, com aparência de
normalidade. Era a única forma de perder isolamento sem deixar sinal.

Agora o papel efetivo é **verificado** antes de qualquer callback rodar, e a
leitura de `current_user` viaja na mesma ida ao banco do `set_config` que já
existia — custo zero de round-trip nos 162 call sites. Divergiu, aborta.

E a premissa deixou de ser crença: `pnpm security:tenant` roda um **contrafactual**
em Postgres real provando que a mesma policy, com o papel do pool, **lê** a linha
da outra clínica. Quem isola é o `SET LOCAL ROLE`, não a RLS sozinha.

### Peso 7 — CSRF e cookie de sessão

Origem forjada (`https://evil.test`) com cookie: rejeitada pelo Next antes da
ação. E os atributos do cookie de sessão deixaram de depender do default do
`@supabase/ssr`: `hardenCookie` força `httpOnly` e `SameSite=Lax` mesmo que a
biblioteca peça o contrário, com `secure` acompanhando o ambiente para não
quebrar login em `http://localhost`.

### Peso 6,5 — Logout confirmava revogação que falhou

`logout/route.ts` ignorava o erro devolvido pela revogação e respondia sucesso.
Um refresh token podia continuar vivo com o usuário achando que saiu. Agora
exige retorno positivo do epoch, confere o erro do `signOut` e devolve 503 em vez
de mentir.

### Peso 6 — Sentry vazava corpo e PII

O scrub deixava passar nome, convênio e o body inteiro. `sentry-scrub.ts` elimina
o body; `sanitize/keys.ts` redige os campos e seus aliases. O teste **falhava
antes e passa depois** — com CPF, nome, convênio, cookie e authorization no
payload simulado.

### Peso 6 — Negativa de autorização não deixava sinal

Sondar escopo (id de outro tenant, escalada de papel) produzia apenas uma
sequência de 403 que ninguém contava. Detecção cega é o que transforma um ataque
de horas num de meses. O construtor de `AuthError` passou a emitir
`authz.denied` — ponto pelo qual toda negativa passa, sem decorator para alguém
esquecer numa rota nova. Erro de configuração (500) não emite: envenenaria o
painel no dia de um deploy com env faltando.

### Peso 6 — Nada impedia autenticar num projeto e ler o banco de outro

`src/lib/env-coherence.ts`, ligado ao parse de env: o project ref de
`NEXT_PUBLIC_SUPABASE_URL` precisa bater com o do `DATABASE_URL`. Divergir
significa sessão validada por um emissor e dados vindos de outro — o `clinic_id`
do JWT não corresponde ao banco consultado. Preview declarando `prod` também
reprova. O que NÃO é detectável de dentro do deployment está dito no arquivo e no
registro de risco.

### Peso 5 — Leitura de prontuário não deixava rastro (LGPD)

`toProntuarioDetail` decifra o SOAP, e as duas telas que o chamavam devolviam o
conteúdo em claro sem uma linha em `audit_events`. Só o PDF e as mutações tinham
trilha. Agora `readProntuarioAudited` grava `clinical.prontuario.viewed` **na
mesma transação da leitura**, com `user_id` vindo de `requireUser()` — nunca de
argumento —, `after` só com metadado, e cross-reference em `super_admin_actions`
quando é suporte impersonando. Se o audit falhar, a leitura falha junto: o SOAP
não sai da função. A superfície também encolheu — `getProntuarioByAppointment`
foi removido e `getProntuarioById` deixou de ser exportado.

### Peso 3 — CSP não bloqueava nada

O achado não era "está em Report-Only": era `connect-src 'self' https: wss:`, que
deixava **qualquer** script mandar prontuário para **qualquer** host TLS enquanto
o navegador só reclamava no console. Agora:

- cabeçalho **bloqueante**;
- `connect-src` e `img-src` por origem nomeada (Supabase derivado do env, SDK do
  Facebook), porque imagem exfiltra igual (`new Image().src = '…?'+dado`);
- `'unsafe-eval'` removido — **medido**: zero ocorrências de `eval(` e
  `new Function(` nos 161 chunks de cliente do build de produção;
- `'unsafe-eval'` volta só em `NODE_ENV=development`, onde o React Refresh precisa.

Verificado em browser real, não só em unidade: a página renderiza inteira, React
hidrata, valor digitado chega ao input controlado.

### Peso 3 — Teto de custo de IA não existia

Pior que o relatado: `checkQuota` devolvia `Infinity` **e não tinha caller
nenhum**. Os tetos existentes limitam um turno; nada limitava a soma. Agora há
janela deslizante de 60 min por clínica sobre `ai_messages.cost_usd`, com teto de
US$ 1,00 — conta escrita no código: ~US$ 0,0017 por turno ⇒ ~600 turnos/hora na
mesma clínica. Estourou: fallback operacional **sem chamar o provider**, escalona
para humano, e sai `ai_agent.quota.blocked`.

### Higiene — SEO, robots, sitemap

**Não se aplica.** Não há área pública: `/` redireciona para `/login`.

---

## 4. O que está pendente

Fonte única e aplicada por teste: [riscos.md](./riscos.md), gerado de
`scripts/security/risk-register.ts`. Todo item está `pendente` — **nenhum risco
foi aceito em nome de ninguém.** Um aceite de verdade exige `status: aceito`,
dono com nome e `validoAte`; o gate recusa aceite sem prazo, anônimo ou vencido.

**Todos vencem em 2026-12-09.** Nessa data o CI fica vermelho até alguém reabrir
os itens. É o comportamento pedido: aceite sem prazo vira política do sistema por
dez anos.

### Dá para fechar nesta máquina

| Risco | O que falta |
| --- | --- |
| `webhook-replay-persistido` (9,5) | Provar as constraints UNIQUE e o rollback no Postgres real — o teste atual usa dependência substituída |
| `idor-http-dois-usuarios` (8) | Exercitar IDOR por HTTP com dois usuários autenticados; hoje a prova é do caminho SQL |
| `csrf-sessao-valida` (7) | Repetir o CSRF com cookie Supabase **válido** e cobrir double-submit nas ações de dinheiro |
| `csp-nonce-inline-script` (3) | Trocar `'unsafe-inline'` por nonce — exige ampliar o matcher do middleware sem quebrar o redirect de `/login` |
| `ia-teto-custo-corrida` (2) | Reserva transacional antes da chamada ao LLM; hoje turnos paralelos podem ultrapassar em centavos |

Os três primeiros dependem de um Supabase Auth **local** com dois usuários
sintéticos. Esse é o desbloqueio de maior alavancagem que sobrou.

### Depende de console externo — não dá para fechar daqui

| Risco | Onde se resolve |
| --- | --- |
| `ia-gemini-adversarial` (9) | `pnpm ai:adversarial` com `GEMINI_API_KEY` real. 51 mensagens, ~60–110 chamadas, <US$ 0,05. Escreve `docs/audits/C11_ADVERSARIAL_50.md` e a avaliação é **manual por design** |
| `inventario-acesso-rotacao` (6,5) | Preencher dono, emissão, rotação e validade de cada chave (Supabase, Meta, Asaas, Gemini, Redis, Sentry, CRON, HMAC). Consulta em `scripts/security/access-inventory.sql` |
| `sentry-regiao-retencao` (6) | Console do Sentry, org `qoro-1v`, projeto `qoro`. Região de ingestão é **US** (`ingest.us.sentry.io`) — decisão escrita sobre dado de saúde saindo do país; mais retenção, data scrubbing do servidor e quem tem acesso à org |
| `lgpd-registro-tratamento` (5) | Registro de tratamento, base legal e rotina de descarte aceitos pelo **controlador**. Documento, não código |
| `dmarc-inerte` (3) | Painel de DNS (Hostinger) — ver §5 |
| `spf-apex-ausente` (2) | Painel de DNS — ver §5 |
| `mfa-contas-operacionais` (2) | MFA conta a conta nos consoles |

---

## 5. DNS e e-mail — medido em 2026-09-11

Consulta pública contra `8.8.8.8`. Isto **foi executado**, não é recomendação.

| Registro | Resultado | Leitura |
| --- | --- | --- |
| `_dmarc.qoro.dev` TXT | `v=DMARC1; p=none;` | **Inerte.** Não rejeita nada e não tem `rua=`: ninguém recebe os relatórios. O registro existe e não faz nada |
| `qoro.dev` TXT | só `google-site-verification` e `hosting-site` | **Sem SPF no apex** |
| `qoro.dev` MX | ausente (devolve SOA) | **Ninguém recebe e-mail em @qoro.dev** |
| `send.qoro.dev` TXT | `v=spf1 include:amazonses.com ~all` | SPF correto no subdomínio de envio (Resend usa SES) |
| `resend._domainkey.qoro.dev` | chave pública presente | DKIM configurado |
| `qoro.dev` NS | `ns1/ns2.dns-parking.com` | DNS na Hostinger |

O envio está certo (SPF no subdomínio + DKIM). O que falha é a **política**: com
`p=none` e sem `rua`, spoofing de `@qoro.dev` para paciente ou clínica passa e
não há telemetria para perceber.

Ordem de correção, no painel da Hostinger:

1. Acrescentar `rua=mailto:<caixa-que-alguém-lê>` ao DMARC e **observar** os
   relatórios por algumas semanas.
2. Publicar `v=spf1 -all` no apex, já que ele nunca envia.
3. Só depois subir para `p=quarantine` e, com os relatórios limpos, `p=reject`.
   Subir antes de observar derruba e-mail legítimo.

Nota que muda o modelo de ameaça: como não há MX, a recuperação de conta do time
acontece em caixas de terceiros. O controle que protege o acesso ao sistema é
**MFA nas contas operacionais** (Supabase, Vercel, Asaas, Meta, registrador) — não
um registro de DNS.

---

## 6. O que o CI trava

Sem gate, em sistema interno sem auditoria externa, o controle morre na primeira
sprint apertada. O que reprova hoje:

- CSP virar Report-Only, perder diretiva estrutural, aceitar esquema solto
  (`https:`/`wss:`/`http:`), curinga, `'unsafe-eval'` ou terceiro não nomeado;
- `allowedOrigins` de Server Action com curinga; `allowedDevOrigins` fora de loopback;
- Server Action ou rota nova sem guard resolvido, ou fora do inventário vivo;
- `NEXT_PUBLIC_` sem dono no registro — **e** entrada no registro que o código não
  usa mais (registro que envelhece deixa de ser evidência);
- rota nova sem `route.test.ts`, e rota que já tinha perder o teste;
- `vercel.live` ou segredo no bundle de produção;
- `/api/health` cedendo a qualquer um dos 12 vetores de borda;
- leitor de prontuário decifrado nascendo fora do caminho auditado;
- `checkQuota` perder o caller, ou o teto passar a rodar depois do provider;
- túnel do Sentry deixar de engatar enquanto a CSP não libera o host de ingestão;
- risco aceito sem prazo, anônimo ou vencido.

### Uma armadilha que já mordeu

Um build interrompido deixou `dist/security-local/app/.next` truncado; o build
seguinte reaproveitou o cache e as verificações rodaram contra um artefato que
não correspondia ao source — `/api/health` respondeu 500 onde deve responder 401
e parecia achado do produto. `local-build.ts` passa a apagar a saída anterior
antes de copiar. **Fixture que envelhece em silêncio é pior que fixture que
falha, porque passa parecendo verde.**

---

## 7. Escopo — o que este trabalho não é

- Nada foi publicado, nenhuma migration do produto rodou, nenhum provedor foi
  operado. Tudo local, contra o checkout.
- O diff de segurança convive no working tree com o redesenho de UI, de outra
  sessão, preservado intacto. **Nada foi commitado.**
- As telas autenticadas e o fluxo do Embedded Signup do WhatsApp não foram
  abertos em browser — exigem sessão Supabase local.
- O CI remoto nunca rodou estes passos: `security:tenant` depende de
  `pg_config --bindir` resolver no runner Linux, e isso só a primeira execução
  remota confirma.

# Revisão intermediária do Qoro v2 — 14/09/2026

Status: **Reference — checkpoint de desenvolvimento; D126–D131 remediados localmente no diff de retomada.**

O fundador esclareceu que o Qoro v2 estava no meio da execução. Esta revisão não declara o
roadmap concluído nem avalia uma entrega final. Ela registra comportamentos reproduzidos no
HEAD `a9621e8`, branch `redesign/qoro-ui-v4`, após o lote de segurança `beafacf` e as mudanças
posteriores do cadastro. A revisão em si não corrigiu código; a retomada posterior na mesma base
implementou D126–D131 e a tela das quatro perguntas da ADR-060. O Qoro v2 completo continua em
desenvolvimento.

O [qorov2 §35](../qorov2.md#35-checkpoint-de-retomada--revisão-intermediária-de-14092026)
é o checkpoint canônico; o [prompt de retomada](../prompts/retomada-qorov2-2026-09-14.md)
define a execução seguinte. Os IDs abaixo pertencem ao [Discovery Log](../discovery-log.md).

## Achados e critérios de fechamento

### D126 — P1: cookie HttpOnly incompatível com os consumidores do browser

`src/lib/auth/supabase-server.ts:90` força `httpOnly: true`. `/auth/confirm` grava a sessão no
servidor, mas `src/app/(app)/convite/page.tsx:55` ainda a procura por
`createBrowserClient().auth.getUser()`: não encontra usuário e mostra convite inválido.
`src/lib/realtime/use-consultorio-realtime.ts:47` também espera o access token no evento
`INITIAL_SESSION` para autenticar o Realtime.

Reprodução executada com Chromium, SDK Supabase instalado e `hardenCookie` extraído do source
atual, usando Auth sintético local: cookie armazenado nos dois casos; controle anterior retorna
usuário e token; com HttpOnly retorna `AuthSessionMissingError`, sem HTTP de validação e sem token
em `INITIAL_SESSION`. Isso prova o conflito cookie/SDK, não uma jornada contra Supabase externo.

Fechamento: escolher o contrato de sessão compatível com os consumidores reais; preservar a
autoridade no servidor. Provar aceite de convite até submissão, negativo inválido/expirado,
autenticação e atualização do Realtime. Não dar como corrigido apenas por um teste dos atributos
do cookie; não criar endpoint que exponha tokens como atalho.

**Reteste local D126 — PASS no diff de 14/09.** Um contrato compartilhado fixa o cookie Supabase
em `httpOnly: false`, `SameSite=Lax` e `Secure` em produção. Com o SDK instalado e transportes Auth
HTTP/Realtime WebSocket sintéticos por loopback, 5 casos de navegador cobrem confirmação do convite
até a Server Action/redirect, senha divergente, convite inválido/expirado, join autenticado,
propagação de refresh/evento, fechamento do canal após logout e ausência de join anônimo sem sessão.
Testes adicionais preservam
login, recuperação, MFA e logout. A autorização de requests/actions permanece no servidor; a do
Realtime, no JWT sob RLS. Supabase externo e RLS real são **NOT TESTED** nessa prova. O risco de
access/refresh token legível diante de XSS foi registrado como
`supabase-session-browser-readable`, pendente e sem aceite.

### D127 — P1: cadastro não integrado ao gate de segurança

`pnpm security:check` encerrou com exit 1 em `scripts/security/inventory.ts:50`. O inventário
encontrou 174 actions, 37 métodos HTTP, 190 leituras de env e 8 nomes públicos:

- `REVIEW_REQUIRED` em POST `/api/signup/sessions`, GET `/api/signup/sessions/me` e POST
  `/api/signup/sessions/answers`;
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `_DEV` e `_LOCAL` sem registro;
- ausência de `route.test.ts` nas três rotas acima e em `/api/cron/signup-sessions-cleanup`.

Fechamento: revisar a fronteira pública de cada rota, registrar política explícita verificável,
classificar as variáveis públicas, adicionar testes comportamentais adjacentes e regenerar o
inventário após revisão do diff. Apenas escrever o Markdown não resolve as outras violações.
`REVIEW_REQUIRED` não prova ausência de proteção; prova falta de integração à revisão exigida.
Não desativar o gate nem aceitar rotas genericamente por estarem sob `/signup`.

### D128 — P2: limite de corpo aplicado após leitura integral

`src/app/api/signup/sessions/route.ts:61` usa `req.text()` antes de aplicar o limite de 1.024 bytes.
Sem Content-Length, o handler leu **8.388.608 bytes**, não cancelou o stream e só então respondeu 413. O rate limit da criação fica depois dessa leitura. A sequência também existe em
`sessions/answers/route.ts:62`, embora a medição de 8 MB tenha exercitado a criação.

Fechamento: limitar bytes durante a leitura nas duas rotas, reutilizando o leitor existente em
`src/lib/http/webhook-body.ts` quando compatível. Testar streaming sem Content-Length,
cancelamento antecipado, fronteira do limite, Unicode e JSON inválido. O teste precisa provar
que o restante não foi consumido, não apenas receber 413 após alocar tudo. Conferir a coerência
entre o teto da rota e o tamanho permitido ao token Turnstile, sem presumir tamanho do provider.

### D129 — P2: sessão vencida por inatividade recebe conflito

`src/contexts/onboarding/internal/signup-answers.ts:145–149` verifica o prazo absoluto, mas omite
`idleExpiresAt` na consulta que diferencia conflito de sessão morta. Com idle vencido e prazo
absoluto válido, a escrita é recusada, porém `/answers` devolve **409** em vez de **410** e não
limpa o cookie. A leitura real da mesma sessão retorna `null`.

Reprodução em Postgres temporário com migrations 0096–0098 e funções/handler reais: sessão viva
grava e avança versão; versão antiga dá conflito; token desconhecido dá gone; idle vencido dá
incorretamente conflito. Não houve escrita na sessão expirada. Fixtures removidas com readback zero.

Fechamento: distinguir 409 apenas para conflito de versão em sessão utilizável; 410 para idle ou
prazo absoluto vencido, bloqueada, consumida ou desconhecida conforme contrato. Testar handler,
persistência, limpeza do cookie e concorrência entre abas, preservando CAS e renovação limitada
pelo prazo absoluto.

### D130 — P2: cookie malformado gera URIError não tratado

`src/app/api/signup/sessions/me/route.ts:51` chama `decodeURIComponent` sobre entrada externa.
O handler real com `__Host-qoro_signup=%` lançou `URIError`. A mesma operação aparece em
`sessions/answers/route.ts:40`; a reprodução foi feita em GET `/me`.

Fechamento: tratar especificamente codificação inválida como sessão inutilizável nas duas rotas,
preservando a resposta uniforme e limpeza do cookie. Testar `%`, sequência truncada, vazio,
ausente, token desconhecido e válido. Não capturar genericamente falhas de banco como gone.

### D131 — evidência documental atribuída ao endpoint errado

A §34.3.B do qorov2 atribuía nove casos de `e2e/signup-session-api.spec.ts` a `/answers`. O spec
não chama esse endpoint: exercita criação e `/me`. `signup-answers.test.ts` cobre o schema,
não executa `recordSignupAnswers`. A atribuição foi corrigida documentalmente; a prova de
`/answers` continua pendente até um teste real cobrindo seu contrato.

Fechamento: adicionar os casos do endpoint e depois da tela, identificando ambiente, cenário e
resultado. Preservar os nove casos existentes como evidência do que de fato exercitam. Não marcar
a feature como entregue por ter apenas backend. Na data da reprodução a tela ainda era trabalho
planejado; o reteste abaixo registra sua implementação posterior.

## Reteste do diff local de retomada

- **D127:** políticas específicas das três rotas públicas, site keys Turnstile registradas e secret
  só no servidor; 45 testes adjacentes de rota + 2 do registro de env. Os documentos `acoes.md` e
  `riscos.md` vieram dos geradores.
- **D128/D130:** 41/41 nos handlers de criação, `/me` e `/answers`, incluindo limite por bytes,
  multibyte, JSON inválido, stream de 8 MiB cancelado cedo e cookies ausentes/vazios/malformados.
  Exceções operacionais continuam propagadas.
- **D129/D131:** Postgres 17 temporário com migrations 0096–0098 e handlers reais. O runner prova
  vencedor único no CAS, 409 apenas com sessão viva, 410/limpeza/zero mutação nos estados mortos,
  constraints/grants, janitor e readback sanitizado das quatro respostas.
- **Tela `/cadastro`:** 11 testes de componente e jornada Chromium sobre build/handlers/Postgres
  locais. São quatro perguntas fechadas, 17 radios, nenhum texto livre/PII; cobre StrictMode,
  teclado/foco/labels, envio único, duas abas/CAS, reload, expiração, 429, rede e desafio. O runner
  completo registrou 14 checks PASS, cleanup zero e processos próprios encerrados.

Essa evidência é **local**. Cloudflare, Supabase, Preview, produção e CI remoto não foram usados nem
alterados; continuam **NOT TESTED** nesta retomada. O próximo produto é identidade + consentimento +
nome da clínica na mesma tela, não simulado nesta entrega.

## Baseline executada nesta revisão

**Reteste de correção na mesma base + diff local, 14/09:** D126 passou 65/65 regressões; o lote de
cadastro passou 120/120 focados e o runner Postgres/browser registrou 14 checks PASS. O negativo de
sessão consumida também revelou `consumed_at` ignorado; corrigido no predicado de sessão viva e no
UPDATE/CAS. Detalhes, comandos e limites em
[qorov2 §35.5](../qorov2.md#355-retomada-local-concluída--14092026). A tabela abaixo registra a
execução final do diff atual; as reproduções anteriores permanecem descritas em cada achado.

| Verificação                            | Resultado                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Node / pnpm                            | 22.16.0 / 11.17.0                                                                                                              |
| Typecheck, lint, formatação            | PASS, exit 0                                                                                                                   |
| `pnpm test:coverage`                   | PASS: 3.424 testes, 367 arquivos; thresholds atendidos                                                                         |
| Cobertura                              | linhas/statements 50,32%; funções 56,20%; branches 81,02%                                                                      |
| `pnpm security:unit`                   | PASS: 261 testes, 22 arquivos                                                                                                  |
| `pnpm security:tenant`                 | PASS: A↔B; operações estrangeiras=0; próprias=1; INSERT estrangeiro 42501; contrafactual BYPASSRLS; fixtures=0; cluster parado |
| Build real isolado                     | PASS, sem `.env`/credencial real                                                                                               |
| Bundle                                 | PASS: 163 arquivos, zero achados nos detectores configurados                                                                   |
| HTTP local                             | PASS nos critérios do runner: 12 vetores health, 153 actions/306 requisições, rejeição nativa de Origin e CSP bloqueante       |
| Playwright público local               | PARTIAL: 6 passaram, 2 skipped por ausência de configuração Turnstile                                                          |
| Arch DB / migrations / observabilidade | PASS: 1.230 arquivos/zero achados; análise estática de migrations; 19 crons e 7 eventos coerentes                              |
| Ciclos / grafo                         | PASS: madge sem ciclo em 1.151 arquivos, com um warning; grafo 56 elementos/298 arestas/zero ciclos                            |
| Registry strict                        | PASS: catálogo 67, registry 25, 42 producer-ahead; ambiente sintético/cwd isolado                                              |
| `pnpm security:check`                  | PASS: inventário, unit, tenant, build, bundle e HTTP                                                                           |
| Cadastro Postgres/Chromium             | PASS: 14 checks, cleanup zero e processos próprios encerrados                                                                  |
| Estado do checkout após reteste        | Diff local não commitado; alterações anteriores preservadas; sem publicação ou escrita externa                                 |

Artefatos locais, ignorados pelo Git: `dist/security-review-2026-09-14/`. Contêm logs, arquivos
`.exit`, `cookie-browser-repro.cjs`, `cookie-browser-results.json`, `signup-review.ts` e
`signup-review-results.json`. São auxiliares, não dependência obrigatória de outro checkout:
se estiverem ausentes, reconstruir testes a partir dos cenários acima. Os harnesses gravam os
defeitos observados; seu exit 0 representa coleta/teardown completos, não aprovação do comportamento.

Comandos de reprodução usados: `node dist/security-review-2026-09-14/cookie-browser-repro.cjs` e
`pnpm exec tsx --conditions=react-server dist/security-review-2026-09-14/signup-review.ts`.
Os clusters próprios foram parados; os diretórios temporários permaneceram, com fixtures zero.

## Limites e continuidade

O HTTP usa ausência de cookie ou cookie inválido. Das 306 respostas, houve 47 negativas explícitas
com 200, 140 redirects, 9 respostas 404 e 110 respostas 500. Não é prova de autorização individual
nem de ausência de efeitos colaterais de todas as actions. Os guards AST provam alcançabilidade,
não que a autorização preceda todos os efeitos em todos os caminhos.

Não foi encontrada regressão adicional confirmada no recorte de webhooks, políticas/quota de IA,
leitura auditada e scrubber Sentry. Dedup de webhook substitui persistência; a ligação da quota
ao handler é verificada textualmente; prontuário substitui transação/identidade/decifragem.
Replay transacional completo, Gemini real, CSRF com sessão Supabase válida, jornadas autenticadas
no Preview, CI remoto e produção são **NOT TESTED nesta rodada**, e não devem virar PASS por inferência.

As pendências de produto da §34.7 continuam planejadas. Os gaps reproduzidos aqui recebem correção
e teste antes de avançar a fatia afetada; o roadmap inteiro permanece em desenvolvimento.

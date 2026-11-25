# Testes: linha de base e homologação futura

## Executado nesta rodada

Em `C:/dev/Qoro_portability_plan_20261106`, código base app `534995b0`, dependências já disponíveis compartilhadas por junction com worktree de mesma árvore de código. Nenhuma instalação, credencial local ou conexão remota foi usada para estes testes.

```powershell
.\node_modules\.bin\vitest.cmd run src/lib/env.test.ts src/lib/env-coherence.test.ts src/lib/http/application-url.test.ts src/lib/http/cron-auth.test.ts src/lib/db/tenant.test.ts src/lib/auth/tenant-context.test.ts src/lib/auth/supabase-session-cookie.test.ts src/lib/storage/clinical.test.ts src/contexts/billing/internal/billing-logic.test.ts src/contexts/billing/internal/provider-sync.test.ts src/contexts/onboarding/internal/signup-trial.test.ts src/app/api/webhooks/asaas/route.test.ts
```

**PASS: 12/12 arquivos, 216/216 testes, exit 0, 49,70 s**, em 06/11/2026. Resultado por arquivo: env 22; coerência 9; application-url 29; cron-auth 17; db/tenant 5; tenant-context 38; cookie 5; storage/clinical 3; billing-logic 23; provider-sync 21; signup-trial 11; webhook SaaS 33.

São testes locais de caracterização, com doubles de dependências. Não comprovam API externa, restore, liquidação, host alternativo ou UI integrada. Nenhum checkout financeiro foi repetido. Build/typecheck/E2E completos não foram executados nesta rodada documental; não houve alteração de código de produto que exigisse repeti-los. A documentação e os grafos são validados separadamente, com registro final em [validação do pacote](validacao-do-pacote.md).

## Ferramentas existentes a reaproveitar

Fontes: package.json e CI, E01; suites E05–E19. Comandos padrão, após deps e ambiente autorizados: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:coverage`, `pnpm arch:check`, `pnpm arch:db-check`, `pnpm check:migrations`, `pnpm check:observability`, `pnpm check:registry:strict`, `pnpm security:inventory`, `pnpm security:tenant`, `pnpm security:build`, `pnpm security:bundle`, `pnpm security:http`, `pnpm security:browser-session`, `pnpm test:e2e:ci`. Não executar indiscriminadamente comandos com `prod`, limpeza ou seeds em ambiente não conferido.

`pnpm arch:graphs` gerou os quatro snapshots atuais: 58 elementos/316 arestas/0 ciclos/72 eventos. Os arquivos versionados anteriores estavam defasados; atualização é documental, não refatoração. `--check` deve detectar nova divergência. `security:tenant` e harnesses de migrations iniciam DB descartável: executar só após conferir isolamento e dependências do harness; não foram repetidos por esta análise.

## Pirâmide de provas

| Nível               | O que protege                               | Como prova                                                | O que não prova                                           |
| ------------------- | ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| Unidade             | Dinheiro, trial, transição, erro/capability | Inputs/relógio determinísticos e asserts de invariantes   | API externa ou configuração                               |
| Contrato            | Mesmo significado entre adapters            | Mesma suite sobre provider atual, fake e alternativo      | Tokenização/mandato/settlement real sem aceite do serviço |
| Integração DB       | Locks, unicidades, FKs, RLS e recuperação   | Postgres real com roles/duas clínicas; commits e rollback | Segurança do host ou Auth gerenciado                      |
| Integração provider | API e webhooks/readback                     | Sandbox com fixtures/cleanup e request IDs sanitizados    | Um ano temporal de renovação ou liquidação real           |
| E2E real            | Jornada browser→servidor→DB→provider→UI     | Dados sintéticos, readback de cada efeito e replay        | Alta capacidade sem carga, ou todos os edge cases         |
| Migração/restore    | Integridade, delta, ACL, serviço e retorno  | Manifesto, hashes, invariantes e reconstrução isolada     | RTO não medido em outra escala ou zero perda futura       |
| Carga/falha         | Saturação, deadline, retry e lease          | Réplicas, rede lenta, processos interrompidos             | Indisponibilidade física/regulatória irreproduzível       |

## Suites a criar na execução

Nomes abaixo são **propostos**, não arquivos existentes: `contracts/identity.contract.test.ts`, `contracts/storage.contract.test.ts`, `contracts/billing.contract.test.ts`, `integration/provider-bindings.test.ts`, `integration/postgres-portability.test.ts`, `e2e/provider-cutover.spec.ts`. Ajustar às convenções existentes na fase B02; não criar outro runner se Vitest/Playwright/harness atual resolvem.

Casos indispensáveis e matriz: [A01–C07](07-matriz-edge-cases.md). Para cada capacidade testar caminho normal, validação, recusa, concorrência, duplicidade, timeout, falha parcial, indisponibilidade, recuperação, divergência, ataque, convivência e retorno.

### Fixtures e cleanup

Antes de qualquer pagamento Sandbox: registrar run ID, clínica/conta sintética, IDs internos, estado inicial, preço/ciclo esperados, efeito esperado, validade, evidência de vínculo e procedimento de cleanup. Timeout não autoriza remover fixture com pagamento ainda possível. Manter fixture até readback final e cancelamento das obrigações futuras; reconciliar eventos tardios. Eventos sintéticos não substituem entrega real do provedor. Nenhuma cobrança real ou mensagem externa de paciente faz parte dos ensaios.

### Browser e segurança

Desktop e celular próximos de 375 px; reload, back, troca de dispositivo, falha e estados de espera. Testar POST nativo antes da hidratação; credenciais não podem ir para query string. Traces/screenshots sem cookies, tokens, e-mails pessoais ou conteúdo clínico. Confirmar X-Frame/CSP, Secure/HttpOnly, logout replay, MFA e acesso de tenant errado, incluindo download de PDF.

## Contratos antigos como golden fixtures

Congelar price_id, valor contratado/desconto, ciclo, vencimento, trialEnd original, médicos/equipe, permissões legadas e estado de cancelamento. Provar que extração de adapter e backfill não mudam esses campos. Snapshot sintético com valores que representem os contratos aprovados; hash/contagem agregados no banco protegido quando houver autorização. Não usar dados de cliente como fixture de teste unitário.

## Observabilidade e prevenção de regressão arquitetural

Matriz operacional proposta para O01. Reutilizar o JSON sanitizado com requestId/flow e clinicId somente quando resolvido. Métricas abaixo são requisitos de observação; nomes novos serão definidos no catálogo real e validados por check:observability. Não são monitores já instalados no destino.

| Fluxo                    | Indicadores e correlação                                              | Alerta / prova de funcionamento                                            |
| ------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Login                    | Sucesso/recusa por motivo, latência, rate-limit; session/epoch opacos | Pico de recusas e API Auth indisponível; testar sessão revogada            |
| Criação de clínica       | Tentativas, pendências e compensações por operationId/jornada         | Provisioning parcial além do budget; readback Auth/perfil/tenant           |
| Assinatura               | Preço/ciclo/cota local versus snapshot por binding                    | Divergência ou sync de mudança pendente; financeiro recebe alerta          |
| Processamento financeiro | Operações unknown, idade e efeitos por conta/provider                 | Cobrança duplicada, centavos/período divergente ou benefício indevido      |
| Webhook                  | Verify, duplicados, recusas, duração e reconciliação por evento       | Verificação falha/backlog; envio Sandbox e entrega HTTP/DB correlacionadas |
| Upload                   | Bytes, hash, tamanho/MIME e falhas por referência opaca               | Erro/objeto sem manifesto; arquivo sintético íntegro no destino            |
| Download                 | Recusas tenant/ACL, falha de leitura e latência                       | Qualquer acesso privado anônimo é crítico; prova negativa real             |
| Consulta crítica         | Latência/timeout, pool, role/contexto e versão de schema              | Saturação/regressão; duas clínicas e ausência de contexto recusada         |
| Deploy                   | Release/build/config version, readiness e scheduler generation        | Falha de capability ou duas gerações; entrega de alerta fora da Vercel     |
| Backup                   | Último sucesso, escopo, tamanho/hash e custódia                       | Snapshot atrasado/sem chave; não inferir PASS por artifact existir         |
| Restore                  | Duração, constraints, contagens/hash/ACL e serviços recuperados       | Qualquer componente indispensável ausente; exercício isolado medido        |

Governança: registrar provider/capabilities/owner/versão em ADR; proibir imports de SDK nos consumidores migrados; testar reexport e import dinâmico; rodar suite de contrato após update de SDK/API; revisar inventário e runbooks a cada troca de adapter e auditoria periódica proposta trimestral. Frequência e responsável precisam de aprovação operacional. Não impedir toda evolução do código por acoplamentos históricos ainda não migrados: manter recorte e baseline explícitos, sem allowlist genérica que esconda novas violações.

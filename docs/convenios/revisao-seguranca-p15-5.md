# P15.5 — revisão de segurança do módulo Convênios (18/11/2026)

Escopo: PR #55 no SHA desta revisão (código do módulo, rotas de download, actions, migrations 0143–0166). Só DEV/Preview e
Postgres descartável; nenhum acesso a produção. O critério do plano é "checklist + `/security-review`, sem achado crítico
aberto". O `/security-review` sobre a branch inteira (997 arquivos, ~192 mil linhas contra a `main`) não cabe numa
passada; foi substituído por (a) os gates permanentes do módulo, que rodam a cada SHA na CI, e (b) a revisão dirigida
das superfícies novas deste ciclo, com prova adversarial. A revisão deve ser refeita quando as decisões S1–S8 (P12.8–
P12.12) mudarem o código.

## Checklist e evidência

| Área | O que foi conferido | Evidência | Resultado |
| --- | --- | --- | --- |
| Autenticação e sessão | toda superfície de Convênios exige sessão; sessão expirada vai ao login; sessão antiga cai quando a permissão muda (ADR-037) | `security:inventory --check` (88+ superfícies, todas `session`/`session-resource-gate`); E2E I.2 exceções 3/3 | OK |
| Autorização por papel | cada action passa pelo portão da matriz I.2 no servidor; a regra deriva do evento de auditoria (falha fechada) | `actions-gate.test.ts`; E2E I.2 13/13 com as actions chamadas direto por papel sem o direito | OK |
| Tenant e RLS | todas as tabelas `hi_*` com RLS forçada; nenhuma leitura entre clínicas fora das auditadas | isolamento de todas as tabelas de Convênios na CI (P12.1); `tenant-isolation-gate.test.ts`; outra clínica 404 em todos os E2E | OK |
| Leituras privilegiadas | `dbAdmin` só nos caminhos auditados (15 perguntas cada) | `privileged-reads-gate.test.ts` + `auditoria-leituras-privilegiadas.md` §1–§5 | OK |
| Identificador adulterado | id de outra clínica, inexistente ou sem posse devolvem o mesmo 404 | rotas de download (testes de rota); D-4 no Preview (id adulterado); CSV da P9.10 com operadora de outra clínica volta só com o cabeçalho | OK |
| Dados financeiros | valores só para quem vê o faturamento, no servidor | D-4/D-5 no Preview; P9.10: tela e CSV com `seeValues` (recepção e médica 404) | OK |
| Dados clínicos e pessoais | indicação clínica cifrada; carteirinha mascarada por padrão; nada de paciente em métrica, aviso ou CSV | harnesses da SP/SADT e dos avisos; via de atendimento (D-5); CSV da P9.10 sem paciente nem carteirinha | OK |
| Downloads, PDF e XML | sem URL pública; leitura auditada; SHA conferido; XML técnico só para o faturamento | `audit-coverage.test.ts` (toda rota chama a leitura auditada); D-5 fase 3; link do XML da SP/SADT corrigido (18/11) | OK |
| Comprovantes | até 10 MB em partes, tipo conferido, limpeza que não apaga comprovante válido | P6.3 no Preview 4/4; harness do envio em partes | OK |
| Auditoria | toda action e toda rota de download grava trilha | `audit-coverage.test.ts` (com exceções nominais e motivo) | OK |
| Segredos | credencial de operadora cifrada, nunca em log, resultado ou mensagem | P12.5 (5/5 + 7); varredura: nenhum `process.env` em componente de cliente de Convênios | OK |
| Injeção | SQL sempre parametrizado (o único `sql.raw` é constante fixa); nenhum HTML injetado; CSV com célula de fórmula neutralizada | varredura estática de 18/11; `insurer-report.test.ts` | OK |
| Idempotência e concorrência | chaves únicas por fato; travas no banco; manutenção sobreposta; consumo de autorização em corrida | P14.2 5/5; manutenção 6/6; P4.7 4/4 (corrida com autorização de 1 unidade) | OK |
| Estado comercial e módulo | trial e assinatura parada não operam (D24); módulo desligado barra a classe A no serviço e no banco | harness do bloqueio comercial; 0164 9/9; plataforma 6/6 | OK |

## Achados deste ciclo

| Achado | Gravidade | Estado |
| --- | --- | --- |
| Guia de Consulta ligava a autorização concedida sem conferir nem consumir a quantidade: numa série, várias consultas usavam a mesma autorização de 1 unidade | Alta (integridade do faturamento; risco de glosa) | Corrigido (P4.7), com prova por mutação |
| A tela da solicitação SP/SADT oferecia à recepção o link do XML guardado que a rota recusa (D-5) | Baixa (interface; o servidor já recusava) | Corrigido (18/11) |
| Leitura do XML do pedido de cancelamento sem trilha | Média (auditoria) | Corrigido (P12.4, 18/11) |

Nenhum achado crítico aberto no código revisado.

## Revisão de 19/11: superfícies novas (P6.5, P12.5, P14.4)

| Área | O que foi conferido | Evidência | Resultado |
| --- | --- | --- | --- |
| Saída de rede (SSRF) | O endereço vem só da configuração homologada, nunca do usuário: só HTTPS, sem usuário/senha na URL, sem seguir redirecionamento, resposta com teto de 16 MiB lida em partes | `tiss-soap.test.ts` (configuração) | OK, com o reforço abaixo |
| XML de fora | A resposta passa pelo leitor estrito (sem DTD, entidade, XInclude ou instrução de processamento; limites de nós e profundidade), pelo namespace da ANS, pelo XSD oficial e pelo hash; a origem tem de ser o registro ANS da operadora | stub com DTD, hash errado, outra operadora, fora do XSD e lote trocado: todos `invalid_response` | OK |
| Credencial | Decifrada só em `tiss-soap/credential.ts`, na hora do envio. Não aparece em resultado, recusa, erro nem recibo; com `md5_hex` a senha em claro não trafega | gate estático (só esse arquivo decifra; nenhum código do app o chama); harness 6/6 com RLS e revogada; teste "a senha não aparece" | OK |
| Envio duplicado | Lote, solicitação e recurso só são repetidos se a operadora declarar deduplicação; tempo esgotado num envio vira manual com aviso para conferir no portal | teste de tempo (envio 1 tentativa; consulta 3) | OK |
| Stub e registro | O stub nunca é importado pelo app e o registro de homologados de produção é vazio | gate em `tiss-soap.test.ts` | OK |
| Medição (P14.4) | O harness carrega volume com `session_replication_role = replica` só no Postgres descartável (loopback conferido); a medição no DEV é só leitura | `health-insurance-performance-db.ts`; `p144-preview-latency` em transação `read only` | OK |

**Reforço feito nesta revisão (baixa):** HTTP em loopback era aceito em qualquer configuração; uma configuração de operadora mal preenchida poderia apontar o adaptador para um serviço local. Agora o loopback em HTTP exige `allowLoopbackHttp`, que só o stub dos testes liga (teste: sem a opção, `http://127.0.0.1` e `http://localhost` são recusados).

**Para quem usar o recibo (P9.4):** a resposta da operadora pode ter dado de paciente (ex.: nome na elegibilidade). O recibo devolvido pelo adaptador tem de ser guardado pelo caminho cifrado de arquivos TISS, nunca em log.

## Riscos que sobram (não são defeito do código revisado)

- **Perfil de segurança TISS da ANS** (inatividade no servidor, política de senha, auditoria imutável de 180 dias, último
  acesso): depende das decisões S1–S8 (P12.8–P12.12). Até lá o perfil não está ligado para clínicas reais.
- **Picomatch (GHSA-fc5q-39xc-vjpf)**: sem versão corrigida publicada (afeta até 4.0.7, a última); exceção temporária
  aprovada no `pnpm-workspace.yaml`.
- **Middleware**: o redirecionamento 307 de POST de server action sem cookie (handoff S-02) segue como proposta para o
  fundador; Convênios contorna na própria página.

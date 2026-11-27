# Resumo executivo

**Recomendação:** preparar saídas independentes, mantendo Supabase, Asaas e Vercel enquanto cada capacidade alternativa é demonstrada. Começar pela hospedagem; tratar Storage em seguida; separar billing/paciente; deixar identidade e banco para depois dos contratos de segurança.

## Conclusão baseada no código

| Capacidade                         | Situação atual                                                                         | Peso de substituição inferido         |
| ---------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------- |
| Landing hospedada                  | Vite + prerender estático, headers/redirects/analytics e Preview Vercel                | Baixo a médio                         |
| App hospedado                      | Next Node, 21 crons, callbacks/Preview, PDF, segurança e jobs                          | Médio                                 |
| Storage                            | Helpers centralizados e paths; URLs públicas persistidas e marca em templates          | Médio                                 |
| SaaS billing                       | Porta PaymentProvider parcial; domínio próprio, IDs e semântica Asaas em consumidores  | Alto                                  |
| Pagamento de paciente              | Credencial/conta por clínica, sinal, crédito, estorno/risco e reconciliação            | Alto; projeto separado da mensalidade |
| Identidade                         | Auth server-side, claims hook, MFA, profiles.id e auth.users, sessão/recovery          | Muito alto                            |
| Postgres fora do Supabase          | Driver direto ajuda; roles/RLS/Auth, extensões e restore precisam reproduzir segurança | Alto junto da identidade              |
| Trocar PostgreSQL por outra engine | SQL e garantias Postgres estruturais                                                   | Fora do escopo recomendado            |

Fundamentação e arquivos em [contexto](../architecture/01-contexto-atual.md) e [matriz](02-matriz-vendor-lock-in.md). "Médio/alto" é avaliação de esforço/risco, não incidente confirmado ou benchmark de custo.

## As variáveis estão bem definidas?

**Sim para configuração operacional; parcialmente para portabilidade.** env.ts centraliza Zod, tem guardas de runtime e APP*BASE_URL confiável. Porém ambiente de Preview depende de VERCEL_ENV e formato `.vercel.app`; a verificação cruzada Auth/DB depende do formato Supabase; NEXT_PUBLIC*\* é configuração de build; pools fixos por processo não garantem capacidade em múltiplas réplicas. [Inventário detalhado](../architecture/02-inventario-de-dependencias.md).

Essas limitações não exigem renomear todas as variáveis. Primeiro adicionar identidade explícita do ambiente/backend, contexto de deployment e testes de origem; depois abstrair capacidades conforme o backlog. Nunca tornar configurável um destino financeiro livre para "facilitar" a migração.

## Entregas e validação desta análise

Auditoria estática de duas mains, JSON de referências, grafo atualizado sem ciclos de módulos, modelos AS-IS/TO-BE, contratos, 35 tarefas rastreadas, matriz de cenários, gates, riscos e procedimentos de saída/retorno. **216/216 testes locais em 12 arquivos passaram.** Não foram feitas chamadas financeiras, novas contas, alterações de produção ou ensaios de outro provedor.

Backups têm prova histórica versionada, mas não foram reabertos nesta rodada. A cópia independente real permanece adiada por aceite expresso anterior, sem PITR contratado. Isso não demonstra recuperabilidade atual em infraestrutura nova; G0 operacional exige fotografia e restore pertinentes à futura migração, sem repetir agora operações sensíveis.

## Sequência com valor incremental

1. Aprovar fronteiras e riscos; medir baseline e proteger contratos existentes.
2. Provar Next e landing em host alternativo com DEV isolado, jobs e rollback controlados.
3. Fazer Storage trabalhar por contrato, com acesso privado e integridade demonstrados.
4. Extrair semântica Asaas e permitir convivência financeira por binding persistido.
5. Migrar identidade/autorizações e então homologar PostgreSQL genérico; não inverter essa dependência.
6. Executar ensaios de saída por fornecedor e combinado; desativação antiga só depois de reconciliação e retenção aprovadas.

O pacote deixa a execução revisável. Não declara independência implementada nem GO para migração de produção.

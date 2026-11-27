# Scorecard baseado em provas

Sem nota numérica inventada. Escala de evidência: **inventariado → contrato equivalente → alternativa integrada → cutover/rollback ensaiado → operação homologada**. Não somar pontos por criar interface.

| Capacidade             | Acoplamento atual / prova                                    | Estado desejado                                            | Estado nesta análise                                             | Risco residual / próxima prova                                   |
| ---------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| Banco                  | Driver Postgres direto + schema/Auth/RLS gerenciado (E03–04) | PostgreSQL genérico seguro e recuperável                   | INVENTARIADO; prova histórica em stack Supabase, não reexecutada | Roles/FKs/keys e delta; D01–D04/X03                              |
| Auth                   | Supabase SSR/Admin/MFA + subject/profile/claims (E05–07)     | Subject interno, porta e autorização Qoro                  | INVENTARIADO; caracterização local parcial                       | Credenciais/MFA/sessões; I01–I05                                 |
| Storage                | Helpers e paths; URL logo/template fixa (E08–09)             | Objetos/ACL em segundo backend com continuidade            | INVENTARIADO; helper test local, restore histórico limitado      | Bytes/ACL/delete/copy; S01–S04                                   |
| Pagamentos paciente    | Conta por clínica; single-gateway e estorno/risco (E11–15)   | Gateway substituível por binding mantendo origem de fundos | INVENTARIADO                                                     | Conta recebedora, KYC/refund/chargeback; subcapabilities F05/F06 |
| Assinaturas SaaS       | PaymentProvider parcial, IDs Asaas e sincronização (E10–14)  | Domínio preservado e segundo gateway homologado            | INVENTARIADO; unidade atual passou                               | Recorrência, token/mandato, dunning; F01–F06/X02                 |
| Hospedagem app         | Next Node + crons/config Vercel (E18–19)                     | Host alternativo seguro, observável e revertível           | INVENTARIADO; teste local de origem/cron passou                  | Runtime/PDF/replicas/jobs; H01–H03/O04/X01                       |
| Hospedagem landing     | Vite estático + header/CTA/Analytics Vercel (E25)            | Static host com mesma semântica HTTP/CTA                   | INVENTARIADO                                                     | 404/redirect/preview/medição; H04/X01                            |
| Secrets e continuidade | SecretProvider existe; custódia e DPAPI históricas (E20/E23) | Chaves/config/backup recuperáveis no host alvo             | CONTRATO EXISTENTE; alternativa/restore atual não homologados    | Backend lazy, versões e cofre; O02/H02                           |

## Medição futura de progresso

Denominador por capacidade = casos de uso críticos explicitamente inventariados em B01, não número de arquivos ou interfaces. Numerador = casos executados no adapter alternativo e com retorno demonstrado. Registrar `n/N` e exclusões justificadas; ainda não há denominadores homologados para publicar percentual de independência. Prazo para trocar fornecedor só será informado como medido após os exercícios, não a partir da estimativa de implementação.

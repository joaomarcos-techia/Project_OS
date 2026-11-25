# Plano Supabase: três migrações diferentes

Fontes [E03–E09, E20, E23](../architecture/01-contexto-atual.md). **DECISÃO:** manter PostgreSQL; separar primeiro Storage, depois identidade/autorizações, depois banco genérico. Supabase self-hosted é uma opção de continuidade do operador, não prova de independência tecnológica.

## Banco

**CONFIRMADO:** queries de negócio usam Drizzle/postgres diretamente; pools centralizados; RLS usa role authenticated e contexto local de tenant; histórico SQL referencia auth.users/uid/jwt em 24 arquivos; extensões declaradas incluem pgcrypto, pg_trgm e btree_gist. Workers dependem de locks/transações Postgres. Backups históricos também exigiram supabase_vault no ambiente restaurado; presença no backup não prova uso funcional de vault pelo app.

**Ação D01:** construir catálogo sem dados pessoais de pg_extension, roles/grants, FKs, policies, functions, triggers, partições, publicações e dependências gerenciadas do snapshot escolhido. O SQL histórico contém camadas sobrepostas; a fonte do schema final é o resultado de todas as migrations, não só busca textual. Confirmar também versões, collation/encoding/timezone, função de UUID, sequences e volume.

**Ação D02:** bootstrap versionado e separado para Postgres genérico: roles de serviço e runtime sem BYPASSRLS, funções de identidade equivalentes aprovadas, privilégios mínimos, extensões disponíveis e ponte de FK interna após I02. Não criar funções auth.uid/jwt que retornem constante só para migrations passarem. Executar com dois tenants e role real de runtime, inclusive testes sem withTenant e reutilização de conexão após commit/rollback.

**Ação D03–D04:** snapshot protegido + sincronização incremental definida conforme volume e janela. Preferir pausa curta controlada e escritor único se viável; CDC requer suportes e prova próprios, não é default. Verificar contagens por tabela/tenant, checksums compatíveis, FKs, constraints validadas, sequences, partições, políticas e queries de índices críticos. Migrations do zero e upgrade de snapshot são dois gates separados. Não editar migrations antigas aplicadas: nova migration aditiva ou bootstrap explícito.

## Identidade e autorização

**CONFIRMADO:** profiles.id referencia auth.users; sessão usa Supabase SSR, cookies HttpOnly, getClaims e perfil autoritativo; claims_version e ativo invalidam acesso; MFA é exigido conforme função/ação. O trial da oferta nova usa created_at da identidade. O cadastro tem sessão anônima, confirmação própria por código, ponte de retomada e provisioning; não substituir tudo por tela padrão do novo Auth.

| Jornada                     | Preservar                                                                                     | Prova exigida                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Registro / código / reenvio | UUID interno único, hash de senha somente no serviço apropriado, expiração/tentativas/consumo | E2E nova conta e duplicidade, sem log de senha/código                                |
| Login / refresh / logout    | Subject verificado, cookies HttpOnly/Secure/SameSite, revogação e epochs                      | Access antigo, refresh rejeitado, logout em vários dispositivos                      |
| Papel / tenant / suspensão  | Perfil autoritativo e claims_version; tenant não vem de campo livre                           | Troca de papel/ativo no meio de sessão; IDOR cruzado                                 |
| Reset / mudança de e-mail   | Token curto, consumo único, proteção de link e redirecionamento                               | Iniciado antes do cutover e usado depois, outro dispositivo                          |
| MFA / OAuth                 | AAL e identidade externa corretos                                                             | Não assumir import de seed/fator/consentimento; estratégia de re-enrollment aprovada |
| Onboarding / checkout       | Última etapa real, timestamps originais e contrato vinculado                                  | Não reiniciar trial nem criar nova clínica/assinatura                                |
| Exclusão                    | Efeitos das FKs/retention/identidade controlados                                              | Não cascatar prontuário ao excluir um subject do novo provedor                       |

**I01–I05:** introduzir porta estreita, mapear `(issuer, subject)` a UUID Qoro estável, expandir schema sem quebrar FKs e só depois escolher estratégia de credenciais. Importação de hash depende de algoritmo/parametrização/compatibilidade e autorização do fornecedor; não exportar hash nem token nesta análise. Se não suportado, usar recuperação segura e comunicação aprovada. Sessões antigas não são consideradas transferíveis; eventual coexistência de issuers exige allowlist, prazos, JWKS, audience e revogação. O código atual tem um clinicId por perfil; múltiplos tenants por conta é cenário negativo/decisão futura, não capacidade existente.

## Storage

**CONFIRMADO:** helpers para clinical-pdfs privado, lgpd-exports privado, admin-exports privado e clinic-logos público. O bucket da marca nos templates é outra dependência. Inventário remoto atual de buckets/arquivos/ACL é PENDENTE. A evidência antiga de 5 buckets/42 objetos pertence ao snapshot de 29/10.

1. S01: contrato com key opaca, MIME/size, overwrite explícito, paginação, erros e semântica de ACL.
2. S02: compatibilidade de caminhos existentes, logo_url e cinco templates; não reescrever snapshots clínicos assinados ou históricos jurídicos para trocar domínio de imagem. Resolver referências na apresentação.
3. S03: segundo adapter em destino aprovado; provar servidor, listagem, bytes, signed URL e rejeição anônima dos objetos privados. S3-compatible não prova mesmas policies, TTL, encoding e metadados.
4. S04: inventário por bucket, manifesto cifrado com size/hash/metadata, cópia com verificação, delta, tombstones de exclusões concorrentes, congelamento final e teste. Nenhuma cópia de arquivo médico real para destino novo sem autorização específica.

Preservar proxy de PDF clínico same-origin; não trocar por link S3 público. Export já assinado pode continuar válido na origem até expirar; manter janela autorizada de leitura compatível, sem recriar acesso a arquivo que foi legitimamente excluído. Retenção de backup não pode reintroduzir export eliminado na camada ativa.

## Recuperação e limites

O [runbook existente](../runbooks/disaster-recovery.md) registra restore lógico e Storage local históricos; [aceite anterior](../quality/aceite-risco-backup-2026-10-30.md) não é evidência de cópia independente realizada. O guia oficial do Supabase distingue banco restaurado de arquivos/configurações adicionais: [restore self-hosted](https://supabase.com/docs/guides/self-hosting/restore-from-platform) e [backups](https://supabase.com/docs/guides/platform/backups). Esta proposta reutiliza esses procedimentos, sem contratar PITR nem executar novo restore.

**Gate de saída real:** identity alternativa + Storage alternativo + PostgreSQL genérico, dois tenants, permissões, cadastro/refresh/reset/MFA, documentos e financeiro; sem chamadas obrigatórias ao operador Supabase. GoTrue/Storage Supabase self-hosted devem aparecer como dependência residual se mantidos. Leitura SQL restaurada sozinha não passa G6 ou exercício A.

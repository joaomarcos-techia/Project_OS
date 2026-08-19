-- A UI `/configuracoes/agente` grava a configuração dentro de `withTenant`,
-- que executa como o papel `authenticated`. A migration 0024 deixou a tabela
-- somente-leitura para esse papel e anotou que a futura UI precisaria do grant,
-- mas a action de gestão entrou sem a permissão correspondente. Em produção,
-- todo UPSERT falhava com `permission denied for table ai_clinic_config`.
--
-- A policy tenant-scoped existente continua sendo a fronteira de linha. O grant
-- libera apenas as operações exigidas pelo UPSERT; DELETE e privilégios de DDL
-- permanecem explicitamente proibidos.
GRANT INSERT, UPDATE ON ai_clinic_config TO authenticated;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ai_clinic_config FROM authenticated, anon;

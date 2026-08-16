-- RBAC-001 — `export:audit` sai do bundle do perfil Financeiro.
--
-- CONTEXTO. O code estava no catálogo desde a migration 0003 e, até agora, não
-- era consumido por lugar nenhum: o pentest o classificou como permissão órfã.
-- Ao ligá-lo a uma capacidade real (export da trilha de auditoria da clínica),
-- a linha `('financial','export:audit')` deixou de ser inofensiva — ela passaria
-- a conceder, de uma vez e em todas as clínicas, uma capacidade que ninguém
-- decidiu dar a esse perfil.
--
-- DECISÃO DE PRODUTO. O Financeiro cuida de receber/pagar/fornecedores/caixa. A
-- trilha de auditoria atravessa TODOS os contextos — quem alterou cadastro de
-- paciente, quem assinou prontuário, quem mudou permissão da equipe — e é
-- artefato de conformidade administrativa, não insumo de trabalho financeiro.
-- Por least privilege, sai. Owner e gestor continuam com a capacidade (recebem
-- o catálogo inteiro no seed do 0003).
--
-- Isto NÃO remove o code do catálogo nem o esconde da UI: um owner que queira
-- delegar o export a alguém do Financeiro continua podendo, agora por decisão
-- explícita via `user_permission_overrides` — que é justamente o contrário de
-- uma permissão órfã concedida por acidente.
DELETE FROM role_permissions
 WHERE role = 'financial' AND permission_code = 'export:audit';
--> statement-breakpoint

-- ADR-037 — o JWT carrega o array de permissões resolvido na emissão. Sem o
-- bump do epoch, um Financeiro já logado continuaria apresentando `export:audit`
-- no token até a expiração natural, e o gate cached o aceitaria. O incremento
-- força a reemissão das claims no próximo request.
--
-- Só os profiles do perfil afetado: bumpar todo mundo invalidaria claims de
-- quem não teve permissão alterada.
UPDATE profiles
   SET claims_version = claims_version + 1
 WHERE role = 'financial'
   AND deleted_at IS NULL;

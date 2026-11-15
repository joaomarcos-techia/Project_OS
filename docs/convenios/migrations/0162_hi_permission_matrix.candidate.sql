-- =====================================================================
-- 0162 (CANDIDATA) — Convênios: permissões próprias da matriz I.2 (P1.12)
--
-- SITUAÇÃO: preparada em 15/11/2026 (noite). NÃO está em drizzle/migrations nem no
-- journal. NÃO foi aplicada no DEV nem em produção. Aplicar em banco persistente exige
-- autorização específica do fundador, depois da revisão da matriz
-- (docs/convenios/matriz-permissoes-i2.md) e das provas em Postgres descartável
-- (scripts/security/health-insurance-permission-matrix-db.ts). Pedido no §20 de
-- docs/convenios/coordenacao-migrations.md.
--
-- O QUE FAZ (só inserções; nenhuma DDL, nenhuma visão, função, gatilho ou GRANT muda):
--   1. cinco códigos novos no catálogo `permissions`;
--   2. pacotes por papel em `role_permissions`. O gatilho da 0040
--      (trg_role_permissions_bump_claims_version) incrementa o claims_version de
--      quem tem o papel: na próxima requisição o token é renovado com os códigos;
--   3. leva as negativas e concessões individuais já existentes de `view:financial` e
--      `manage:financial` (user_permission_overrides) para os códigos novos, para que
--      ninguém GANHE acesso a Convênios que lhe foi negado nem PERCA o que lhe foi
--      concedido só por causa da troca de código. Negativa vence concessão (mesma regra
--      do EXCEPT da effective_permissions_v). O gatilho trg_overrides_bump_claims_version
--      incrementa o claims_version de cada pessoa afetada.
--
-- O QUE NÃO FAZ:
--   - não muda effective_permissions_v (0133) nem custom_access_token_hook (0055);
--   - não remove nada: view:financial e manage:financial continuam nos pacotes de hoje
--     (Caixa, Financeiro e o código atual de Convênios seguem como estão);
--   - não muda o comportamento do código publicado: nenhum código atual lê os códigos
--     novos, e `sanitizePermissions` (src/lib/auth/claims.ts) descarta do token o que o
--     catálogo TS não conhece. A troca dos portões (P1.12-b) é código, e só sobe depois
--     desta candidata aplicada no DEV;
--   - não entra no pacote SaaS do AbacatePay (Gate B 0136–0159): é do #55, depois da 0161.
--
-- ESCOPO "PRÓPRIO" DA MÉDICA: não é permissão (permissions.ts: "NÃO criar permissions por
-- instância"). É filtro no servidor: sem `operate:convenios` e sem
-- `view:faturamento_convenio`, a pessoa só vê as guias em que é executante ou solicitante.
--
-- Sem BEGIN/COMMIT: o migrator do Drizzle roda tudo numa transação (0045).
--
-- REVERSÃO (só com o código de antes da P1.12-b no ar; com a P1.12-b no ar, reverter o
-- código PRIMEIRO, senão todos perdem Convênios):
--   DELETE FROM public.user_permission_overrides WHERE permission_code IN
--     ('view:convenios','manage:convenios','operate:convenios',
--      'view:faturamento_convenio','manage:faturamento_convenio');
--   DELETE FROM public.role_permissions WHERE permission_code IN (mesma lista);
--   DELETE FROM public.permissions WHERE code IN (mesma lista);
--   (os gatilhos da 0040 incrementam o claims_version de novo: o token volta sem os códigos)
-- =====================================================================

INSERT INTO public.permissions (code, description) VALUES
  ('view:convenios', 'Convênios: entrar no módulo e ver o atendimento de convênio (sem valores de faturamento; sem operar e sem faturar, só as próprias guias)'),
  ('manage:convenios', 'Convênios: cadastro de operadoras, planos, contratos e regras, credenciais de operadora e configuração do módulo'),
  ('operate:convenios', 'Convênios: operação da recepção (carteirinha, cobertura, autorização, solicitação SP/SADT, conferência e correção da guia), sem valores'),
  ('view:faturamento_convenio', 'Convênios: ver valores de faturamento, lotes, glosas, recursos, pagamentos da operadora e repasses'),
  ('manage:faturamento_convenio', 'Convênios: aprovar e emitir, reabrir, cancelar guia; lotes e XML; glosas, recursos, conciliação e repasses')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- Pacotes (matriz I.2 com o ajuste técnico da médica; docs/convenios/matriz-permissoes-i2.md §3).
INSERT INTO public.role_permissions (role, permission_code) VALUES
  ('owner',     'view:convenios'),
  ('owner',     'manage:convenios'),
  ('owner',     'operate:convenios'),
  ('owner',     'view:faturamento_convenio'),
  ('owner',     'manage:faturamento_convenio'),
  ('gestor',    'view:convenios'),
  ('gestor',    'manage:convenios'),
  ('gestor',    'operate:convenios'),
  ('gestor',    'view:faturamento_convenio'),
  ('gestor',    'manage:faturamento_convenio'),
  ('attendant', 'view:convenios'),
  ('attendant', 'operate:convenios'),
  ('financial', 'view:convenios'),
  ('financial', 'view:faturamento_convenio'),
  ('financial', 'manage:faturamento_convenio'),
  ('doctor',    'view:convenios')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Só o override que MUDAVA o acesso é levado: negativa de um código que o papel dá, ou
-- concessão de um código que o papel não dá. Override redundante (negar a quem o papel
-- já não dá; conceder a quem o papel já dá) não muda nada hoje e não muda nada aqui —
-- levá-lo tiraria da recepção a operação ou daria ao financeiro o cadastro.
--
-- Negativas primeiro (vencem as concessões no conflito da chave única user_id + código).
--   R1: sem ver o financeiro hoje = sem Convênios hoje → nega os cinco códigos.
--   R2: sem gerenciar o financeiro hoje = sem agir em Convênios hoje → nega gerenciar,
--       operar e faturar (ver continua como hoje).
INSERT INTO public.user_permission_overrides (user_id, clinic_id, permission_code, granted, granted_by)
SELECT o.user_id, o.clinic_id, n.code, false, o.granted_by
  FROM public.user_permission_overrides o
  JOIN public.profiles p ON p.id = o.user_id
  JOIN (VALUES
    ('view:financial',   'view:convenios'),
    ('view:financial',   'manage:convenios'),
    ('view:financial',   'operate:convenios'),
    ('view:financial',   'view:faturamento_convenio'),
    ('view:financial',   'manage:faturamento_convenio'),
    ('manage:financial', 'manage:convenios'),
    ('manage:financial', 'operate:convenios'),
    ('manage:financial', 'manage:faturamento_convenio')
  ) AS n(old_code, code) ON n.old_code = o.permission_code
 WHERE o.granted = false
   AND EXISTS (SELECT 1 FROM public.role_permissions rp
                WHERE rp.role = p.role AND rp.permission_code = o.permission_code)
ON CONFLICT (user_id, permission_code) DO NOTHING;
--> statement-breakpoint

-- Concessões depois (só onde não houver negativa).
--   R3: ver o financeiro concedido a quem o papel não dá = via Convênios inteiro com valores.
--   R4: gerenciar o financeiro concedido a quem o papel não dá = agia em tudo de Convênios
--       (inclusive cadastro).
INSERT INTO public.user_permission_overrides (user_id, clinic_id, permission_code, granted, granted_by)
SELECT o.user_id, o.clinic_id, n.code, true, o.granted_by
  FROM public.user_permission_overrides o
  JOIN public.profiles p ON p.id = o.user_id
  JOIN (VALUES
    ('view:financial',   'view:convenios'),
    ('view:financial',   'view:faturamento_convenio'),
    ('manage:financial', 'view:convenios'),
    ('manage:financial', 'manage:convenios'),
    ('manage:financial', 'operate:convenios'),
    ('manage:financial', 'view:faturamento_convenio'),
    ('manage:financial', 'manage:faturamento_convenio')
  ) AS n(old_code, code) ON n.old_code = o.permission_code
 WHERE o.granted = true
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.role = p.role AND rp.permission_code = o.permission_code)
ON CONFLICT (user_id, permission_code) DO NOTHING;
--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0162-hi-permission-matrix')
ON CONFLICT (version) DO NOTHING;

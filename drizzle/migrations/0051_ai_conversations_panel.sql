-- =====================================================================
-- 0051_ai_conversations_panel.sql
-- ADR-047 — painel de Conversas IA (/conversas): ler a fila do agente,
-- assumir a conversa, responder manualmente e devolver ao agente.
--
-- Aditivo / forward-compatible: código antigo não consulta as permissions
-- novas nem escreve em sent_by_user_id → seguro aplicar ANTES do deploy.
--
-- (A) ai_messages.sent_by_user_id — autoria da mensagem.
--     NULL = agente; preenchido = humano respondendo pelo painel. NÃO dá para
--     derivar isso de `model IS NULL`: o agente também grava model=null nos
--     fallbacks (pré-filtro clínico, quota estourada, kill-switch).
--
--     FK -> profiles(id), NÃO auth.users diretamente: `profiles` é a identidade
--     canônica do tenant (mesmo alvo de prontuarios.signed_by,
--     appointments.doctor_id, user_permission_overrides.granted_by) e já
--     encadeia para auth.users via `profiles_id_auth_users_id_fk` (0003,
--     ON DELETE CASCADE). Apontar para profiles herda essa integridade e ainda
--     escopa a identidade ao tenant — auth.users é global.
--
--     NOTA: os comentários `// FK auth.users via migration` em
--     financial/scheduling/clinical schema.ts descrevem colunas `created_by`
--     que de fato NÃO têm FK nenhuma. Não confundir com este caso.
--
--     ON DELETE RESTRICT (precedente: prontuarios.signed_by): a autoria da
--     mensagem enviada ao paciente é registro histórico e não pode virar NULL
--     — NULL significaria "foi o agente", uma atribuição FALSA. RESTRICT não
--     trava nenhum fluxo real: profiles usa soft-delete, e o único hard-delete
--     do repo (cancelClinicInvite) atinge só convite PENDENTE
--     (invite_accepted_at IS NULL), que por definição nunca respondeu nada.
--
--     FK em tabela particionada propaga p/ as children (PG 12+) — mesmo padrão
--     das duas FKs que a 0024 já criou em ai_messages.
--
-- (B) permissions + bundles. VIEW e MANAGE separadas: ler o histórico (contexto
--     clínico antes da consulta) é menos sensível que falar COM o paciente em
--     nome da clínica. doctor recebe só VIEW; quem opera a fila humana é
--     owner/gestor/attendant (a secretária é quem atende no dia a dia).
--
--     claims_version: NÃO há bump manual aqui. O trigger
--     trg_role_permissions_bump_claims_version (0040) dispara AFTER INSERT em
--     role_permissions e bumpa sozinho — ver ADR-037.
--
-- Cardinalidade: catálogo 24 -> 26 permissions; role_permissions +7 linhas.
-- Idempotente: ON CONFLICT DO NOTHING + DO $$ EXCEPTION duplicate_object.
-- =====================================================================

-- (A) autoria da mensagem -------------------------------------------------------
ALTER TABLE "ai_messages" ADD COLUMN IF NOT EXISTS "sent_by_user_id" uuid;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_sent_by_user_id_profiles_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- (B) permissions + bundles -----------------------------------------------------
INSERT INTO permissions (code, description) VALUES
  ('view:conversations',   'Ver conversas do agente de IA com pacientes'),
  ('manage:conversations', 'Assumir conversa, responder manualmente e devolver ao agente')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint

INSERT INTO role_permissions (role, permission_code) VALUES
  ('owner',     'view:conversations'),
  ('owner',     'manage:conversations'),
  ('gestor',    'view:conversations'),
  ('gestor',    'manage:conversations'),
  ('attendant', 'view:conversations'),
  ('attendant', 'manage:conversations'),
  ('doctor',    'view:conversations')
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0051-ai-conversations-panel')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint

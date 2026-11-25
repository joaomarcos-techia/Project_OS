-- 0170 (CANDIDATA, fora do journal) — S4: histórico das últimas senhas (requisitos 81 e 82 do componente de
-- segurança da ANS, 202511; limite de implantação 30/06/2026).
--
-- O que guarda: um VERIFICADOR irreversível por troca de senha — scrypt(senha + pepper, sal aleatório de 16 bytes,
-- N=2^15, r=8, p=1, 32 bytes). Nunca a senha, nunca algo reversível; sem o pepper (segredo fora do banco) o
-- verificador não serve nem para ataque offline. O app usa as 10 mais recentes para recusar reuso (req. 82) e a
-- data da mais recente para o prazo de 90 dias (req. 81).
--
-- Acesso: só `service_role` (o pool administrativo do servidor). RLS forçada SEM política: nenhum papel de
-- aplicação lê ou escreve. Apagar o perfil apaga o histórico (CASCADE).
--
-- Número: depois da 0169 (P4.7-b). A 0168 é a Pix do #64. Aplicar só na integração final, depois das duas.

CREATE TABLE public.auth_password_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  verifier jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_password_history_verifier_chk CHECK (
    jsonb_typeof(verifier) = 'object'
    AND verifier->>'alg' = 'scrypt'
    AND (verifier->>'N')::int >= 16384
    AND char_length(verifier->>'salt') BETWEEN 16 AND 64
    AND char_length(verifier->>'hash') BETWEEN 32 AND 128
    AND NOT (verifier ? 'password')
  )
);
--> statement-breakpoint
CREATE INDEX auth_password_history_user_created_idx ON public.auth_password_history (user_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE public.auth_password_history ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.auth_password_history FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.auth_password_history FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.auth_password_history TO service_role;
--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0170-auth-password-history')
  ON CONFLICT DO NOTHING;

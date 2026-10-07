-- 0115 - encerramento definitivo da conta Asaas pausada.
--
-- Decisão de 07/10/2026. Uma conta pausada com histórico pode ser encerrada pela
-- clínica quando não há link de pagamento aberto, devolução não confirmada nem
-- contestação em andamento. Sem movimentação por 180 dias, ela é encerrada
-- automaticamente, com aviso por e-mail ao dono 30 dias antes.
--
-- closure_notice_sent_at guarda quando o aviso saiu. O encerramento automático
-- exige um aviso posterior à última movimentação e com pelo menos 30 dias; uma
-- movimentação nova invalida o aviso anterior. Retomar ou reconectar a conta
-- zera a coluna.
--
-- Sem GRANT para authenticated: a coluna é lida e escrita só pelo seam
-- privilegiado (lib/payments/account-store), como a credencial. Anulável e sem
-- default: ADD COLUMN só altera metadado.

ALTER TABLE public.clinic_payment_accounts
  ADD COLUMN IF NOT EXISTS closure_notice_sent_at timestamptz;
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0115-payment-account-closure')
ON CONFLICT (version) DO NOTHING;

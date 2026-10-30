-- O novo valor só será usado na migration seguinte: PostgreSQL não permite
-- consumir um enum adicionado na mesma transação em que foi criado.
ALTER TYPE public.subscription_change_kind ADD VALUE IF NOT EXISTS 'cycle_change';
--> statement-breakpoint
INSERT INTO public._schema_version (version) VALUES ('0129-subscription-cycle-change-kind')
ON CONFLICT (version) DO NOTHING;

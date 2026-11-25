-- Reversão da candidata 0170 (S4). Remove só o histórico de verificadores; nenhuma senha (ela fica no Auth).
DROP TABLE IF EXISTS public.auth_password_history;
DELETE FROM public._schema_version WHERE version = '0170-auth-password-history';

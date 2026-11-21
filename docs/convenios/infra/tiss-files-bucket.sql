-- Bucket PRIVADO dos arquivos TISS (P12.7, D20).
--
-- NÃO aplicado por este PR. Criar ou alterar bucket compartilhado (DEV ou produção)
-- exige autorização específica do fundador. Rodar no SQL Editor do projeto alvo,
-- com quem tem acesso ao schema `storage`, e conferir com a consulta do fim.
--
-- Por que assim:
--  - `public = false`: nenhuma URL pública; o app lê com service role no servidor e
--    entrega por rota same-origin que revalida sessão, permissão e clínica.
--  - Sem políticas para `anon`/`authenticated` em `storage.objects` para este bucket:
--    o navegador nunca acessa o bucket direto (nem por URL assinada).
--  - `allowed_mime_types` só `application/octet-stream`: os bytes chegam CIFRADOS por
--    clínica (encryptForTenant); o tipo real (XML/PDF) fica em `hi_files.media_type`.
--  - `file_size_limit` 30 MiB: o conteúdo tem teto de 20 MiB (CHECK `hi_files_size_chk`,
--    0147); a cifra grava base64 (+33%) com envelope, então o objeto cabe em 30 MiB.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tiss-files', 'tiss-files', false, 31457280, ARRAY['application/octet-stream'])
ON CONFLICT (id) DO NOTHING;

-- Conferência (deve devolver uma linha com public = false e nenhuma política do bucket):
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'tiss-files';
SELECT policyname, roles, cmd FROM pg_policies
 WHERE schemaname = 'storage' AND tablename = 'objects'
   AND (qual ILIKE '%tiss-files%' OR with_check ILIKE '%tiss-files%');

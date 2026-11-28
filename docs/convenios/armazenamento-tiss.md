# Armazenamento privado dos arquivos TISS (P12.7)

**Estado (12/11, tarde):** implementado, testado e **validado no DEV**: o bucket privado `tiss-files` foi criado **só no DEV** (autorização do fundador de 12/11) pela API de Storage — sem SQL/DDL e sem nenhuma política para `anon`/`authenticated` — e o aceite rodou contra ele (13/13). **Em produção o bucket não existe**: criar exige outra autorização. Sem o bucket, nenhuma exportação
grava arquivo (a gravação falha, a transação não confirma e o lote fica "preparado"), então ligar Convênios para uma
clínica depende deste passo.

## Arquitetura

| Peça | Onde | O que faz |
| --- | --- | --- |
| Metadados | `hi_files` (0147, 0150, 0152) | referência opaca `<clinic_id>/<uuid>`, SHA-256 do conteúdo e do cifrado, tamanho, tipo, versão (cadeia `supersedes_file_id`), origem; RLS por clínica; o runtime só lê e insere (sem UPDATE nem DELETE) |
| Bytes | bucket privado `tiss-files` | conteúdo **cifrado por clínica** antes de sair do servidor (`encryptForTenant`); sem sobrescrita (`upsert: false`) |
| Porta | `src/lib/storage/tiss-files.ts` | `put`/`get`/`remove`/`list`; "ausente" é erro próprio (`not_found`); prontidão do bucket (`checkTissBucketReadiness`: existe e é privado) |
| Leitura | `internal/tiss-file-access.ts` | confere os dois SHA-256, decifra, **audita toda leitura** (concedida, adulterada, ausente) com a finalidade, e só então entrega; a auditoria da falha é confirmada antes do erro |
| Download | `GET /financeiro/convenios/arquivos/:fileId` | gate de sessão, permissão (gerenciar financeiro) e clínica; limite de taxa; a mesma resposta 404 para negativa, outra clínica e inexistente; `no-store`, `nosniff`; arquivo adulterado ou ausente → 409 sem detalhe técnico |
| PDF da guia | `GET /financeiro/convenios/guias/:guideId/pdf` | gerado na hora do snapshot congelado (sem cópia guardada), pela leitura auditada `guide_pdf`, com software e build no rodapé |
| Consistência | `reconcileTissStorage` | registro sem objeto = **ausente** (crítico, métrica `insurance.file.missing`, nunca corrigido sozinho); objeto sem registro = **órfão** (sobra de compensação, cifrado, nunca entregue) |

Não há URL pública nem assinada em nenhum caminho. Conhecer o identificador do arquivo não basta: ele só é usado
depois do gate e da consulta presa à clínica da sessão.

## Falhas e recuperação

- **Gravação falha** (bucket fora, rede): a exportação recusa; a transação não confirma; nada fica "exportado" sem
  arquivo (harness de lotes, cenário de falhas).
- **Banco cai depois da gravação**: a compensação remove o objeto; se a compensação também falhar, sobra um órfão
  cifrado (métrica `insurance.file.orphan`), que a conferência encontra.
- **Objeto adulterado**: a leitura recusa (SHA-256 do cifrado ou do conteúdo não confere), audita `integrity_failed`
  e a rota responde 409.
- **Objeto ausente**: a leitura recusa, audita `missing`, emite `insurance.file.missing`; a rota responde 409. A
  recuperação é restaurar o objeto do backup do armazenamento (o banco guarda o SHA-256 para conferir a restauração);
  nunca regravar a partir de dado atual (um documento emitido não é reconstruído com o cadastro de hoje).
- **Armazenamento indisponível**: 503, sem tocar em nada.

## Retenção e descarte

- **Documento emitido não é apagado.** `hi_files` não tem DELETE para o runtime e o objeto referenciado nunca é
  removido pela conferência. O prazo legal de guarda dos documentos de faturamento ainda depende de orientação
  jurídica (B6 do plano); até lá, nada emitido tem prazo de descarte definido — não é fixado prazo sem fundamento.
- **Descarte controlado só de órfão:** objeto sem registro, mais velho que a carência (24 h, para não pegar uma
  exportação confirmando agora), conferido de novo logo antes de remover. Sem data de criação, fica.
- **Anonimização do cadastro ≠ documento emitido:** anonimizar o paciente (LGPD) não altera XML, PDF ou snapshot já
  emitidos, que são documentos fiscais/contratuais com a operadora; o acesso a eles continua auditado.
- **Encerramento da clínica:** o `ON DELETE CASCADE` de `clinics` remove os metadados; o objeto vira órfão e só é
  descartado pela conferência. A política de guarda depois do encerramento é parte de B6.

## Provisionamento (DEV feito em 12/11; produção pendente de autorização)

1. Rodar `docs/convenios/infra/tiss-files-bucket.sql` no projeto alvo (DEV primeiro), com autorização.
2. Conferir: uma linha com `public = false`, nenhuma política de `storage.objects` para o bucket.
3. Conferir pelo app: `checkTissBucketReadiness()` devolve `ready`.
4. Só depois disso a habilitação controlada pode ligar Convênios para uma clínica piloto.

## Provas

- `scripts/security/health-insurance-batches-db.ts`, cenário 1b (P12.7): download com integridade e auditoria,
  outra clínica não acha o arquivo pelo ID, adulterado e ausente recusados com a auditoria da falha gravada,
  conferência (ausente e órfão), descarte só de órfão fora da carência.
- `src/contexts/health-insurance/internal/tiss-file-access.test.ts`: plano de consistência (órfão, ausente,
  carência, sem data, retenção).
- `scripts/security/health-insurance-storage-dev-bucket.ts` — **contra o bucket real do DEV** (metadados em Postgres descartável): upload e download autorizados, outra clínica e chave publicável negadas (sem download, listagem ou gravação), URL "pública" 400, cifrado, SHA-256, adulterado e ausente recusados com auditoria, falha REAL de credencial (lote fica preparado, nada no bucket), reprocessamento idempotente, 6 exportações concorrentes, só `application/octet-stream`, órfão dentro/fora da carência, sem dado sensível em log; objetos sintéticos removidos no fim. Evidência: `evidence/tiss-ciclo-infra-0153-2026-11-12/`.
- **Reversão no DEV** (só enquanto o bucket tiver apenas dados sintéticos): esvaziar e apagar o bucket pela API de Storage (`POST /storage/v1/bucket/tiss-files/empty`, `DELETE /storage/v1/bucket/tiss-files`).

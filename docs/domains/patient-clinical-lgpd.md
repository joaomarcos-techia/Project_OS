# Pacientes, dados clínicos e LGPD

## Status

Canonical — ciclo de vida do paciente, prontuário e direitos do titular.

## Source of Truth

`src/contexts/patient`, `src/contexts/clinical`, crypto/storage em `src/lib` e migrations.

## Paciente

- `patients` guarda identidade básica e estado de ciclo de vida.
- CPF e telefone são cifrados por tenant; lookup usa HMAC. E-mail normalizado não usa o mesmo mecanismo.
- Endereço, contato de emergência, dados clínicos, consentimentos e vínculos têm tabelas próprias.
- Merge preserva proveniência; óbito e suppression impedem comunicações indevidas.
- Soft delete pode ser restaurado por até 30 dias, desde que não tenha sido anonimizado, expirado ou esteja sob pedido de exclusão.

## Prontuário e documentos

- `prontuarios` contém SOAP cifrado e `rowVersion` para edição concorrente do draft.
- Assinatura torna o registro imutável por trigger.
- Correção posterior arquiva a versão legal anterior e cria uma versão auditada; não reescreve o original.
- Snapshot de paciente e profissional preserva o contexto legal.
- Prescrições suportam simples e controle especial. A implementação de controle especial é receita branca em duas vias; não há numeração oficial/tarja preta integrada.
- Documentos: atestado, exame, declaração e encaminhamento.
- PDFs clínicos ficam no bucket privado `clinical-pdfs`; o browser os acessa por rota Qoro
  autenticada, tenant-scoped e `no-store`, sem signed URL do Storage no DOM (ADR-059).
- Emissão clínica exige gates de permission e, conforme o documento, credencial CRM/UF/especialidade.

## LGPD

Tipos de pedido: exportação e exclusão. Estado: `pending`, `processing`, `completed` ou `failed`, com histórico. Prazo operacional persistido: 15 dias.

### Exportação

Evento de outbox monta JSON e PDF com dados permitidos, salva no bucket privado `lgpd-exports` e gera URLs assinadas de 24 h. O link expirado exige nova geração; a URL já emitida não possui revogação imediata garantida pelo CDN.

### Exclusão

1. pedido validado cria histórico e soft delete;
2. comunicações e agenda cancelável são interrompidas por eventos;
3. após 30 dias, cron tenta hard delete;
4. se retenção clínica impedir exclusão física, PII é anonimizada e o registro legal permanece;
5. artefatos de export, audit/idempotência/outbox correlacionados são tratados pelo workflow.

Pedido LGPD não é bloqueado por inadimplência da clínica.

## Segurança e acesso

- permissions distintas controlam visualizar, criar, editar, excluir e exportar paciente; prontuário/prescrição têm permissions próprias.
- PII decifrada não pode ir a logs, métricas ou eventos.
- Storage usa buckets privados. PDFs clínicos passam por proxy autenticado; exports LGPD destinados ao
  titular ainda usam URL temporária de 24 h por contrato próprio.
- RLS isola clínica; actor GUC permite políticas autorais quando necessário.

## Failure modes

- chave de crypto ausente/versão desconhecida: falhar fechado, sem retornar ciphertext como dado;
- referência clínica impede hard delete: anonimizar em vez de quebrar retenção;
- PDF/Storage indisponível: evento falha e é retentado;
- PDF clínico indisponível: falhar fechado sem expor path/token; export LGPD expirado exige nova
  geração conforme seu contrato próprio.

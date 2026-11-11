# Exclusão de paciente com guia de convênio: retenção e LGPD (P12.13)

Atualizado em 11/11/2026 (noite). Estado técnico verificado no código e provado num Postgres descartável com todas as
migrations reais (`scripts/security/health-insurance-coverage-db.ts`, prova 13; `health-insurance-billing-reconcile-db.ts`, prova 19). **A política final de retenção depende
de orientação jurídica (bloqueio B6); nenhum prazo foi definido por inferência.**

## O que o Qoro faz hoje (técnico, independente da decisão jurídica)

| Situação na exclusão definitiva | Resultado | Por quê |
| --- | --- | --- |
| Paciente **sem** guia (pode ter cobertura ou carteirinha) | excluído por inteiro; cobertura, coparticipação estimada e carteirinha saem em cascata | cobertura é dado administrativo pré-faturamento; não há documento de cobrança a conservar |
| Paciente **com** guia (qualquer estado) | **anonimizado**, não excluído: nome, CPF, telefone, e-mail, data de nascimento e sexo trocados por marcadores; endereços, contatos, consentimentos e dados clínicos cadastrais apagados; pedido LGPD marcado como atendido sob exceção legal | a guia é documento de cobrança à operadora; a FK da guia para o paciente não tem cascata (0147), e o expurgo existente (`hardDeletePatients`, ADR-017/ADR-021) já trata esse bloqueio como retenção e anonimiza, exatamente como faz com prontuário |
| Excluir paciente ou carteirinha com guia por qualquer outro caminho | recusado pelo banco (23503) | a guia não some com a exclusão do paciente |
| Paciente só com **pendência de faturamento** (0149, sem guia) | excluído; a pendência fica ligada ao atendimento, sem dado pessoal | a pendência guarda só ids, códigos e mensagens genéricas; não segura a exclusão |

Não existe nem exclusão automática da guia nem bloqueio silencioso: o pedido termina como `completed` (anonimizado), o
resultado é contado no relatório do expurgo (`anonymized`) e a guia segue íntegra, com snapshot cifrado e histórico.

## Anonimizar o cadastro NÃO anonimiza os documentos já emitidos

A anonimização troca os dados do **cadastro** do paciente. Ela não reescreve o que já foi emitido e conservado, e o Qoro
não afirma o contrário:

| Registro | Contém dado pessoal? | O que a anonimização do cadastro faz | Onde está |
| --- | --- | --- | --- |
| snapshot da guia emitida (0147) | sim: nome do beneficiário, número da carteirinha, dados do profissional | **nada**: fica como foi emitido, cifrado por clínica, com SHA-256 | `hi_guide_snapshots` |
| XML do lote (0150) | sim: nome e carteirinha de cada guia do lote | **nada**: fica como foi exportado, cifrado por clínica, no armazenamento privado | `hi_files` + bucket `tiss-files` |
| PDF oficial da guia (P7.6/P8.5, ainda não implementado) | sim | o mesmo: documento emitido não é reescrito | `hi_files` |
| demonstrativos e recursos de glosa (P9.5/P9.7) | sim | o mesmo | `hi_files` |
| recebíveis e lançamentos | o nome pode estar na descrição | regra do expurgo financeiro existente | `lancamentos` |
| auditoria de acesso | ids de usuário e de recurso, sem conteúdo | nada (prova de quem acessou) | `audit_events` |
| backups | tudo o que existia na data do backup | nada: o backup expira pela política de backup, não pelo pedido | Supabase |
| identificadores indiretos | número da guia, número do lote, protocolo da operadora | nada: ligam o documento à operadora | tabelas do convênio |

Consequências que a orientação jurídica precisa cobrir (B6): o pedido de **acesso** do titular inclui esses documentos;
o pedido de **eliminação** fica limitado pela obrigação de conservação; e o **descarte** depois do prazo tem de alcançar
os bytes no armazenamento privado e os backups, não só as linhas do banco.

## O que fica retido junto com a guia, e por quê

- **Guia, itens, snapshot cifrado, histórico e arquivos** (0147): documento de cobrança e prova da conferência.
- **Carteirinha ligada à guia**: o número cifrado é parte do documento enviado à operadora (beneficiário). Fica cifrado por
  clínica; a leitura só pela via auditada com finalidade.
- **Autorização ligada à guia** (0146): evidência da operadora.
- **Lote, protocolo e retornos** (0150): prova do envio e da resposta da operadora; o XML do lote é imutável depois de
  exportado (versão nova substitui na cadeia, nunca sobrescreve).

## O que depende da orientação jurídica (B6)

1. **Prazo de conservação** de guias, autorizações, demonstrativos e recursos de glosa (obrigações contratuais com a
   operadora, fiscais e de auditoria). Sem prazo definido, nada é descartado automaticamente.
2. **Política de descarte** depois do prazo: o que vira exclusão, o que vira anonimização da guia (por exemplo, retirar o
   número da carteirinha do snapshot) e quem aprova.
3. **Restrição de acesso a registros de pacientes anonimizados**: hoje valem as permissões de faturamento e a leitura
   auditada; a orientação pode exigir um perfil mais restrito.
4. **Justificativa ao titular**: o texto da resposta ao pedido de exclusão quando há guia (exceção do art. 16, I, da LGPD,
   cumprimento de obrigação legal ou regulatória), a validar.
5. **Carteirinhas sem guia de pacientes anonimizados**: hoje continuam cifradas junto com a anonimização; a orientação
   define se devem sair (minimização) quando nenhuma guia as referenciar.

## Próximas proteções técnicas (não dependem da decisão)

- registro de decisão de retenção por paciente (motivo, guias envolvidas, data, prazo pendente de definição), consultável na
  auditoria;
- relatório de pacientes anonimizados com guias retidas, para a revisão periódica quando o prazo existir;
- inventário dos arquivos no armazenamento privado por paciente (via guias e lotes), para responder ao pedido de acesso e,
  depois do prazo, para o descarte dos bytes, não só das linhas.

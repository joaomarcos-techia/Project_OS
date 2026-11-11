# Exclusão de paciente com guia de convênio: retenção e LGPD (P12.13)

Atualizado em 11/11/2026. Estado técnico verificado no código e provado num Postgres descartável com todas as
migrations reais (`scripts/security/health-insurance-coverage-db.ts`, prova 13). **A política final de retenção depende
de orientação jurídica (bloqueio B6); nenhum prazo foi definido por inferência.**

## O que o Qoro faz hoje (técnico, independente da decisão jurídica)

| Situação na exclusão definitiva | Resultado | Por quê |
| --- | --- | --- |
| Paciente **sem** guia (pode ter cobertura ou carteirinha) | excluído por inteiro; cobertura, coparticipação estimada e carteirinha saem em cascata | cobertura é dado administrativo pré-faturamento; não há documento de cobrança a conservar |
| Paciente **com** guia (qualquer estado) | **anonimizado**, não excluído: nome, CPF, telefone, e-mail, data de nascimento e sexo trocados por marcadores; endereços, contatos, consentimentos e dados clínicos cadastrais apagados; pedido LGPD marcado como atendido sob exceção legal | a guia é documento de cobrança à operadora; a FK da guia para o paciente não tem cascata (0147), e o expurgo existente (`hardDeletePatients`, ADR-017/ADR-021) já trata esse bloqueio como retenção e anonimiza, exatamente como faz com prontuário |
| Excluir paciente ou carteirinha com guia por qualquer outro caminho | recusado pelo banco (23503) | a guia não some com a exclusão do paciente |

Não existe nem exclusão automática da guia nem bloqueio silencioso: o pedido termina como `completed` (anonimizado), o
resultado é contado no relatório do expurgo (`anonymized`) e a guia segue íntegra, com snapshot cifrado e histórico.

## O que fica retido junto com a guia, e por quê

- **Guia, itens, snapshot cifrado, histórico e arquivos** (0147): documento de cobrança e prova da conferência.
- **Carteirinha ligada à guia**: o número cifrado é parte do documento enviado à operadora (beneficiário). Fica cifrado por
  clínica; a leitura só pela via auditada com finalidade.
- **Autorização ligada à guia** (0146): evidência da operadora.

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
- relatório de pacientes anonimizados com guias retidas, para a revisão periódica quando o prazo existir.

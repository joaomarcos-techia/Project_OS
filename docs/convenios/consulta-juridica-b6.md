# Consulta jurídica: retenção, descarte e direitos do titular nos documentos de convênio (B6)

**Para:** jurídico (LGPD e saúde suplementar).
**Pedido:** prazos e regras de guarda e descarte para os documentos de faturamento de convênio, e o texto ao
titular. **Nenhum prazo foi definido por inferência,** e nada é descartado automaticamente até a resposta.

## 1. O que o sistema guarda por causa do convênio

| Documento | Contém dado pessoal | Onde fica | Para que serve |
| --- | --- | --- | --- |
| Guia (Consulta ou SP/SADT), itens e histórico | sim: beneficiário, carteirinha, profissional | banco, com o conteúdo emitido cifrado por clínica e com SHA-256 | documento de cobrança à operadora; prova da conferência |
| Carteirinha | número cifrado por clínica | banco | identifica o beneficiário na guia; leitura só pela via auditada, com finalidade |
| Autorização (senha, número da operadora) | ligada ao beneficiário | banco | evidência da operadora |
| Lote XML, protocolo e retornos | sim: nome e carteirinha de cada guia | arquivo cifrado em armazenamento privado + referência no banco | prova do envio e da resposta |
| PDF da guia, demonstrativos e recursos de glosa | sim | arquivo cifrado em armazenamento privado | documentos do ciclo de cobrança |
| Recebíveis e lançamentos | a descrição pode ter o nome | banco | contabilidade da clínica |
| Trilha de acesso | só ids de usuário e de recurso | banco | prova de quem acessou o quê |
| Backups | tudo o que existia na data | provedor do banco | continuidade |

## 2. O que o sistema faz hoje (técnico, provado em testes)

- **Paciente sem guia:** a exclusão remove tudo. Cobertura, coparticipação estimada e carteirinha saem em
  cascata.
- **Paciente com guia:** é **anonimizado**, não excluído:
  - nome, CPF, telefone, e-mail, nascimento e sexo viram marcadores;
  - endereços, contatos, consentimentos e dados cadastrais clínicos são apagados;
  - o pedido termina como "atendido sob exceção legal".
- **Excluir paciente ou carteirinha que tem guia por outro caminho:** o banco recusa.
- **Documentos já emitidos** (guia emitida, XML, PDF, demonstrativos): a anonimização do cadastro **não** os
  reescreve. Eles ficam como foram emitidos, cifrados.

## 3. O que precisamos que o jurídico decida

1. **Prazo de guarda** de guias, autorizações, demonstrativos e recursos de glosa, considerando obrigações
   contratuais com a operadora, fiscais, contábeis e de auditoria. Há prazos diferentes por tipo de documento?
2. **Destino depois do prazo:** excluir, ou anonimizar o documento emitido (por exemplo, retirar o número da
   carteirinha do conteúdo guardado)? Quem aprova o descarte?
   - O descarte precisa alcançar os arquivos no armazenamento privado e os backups, não só as linhas do banco.
     Qual é o tratamento aceitável para os backups (expiração pela política de backup)?
3. **Acesso a registros de pacientes anonimizados que têm guias retidas:** bastam as permissões de faturamento
   e a leitura auditada de hoje, ou é preciso um perfil mais restrito?
4. **Resposta ao titular:**
   - Qual é o texto quando o pedido de eliminação esbarra em guia retida? A base que consideramos é o
     art. 16, I, da LGPD, cumprimento de obrigação legal ou regulatória; precisa ser validada.
   - O pedido de **acesso** deve incluir os documentos emitidos (guia, XML, PDF)?
5. **Carteirinha sem guia de paciente anonimizado:** hoje continua guardada, cifrada. Deve sair por
   minimização quando nenhuma guia a referenciar?

## 4. Proteções técnicas que não dependem do prazo (planejadas, ainda não implementadas)

- inventário dos arquivos de cada paciente, pelas guias e lotes, para responder ao pedido de acesso e, depois,
  para descartar os bytes;
- registro, por paciente, da decisão de retenção (motivo, guias envolvidas e data), consultável na auditoria;
- relatório de pacientes anonimizados com guias retidas, para a revisão periódica quando houver prazo.

Elas podem ser feitas antes da resposta. A rotina de descarte, não.

## 5. Limites que seguimos até a resposta

- nenhum descarte automático ou irreversível;
- nenhum documento ligado a obrigação legal é destruído;
- nenhum prazo é adotado por conta própria (nem o "mais longo conhecido").

As tarefas P12.3 (exportação, anonimização e retenção) e P12.13 (exclusão de paciente com guia) continuam
abertas até esta decisão.

## 6. Pesquisa documental e controles (25/11/2026, noite)

Sem advogado contratado, a pesquisa foi feita nas fontes oficiais (`QORO-TISS-CONFORMIDADE-REGULATORIA.md`, seção 7):

- **prontuário:** 20 anos do último registro (Lei 13.787/2018, art. 6º; Parecer CFM 19/2026), eliminação só com termo;
- **documentos de cobrança TISS:** 5 anos a partir do exercício seguinte ao último evento financeiro (Código Civil,
  art. 206, §5º, I e art. 1.194; CTN, arts. 173 e 195) — interpretação, sem prazo TISS expresso;
- **registro de acesso:** 186 dias (Marco Civil, art. 15; ANS, requisito 84), a única purga automática;
- **respostas às 5 perguntas** desta ficha, com o texto ao titular, na mesma seção.

Implementado: catálogo das 16 categorias (`src/lib/compliance/retention-catalog.ts`), simulação de vencimento sem
escrita, trava de descarte com termo humano e inventário por paciente (`retention-inventory.ts`, harness
`health-insurance-retention-db.ts`). **Nenhum descarte automático de documento.** Pendem só duas decisões do fundador:
eliminar a carteirinha sem guia de paciente anonimizado e aceitar o prazo interpretado dos documentos de cobrança.

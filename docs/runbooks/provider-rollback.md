# Rollback de provedor — roteiro futuro

**Ativar somente para a janela/capacidade autorizada.** Matrizes de decisão em [plano de rollback](../decoupling/12-plano-de-rollback.md); contexto em [cutover](provider-cutover.md). Não restaure banco sobre produção automaticamente.

## Procedimento

1. **Declarar contenção.** Registrar hora/run ID/falha/gate e responsável. Parar novas operações no componente afetado; preservar serviço de leitura se seguro. Não usar desligamento indiscriminado de clínica como controle técnico.
2. **Parar duplicidade.** Desligar scheduler/writer novo antes de reativar antigo; manter endpoints recebendo duravelmente onde implementado e não descartar eventos. Registrar leases e efeitos remotos desconhecidos.
3. **Fotografar os dois estados.** Exportar apenas metadados/contagens/checkpoints permitidos e backup protegido autorizado. Não registrar conteúdo clínico, segredo, payload bruto financeiro ou URL assinada em log.
4. **Classificar efeitos.** Houve escrita DB, upload/delete, senha/reset/revogação, cobrança/mensagem externa ou apenas troca de host? Commit/DNS só bastam no último caso e com schema/config compatíveis.
5. **Reconciliar antes do retorno.** Usar checkpoint/delta para registros, hashes/tombstones para objetos, epoch/subject/reset para identidade e readback no provider da obrigação para financeiro. Nenhuma cobrança incerta é recriada na origem sem prova.
6. **Escolher rollback ou forward-fix.** Se reverse sync não foi ensaiado, faltam deltas ou há efeitos irreversíveis, manter contenção e corrigir à frente com aprovação concreta. O plano não autoriza apagar esses efeitos.
7. **Retornar release/rota.** Promover última versão segura compatível com schema expandido; corrigir origens/proxy/TLS. Reautenticação pode ser necessária; não reativar credencial revogada para evitar atrito.
8. **Retomar um executor.** Religar writer/scheduler único; jobs com leases e guards; observar backlog, refunds/disputas e callbacks antigos. Guardar binding de provider que recebeu qualquer efeito.
9. **Validar.** Smoke funcional + segurança tenant + consistência DB/objetos/financeiro + health/alerta. Compare com snapshot e log de operações posteriores; zero perdas/duplicidades não explicadas.
10. **Encerrar incidente.** Owner confirma retomada; registrar duração observada, dados/obrigações preservados, exceções, comunicação autorizada e ações preventivas. Não remover destino/backup/evidência até retenção aprovada.

## Evidência mínima

SHA/releases retornados, ambiente e capacidade; checkpoints; número agregado de operações/objetos reconciliados; verificações de isolamento/ACL; dívida/recorrência/benefício por operação sintética; duração real; owner/aprovador. Se houver dados reais, registro protegido com acesso mínimo e sem identificadores pessoais neste relatório Git.

Não usar `DELETE`, reset scripts, migration DOWN ou restauração física de backup antigo como atalho de retorno. Nenhum comando destrutivo aparece aqui porque a reversão correta depende do estado da janela e deve ser revisada antes de execução.

# Convênios, lotes e CID — próxima discussão de produto

Registrado em **09/11/2026**, a pedido do founder.

**Estado: frente futura, a discutir após a migração das assinaturas Qoro de Asaas para AbacatePay.** Este registro não significa funcionalidade implementada, prazo de entrega ou autorização para iniciar mudanças agora.

## O que foi solicitado

1. **Lotes para convênios:** criar lotes de atendimentos/documentos para encaminhamento ao convênio.
2. **Registro de CID:** incluir o registro necessário ao atendimento e à documentação de convênios. Campos, momento do preenchimento e responsáveis serão definidos na discussão da funcionalidade.
3. **Convênio informado pelo paciente à IA:** o paciente informa ao agente qual convênio deseja utilizar. O sistema deve identificar essa escolha e preservá-la no fluxo do atendimento.
4. **Documento gerado automaticamente:** a partir do convênio escolhido e dos dados necessários ao atendimento, gerar o documento correspondente para encaminhamento ao convênio, sem redigitação desnecessária.

## O que ainda precisa ser definido nessa discussão

- Quais convênios e planos serão atendidos e como cadastrar suas exigências.
- Como validar o convênio informado, o vínculo do paciente e as condições do atendimento. Informar um convênio não deve ser apresentado como confirmação de cobertura ou autorização concedida.
- Qual documento/guia cada convênio exige, seus dados obrigatórios e o uso do CID. Não tratar a fala do paciente como diagnóstico médico confirmado.
- Quando gerar o documento, como agrupá-lo em lotes e como tratar alterações, cancelamentos, duplicidades e correções.
- Se haverá revisão antes do encaminhamento e se a entrega será exportação, envio manual ou integração direta. **Geração automática do documento foi solicitada; envio automático externo ainda não foi definido.**
- Regras de acesso, rastreabilidade e proteção dos dados clínicos envolvidos, além dos testes do fluxo completo.

As regras comerciais, formatos de arquivos e integrações serão investigados antes de especificar a implementação; este registro não presume uma API ou padrão já suportado pelo Qoro. Também não equivale à emissão de Nota Fiscal.

## Dependências e trabalho paralelo

- Concluir primeiro a migração financeira de **assinaturas da clínica à Qoro**, acompanhada no [plano mestre](../decoupling/asaas-to-abacatepay/PLANO-MESTRE-MIGRACAO-ASAAS-ABACATEPAY.md). Pagamentos de pacientes e recebimento das clínicas não fazem parte dessa troca de gateway.
- O founder informou que **outro agente de IA está trabalhando na refatoração da UI em segundo plano**, em branch/worktree separados. Preservar esse trabalho; nenhuma alteração de UI faz parte deste registro.
- Após a etapa financeira, retomar esta pauta com o founder para definir a jornada e os critérios de aceite antes de começar a implementação.

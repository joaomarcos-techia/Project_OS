# lib/pdf

Geração server-side de PDFs com `@react-pdf/renderer`. Os renderizadores são funções puras: recebem
payload tipado e devolvem `Buffer`, sem banco, upload ou efeito externo.

Templates implementados: prescrição, receituário de controle especial, atestado, declaração, exame,
encaminhamento e relatório. As rotas consumidoras devem usar runtime Node, autenticação/RBAC, rate
limit de exportação, `Cache-Control: no-store` e nome de arquivo controlado pelo servidor.

O comprovante financeiro da Camada 2 ainda não existe. Seu contrato e a separação entre comprovante
não fiscal, Receita Saúde e NFS-e estão no [ADR-054](../../../docs/adr/054-documento-de-pagamento-e-recibo-fiscal.md).

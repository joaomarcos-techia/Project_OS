# ADR-056 — Spike 2.2.0 da integração Memed

## Status

Proposed — spike documental concluído em 2026-09-07; implementação bloqueada por dependências
externas e regulatórias.

## Contexto

A Camada 2 prevê prescrição digital por meio da Memed. O Qoro já possui prescrição local, PDF,
criptografia por tenant e trilha clínica, mas isso não prova que o contrato atual comporte a Memed
nem autoriza trocar silenciosamente o emissor de uma prescrição.

Este spike responde somente se existe um caminho arquitetural seguro. Ele não cria credenciais, não
chama a API da Memed, não carrega o script externo, não altera CSP, schema ou runtime e não substitui
a homologação exigida pelo fornecedor.

## Evidência externa vigente

Documentação oficial consultada em 2026-09-07:

1. a integração usa API no backend e o script `MdHub` no frontend, sempre sobre HTTPS; chave e
   segredo pertencem exclusivamente ao backend
   ([Introdução](https://doc.memed.com.br/docs/intro/),
   [Boas práticas](https://doc.memed.com.br/docs/boas-praticas-integracao/));
2. o ambiente de homologação possui URLs próprias, e cada prescritor recebe um token obtido pelo
   backend antes de o frontend identificar prescritor e paciente
   ([Primeiros passos](https://doc.memed.com.br/docs/primeiros-passos/),
   [Autenticação frontend](https://doc.memed.com.br/docs/frontend/autenticacao/));
3. o token do prescritor não deve ser tratado como estático; a aplicação deve recuperar o mais
   recente. Desde 13/02/2026, CPF ou passaporte e data de nascimento do prescritor são obrigatórios
   para novas inserções
   ([Usuário prescritor](https://doc.memed.com.br/docs/backend/usuario-prescritor/));
4. os eventos `prescricaoImpressa` e `prescricaoExcluida` fazem parte dos requisitos de homologação.
   Eles nascem no navegador e precisam ser registrados uma única vez
   ([Boas práticas](https://doc.memed.com.br/docs/boas-praticas-integracao/),
   [Prescrição impressa](https://doc.memed.com.br/docs/frontend/eventos-mdhub/prescricao-impressa/));
5. o modo tela cheia é recomendado; o modo embutido exige área mínima de 820 × 700
   ([Modos de exibição](https://doc.memed.com.br/docs/modos-de-exibicao/));
6. credenciais de produção dependem de avaliação/homologação e podem ser revogadas
   ([Obter credenciais](https://doc.memed.com.br/docs/obter-credenciais/));
7. a Anvisa informa que os novos modelos eletrônicos de receituários controlados dependem da
   disponibilização do SNCR, prevista para 30/09/2026. Até prova posterior, essa data não é
   capacidade disponível do Qoro ou da Memed
   ([Receituário eletrônico](https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/controlados/sncr/receituario-eletronico),
   [Perguntas e respostas da RDC 1.000/2025](https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/controlados/sncr/perguntas-e-respostas/perguntas-e-respostas-rdc-1000-2025-1-ed)).

Os termos públicos do produto médico não estabelecem preço, franquia, SLA ou suporte da integração
B2B do Qoro. A eventual gratuidade do produto usado diretamente pelo profissional não pode ser
extrapolada para parceria/API
([Termos Memed para médicos](https://suporte-medico.memed.com.br/hc/pt-br/articles/11822598155419-Termos-de-uso-M%C3%A9dicos)).

## Evidência do código atual

- `profiles` possui nome, CRM, UF e especialidade, mas não possui a identidade mínima do prescritor
  exigida atualmente pela Memed, como CPF e data de nascimento;
- o contexto Patient possui dados de identidade cifrados e seams de leitura por propósito. Não há
  seam específico que entregue à integração apenas os dados mínimos do paciente;
- `prescriptions` é tenant-scoped, guarda conteúdo cifrado, snapshots clínicos e PDF local
  idempotente, mas não possui identidade, versão ou estado autoritativo de uma prescrição Memed;
- a criação local aceita prescrição sem prontuário e exige CRM. Ela deve continuar disponível como
  fluxo explícito, não como duplicação automática de uma emissão externa;
- o CSP atual não autoriza hosts da Memed. Ampliá-lo globalmente sem inventário de hosts e política de
  isolamento seria uma mudança de segurança, não uma simples configuração de tela;
- o tipo local `controle_especial` não equivale, por si só, a receituário controlado eletrônico
  autorizado, numerado ou assinado conforme a regulação aplicável.

## Decisão proposta

Se os gates externos passarem, a implementação seguirá estas regras:

1. **dois emissores explícitos:** prescrição local e prescrição Memed são escolhas visíveis. O Qoro
   nunca emite as duas silenciosamente;
2. **segredo somente no backend:** API key e secret não chegam ao browser. O backend solicita um
   token transitório do prescritor;
3. **token efêmero:** o token não entra em URL, banco, `localStorage`, telemetria ou log. Vive apenas
   em memória durante a abertura da experiência e é renovado quando necessário;
4. **loader único:** script e listeners da Memed são carregados uma vez por página/sessão, com
   cleanup explícito e sem duplicar callbacks após navegação;
5. **evento do browser não é autoridade:** `prescricaoImpressa` e `prescricaoExcluida` são sinais de
   sincronização. Antes de consolidar o estado local, o backend precisa fazer readback autoritativo
   ou consumir webhook server-to-server documentado pela Memed;
6. **isolamento multi-tenant:** toda identidade externa é vinculada a `clinic_id`, prescritor e
   paciente obtidos da sessão autenticada. `clinic_id` recebido do browser nunca define escopo;
7. **identificadores opacos:** IDs enviados ao fornecedor não contêm CPF, telefone, nome ou outro
   dado sensível. A correlação local é estável, tenant-scoped e auditável;
8. **exclusão auditável:** exclusão no fornecedor produz tombstone/estado local; não apaga o registro
   clínico e a trilha legal em cascata;
9. **escopo profissional no servidor:** conselho, UF, profissão, permissões e o tipo que cada
   categoria pode prescrever são verificados antes da emissão;
10. **controlados com gate próprio:** receitas controladas permanecem indisponíveis na integração
    até prova de SNCR, assinatura exigida, capacidade Memed, homologação e aceite jurídico.

## Fluxo-alvo

```text
profissional autenticado + tenant da sessão
        ↓
Qoro valida RBAC, conselho, paciente e tipo de prescrição
        ↓
backend obtém/renova token transitório do prescritor Memed
        ↓
frontend carrega MdHub uma vez e define paciente mínimo
        ↓
profissional emite ou exclui na interface Memed
        ↓
evento frontend informa identidade externa ao backend
        ↓
backend faz readback autoritativo ou valida webhook Memed
        ↓
Qoro grava projeção tenant-scoped, auditável e idempotente
```

Falha de rede ou ausência de readback mantém o estado `sync_pending`/equivalente observável; não
declara a prescrição emitida ou excluída apenas pela ação no navegador.

## Modelo mínimo a confirmar antes da migration

Esta é uma distribuição de responsabilidade, não um schema aprovado:

- **Identity/Team:** vínculo tenant-scoped do prescritor Memed, conselho, UF, profissão e dados
  mínimos cifrados exigidos pelo fornecedor;
- **Patient:** seam específico para identidade de prescrição, retornando somente campos exigidos e
  autorizados;
- **Clinical:** provider, ID externo da prescrição, versão do payload, estado sincronizado,
  `issued_at`, `deleted_at`, último readback e referência de auditoria;
- **restrição de unicidade:** `(clinic_id, provider, provider_prescription_id)`;
- **proibido persistir por conveniência:** token de prescritor, chave, secret e payload clínico bruto
  redundante sem justificativa de retenção.

Uma migration só será proposta depois de o contrato real confirmar campos, estados, tamanho dos IDs,
versionamento, webhooks/readback e semântica de exclusão/correção.

## Gates externos obrigatórios

Antes de código de integração, obter resposta escrita da Memed para:

1. preço, franquia, limites, ambiente, SLA e canal de suporte da parceria/API;
2. contrato LGPD: controlador/operador, suboperadores, residência, retenção, descarte e incidente;
3. duração, rotação, revogação e escopo do token de prescritor;
4. API de readback ou webhook server-to-server para emissão, exclusão, correção e reemissão;
5. assinatura, autenticação, replay protection e política de retry dos webhooks;
6. versionamento e compatibilidade dos eventos/payloads;
7. hosts exatos de script, API, frames e mídia em homologação/produção, política de SRI ou alternativa
   de isolamento;
8. comportamento de identificadores externos quando um profissional atua em mais de uma clínica;
9. homologação, credenciais e dados/test users fornecidos formalmente;
10. suporte real ao SNCR e a cada tipo de receituário controlado após a disponibilização oficial.

## Testes exigidos para a futura implementação

- **Unit:** routing local/Memed, loader single-flight, mapping tipado, token ausente/expirado, eventos
  desconhecidos, estados de emissão/exclusão e logs sem segredo/PII;
- **Integration:** backend token → frontend → evento → readback → projeção; idempotência, replay,
  evento fora de ordem, exclusão/correção e falha parcial;
- **RBAC/RLS:** tenant A não consulta, emite, sincroniza ou exclui prescrição do tenant B; perfil sem
  permissão é negado no servidor;
- **CSP/security:** apenas hosts aprovados, script único, token fora de URL/storage/log e inputs do
  provider validados;
- **E2E controlado:** homologação Memed com profissional e paciente sintéticos, emissão, PDF,
  exclusão/correção e readback;
- **E2E real/regulatório:** somente após homologação formal; receitas controladas exigem prova
  adicional do SNCR e assinatura aplicável.

Mocks validam o código do Qoro, mas não contam como homologação ou E2E real da Memed.

## Resultado do spike

**PARTIAL / BLOCKED externo.** A arquitetura é tecnicamente viável, mas ainda não existe base
contratual, operacional e regulatória suficiente para autorizar código, migration ou carregamento do
SDK. O próximo passo é obter as respostas dos gates externos. Enquanto isso, a prescrição local
permanece o único caminho implementado e nenhuma capacidade regulada nova deve ser anunciada.


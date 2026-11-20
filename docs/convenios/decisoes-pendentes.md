# Decisões humanas pendentes do módulo Convênios (atualizado em 19/11/2026)

Uma ficha por decisão. Nenhuma é presumida a partir de silêncio; cada uma destrava tarefas nomeadas. As alternativas e
recomendações vêm do plano mestre (seções N e L) e do código atual.

## R54 — homologar o estorno externo no Asaas Sandbox

- **Situação em 19/11:** **decidida** ("GO R54" e "SIM, TUDO"). Checkout pago e conciliado; os estornos de R$ 4,00 e de
  R$ 6,00 estão autorizados e aguardam o prazo do Asaas para estorno parcial de cartão (duas recusas: "só pode ser
  estornada parcialmente no próximo dia"). Próxima tentativa única a partir de 19/11, 09h00 de Brasília
  (`homologacao-r54-sandbox.md`). Nada a decidir.

## Outbox — lote do cron no pico (P14.4, 19/11)

- **Questão:** aumentar `OUTBOX_BATCH_SIZE` em produção de 50 (padrão) para 200?
- **Benchmark controlado de 20/11 (runner do GitHub, 25 rodadas, integridade conferida em todas):** atraso máximo no pico 8 / 3 / 2 / 1 min com lote 50 / 100 / 150 / 200; acima do pico (100/min) 12 / 6 / 4 / 3 min; tick de 1 a 14 s conforme a latência; conexões e locks iguais. Pane de consumidor (eventos de 6 s): o tick passa de 60 s já com o lote 50 (60,3 s) e mais com 200 (73,2 s). Proposta completa, riscos, monitoramento, critérios de interrupção e retorno em `outbox-capacidade.md`.
- **Fato medido:** cada conclusão de atendimento publica 3 eventos que vão para o cron (chegada, início, conclusão:
  prontuário rascunho e recebível do particular), além do evento da guia, que é processado na hora. Com 50 eventos por
  minuto, um pico de 50 conclusões por minuto durante 3 minutos deixa 6 minutos de fila e o pior atraso chega a 7 minutos
  (meta da H.2: 5). Com 200, pior atraso de 1 minuto e tick de no máximo 2,2 s (prova em Postgres descartável,
  `evidence/tiss-p14-4-desempenho-2026-11-19/`). A fila é de todas as clínicas: num dia cheio o efeito soma.
- **Alternativas:** (a) 200 na variável de ambiente de produção (o código já lê, sem deploy; teto do código 500);
  (b) manter 50 e aceitar o atraso em pico; (c) processar também os eventos de chegada/início/conclusão logo depois da
  resposta, como a guia (mudança de código, fora do módulo Convênios).
- **Recomendação:** (a) `OUTBOX_BATCH_SIZE=200`, com a operação controlada do §5 de `outbox-capacidade.md`. À parte, para decisão com o dono da plataforma e o #53: orçamento de tempo dentro do tick (o risco de passar de 60 s com consumidor lento já existe hoje).
- **Depois:** você (ou o agente, com GO específico para a configuração de produção) define a variável; o agente confere
  nas métricas do `worker.tick` que a fila não acumula. **O agente não altera configuração de produção sem esse GO.**

## P12.6 — alerta do provedor disparando em teste

- **Questão:** quem cria a regra de alerta no Sentry (ou entrega um acesso com permissão de alertas, fora do chat)?
- **Alternativas:** (a) você cria pela tela do Sentry, em 5 minutos, com os dados abaixo; (b) um token com escopo de
  alertas guardado como segredo do repositório, para o agente criar e provar; (c) outro provedor (Better Stack), que
  exigiria conta nova.
- **Recomendação:** (a). Regra de issue alert no projeto do app, ambiente `preview`, filtro pela tag `flow` começando
  por `cron.insurance-maintenance`, ação: e-mail para o endereço de teste que você escolher.
- **Depois:** o agente provoca uma falha sintética controlada da manutenção no Preview, confere o evento, a regra e a
  entrega, e marca a P12.6.

## B5 — operadora e clínica piloto

- **Questão:** qual operadora e qual clínica homologam a Consulta e a SP/SADT?
- **Alternativas:** operadora regional com portal de homologação; operadora em que a clínica piloto já fatura.
- **Recomendação:** a operadora em que a clínica piloto já fatura (há volume real para comparar) — escolha sua.
- **Destrava:** P2.5 (checklist C1–C10), P6.5 (homologação do conector), P13.6, P15.3, P15.4.

## B6 — retenção legal (P12.3, P12.13)

- **Questão:** prazos de guarda de guias, carteirinhas e autorizações; descarte; texto ao titular.
- **Alternativas:** seguir a recomendação jurídica formal; adotar o prazo mais longo conhecido como conservador.
- **Recomendação:** orientação jurídica formal (o técnico já anonimiza o paciente e preserva a guia).
- **Depois:** prazos no runbook de retenção, rotina de descarte e o texto ao titular; testes LGPD.

## B10 — perfil de segurança TISS da ANS (S1–S9)

| Decisão | Questão | Recomendação do plano | Destrava |
| --- | --- | --- | --- |
| S1 | perfil só para clínicas com convênio ou para toda a base | só com convênio (separação segura já investigada) | P12.8, P12.9 |
| S2 | inatividade de 10 min no servidor e no cliente (R83) | aprovar o desenho de N.3 | P12.9 |
| S3 | símbolo obrigatório na senha (R67) | só no perfil `tiss` | P12.9 |
| S4 | expiração de 90 dias e histórico de 10 senhas (R81, R82) | aprovar, com 90 dias de carência | P12.9 |
| S5 | auditoria imutável 180 dias e retenção de tentativas 90 → 180 dias (R84, R85) | aprovar (global; muda o runbook) | P12.10 |
| S6 | CPF do usuário e inativar em vez de excluir (R41) | só no perfil `tiss` | P12.8 |
| S7 | rodapé com fornecedor e versão (R36) | aprovar, com a UI | P12.11 |
| S8 | último acesso (R42), sem memorização no login (R43), limite fechado na queda do Upstash (R69) | aprovar R42; decidir R43 e R69 | P12.12 |
| S9 | consulta formal à ANS sobre o alcance (N.1) e o R77 | recomendada antes de publicar | P12.8 |

- **Depois:** cada aprovação liga a política já preparada em `security-profile` e ganha E2E (N.9).

## B7 — Validador TISS para Windows (P13.5)

- **Questão:** como obter a terceira camada de validação sem instalar o programa na máquina principal.
- **Alternativas:** licença comercial; VM isolada sem dado real; autorização expressa do fornecedor.
- **Recomendação:** VM isolada só com o corpus sintético. Hoje o substituto é o motor XSD da Microsoft (38/38).

## P4.7 (parte b) — importação de agenda com convênio

- **Questão:** a importação de atendimentos HISTÓRICOS deve aceitar convênio? Se sim, ela registra só a forma de
  atendimento e a cobertura, ou também gera guia?
- **Alternativas:** (a) histórico entra como particular (hoje), fora do faturamento TISS; (b) registra forma e cobertura
  sem gerar guia (histórico faturado fora do Qoro); (c) gera guia como uma conclusão nova.
- **Recomendação:** (b). Gerar guia para atendimento antigo arrisca faturar duas vezes o que a clínica já cobrou.
- **Depois:** coluna de convênio no arquivo, cobertura por linha sem guia, prova de banco e E2E da importação.

## P15.6 — revisão financeira com você

- **Questão:** conferir comigo, numa sessão, a conciliação ponta a ponta (faturado, recebido, glosado, pendente, repasse,
  coparticipação) sobre a clínica sintética.
- **Evidência pronta:** relatório por operadora (P9.10) com as somas conferidas contra o livro; conciliação e repasse
  validados no Preview.
- **Depois:** registro da aprovação (ou dos ajustes pedidos) no plano.

## P15.8 — aprovação final e piloto

- **Questão:** aprovação de release e ativação por flag numa clínica piloto (contrato da P1.13 pronto).
- **Pré-condições:** B5, B6, B10 (no mínimo S1–S4), P15.6, P12.6, integração #53 → #56 → #55 e o painel do #57.
- **Depois:** gates T2 (pré-voo de produção só leitura), T3 e T4, cada um com autorização própria.

# Cadastro por código — publicação e recuperação de leads

**Executado em 04/11/2026, com autorização expressa para a 0134 e o PR #47 `c842bea6`.**
Publicado em [app.qoro.dev](https://app.qoro.dev), cadastro reaberto. Merge
`7b9a7805baef3b1e5c3b527dfc3f4f77e7fb2d54`; deployment final
`dpl_HHYSPzhr2dKhQULK1T5Hn5yCLvgt`. A árvore corresponde à combinação autorizada do candidato
e do hotfix #48, sem implementação adicional ou resolução manual de conflito.

[Recibo sanitizado](evidencias/publicacao-funil-codigo-20261104.json): identificadores, estados e
limites, sem destinatários, nomes, senha, código ativo, token de recuperação ou credencial.

## Execução e integridade

1. `SIGNUP_ENABLED=false` somente em Production, por novo deployment. Página fechada e POST de
   criação HTTP 503 conferidos. Login existente disponível; a variável sozinha não foi tratada
   como fechamento efetivo.
2. Backup local cifrado de `public` e `auth`, sem SQL em claro:
   `backups/prod-pre-migration-2026-11-04T13-12-37.sql.gpg`, 673.861 bytes, SHA-256
   `ae8bbb99cd1cb8ee8e0796486b3a1566f3597f918bd72cbd309714f3aec62f0b`.
   Pipeline e decriptação de conferência passaram; o restore integral deste artifact novo não
   foi repetido. Recuperações anteriores são evidência separada.
3. Aplicada **somente a 0134**: histórico 134 → 135, linhas anteriores intactas, zero constraints
   public não validadas. Planos, preços, assinaturas e perfis iguais na comparação imediatamente
   antes/depois. Ledgers com ENABLE/FORCE RLS e SELECT negado a anon/authenticated. Nenhum hash
   histórico foi reescrito nem migration antiga reaplicada.
4. PR #47 publicado ainda fechado: oito verificações públicas passaram. Ponte com CSP por hashes,
   `no-referrer` e `no-store`; webhook sem assinatura HTTP 401.
5. Webhook Resend permanente configurado em `/api/webhooks/resend`, com segredo novo somente em
   Production. Chave e remetente existentes da aplicação preservados. Credencial administrativa
   temporária da recuperação, separada e protegida por DPAPI/ACL, revogada após as entregas.
   Nenhum segredo DEV foi instalado no runtime Production.
6. Dados preservados do quarto lead restaurados com a operação testada. Mesma identidade,
   consentimento e prazo original; sem redefinir senha ou reiniciar trial. Guardas contra convite,
   bloqueio, identidade diferente, progresso novo e billing mantidos.
7. `SIGNUP_ENABLED=true` por outro deployment; reabertura conferida às **10h33 de Brasília**.
   Só após o teste integrado abaixo foram reavaliados e enviados os e-mails autorizados.

## Provas efetivas

| Prova | Resultado e limite |
| --- | --- |
| CI do merge, execução `41836525511` | **6.077/6.077**, 570 arquivos; tipos, lint, cobertura, build, arquitetura, isolamento, bundle e HTTP aprovados. |
| E2E público da CI | **8 PASS, 2 SKIP** Turnstile sem chaves no build isolado. Não se forçou novo desafio real nesta janela; configuração não alterada, prova real anterior separada. |
| Cadastro em Production | Código errado recusado; correto confirmou Auth, manteve a senha inicial e levou ao plano. Auth e SQL reais, endereço sintético controlado Resend. |
| Continuidade | Plano salvo sobreviveu a F5; trial exatamente 14 dias desde Auth; mobile sem corte lateral; nenhuma senha em URL. |
| Recuperação em outro aparelho | E-mail/link reais da fixture: GET não consumiu, clique retomou o plano sem senha nova. Hash preservado e senha original autenticou no Auth. |
| Entrega | Evento legítimo assinado do Resend persistiu no SQL Production. Não apenas aceite da requisição de envio. |
| Limpeza | Sessões sintéticas revogadas; Auth/draft/grant próprios removidos. Nenhum Checkout, pagamento, clínica ou paciente criado. |
| Logs do cadastro/webhook | Doze registros informativos, nenhum warning/error/fatal no intervalo consultado, incluindo níveis no JSON da aplicação. Sem mensagens brutas persistidas. Não é auditoria de todo o Qoro. |

Não houve novo pagamento real ou Sandbox nesta janela. Os Checkouts Sandbox anteriores são
evidências separadas; não declarar nova prova de liquidação financeira, NF ou agendamento.
A investigação da mensagem cancelada não foi iniciada.

## Recuperação dos quatro leads

Fotografia de **04/11 às 10h40 de Brasília**, após os envios. Não consumir os links reais para
testar e não repetir automaticamente a intenção já registrada.

| Lead | Ação e estado |
| --- | --- |
| lead-01 | Enviado uma vez; **delivered** no provedor e ledger assinado. E-mail ainda não confirmado; precisa provar o endereço, definir a primeira senha e preencher somente os dados faltantes. |
| lead-02 | **Não enviado:** rejeição permanente original, sem contato/endereço alternativo legítimo verificado. Não foi classificado como conta falsa. |
| lead-03 | Enviado uma vez; **delivered** no provedor e ledger assinado. Mesmo caminho central do lead-01, preservando a identidade existente. |
| lead-04 | Lembrete enviado uma vez após restauração protegida; **delivered** no provedor e ledger assinado. E-mail confirmado, senha pronta, plano ainda pendente, sem profile de clínica. |

Links individuais válidos por 24 horas, até **05/11 por volta de 10h38 de Brasília**. Nenhum foi
aberto ou consumido pela engenharia. Os três grants estavam `sent`. `delivered` é aceite pelo
servidor destinatário; não comprova leitura, caixa principal, contratação ou conversão.

Os dados antigos dos leads 01/03 já tinham sido apagados. A mensagem usa texto honesto sobre
informações faltantes; não promete recuperar o que não existe. O quarto recebeu o texto de
conclusão, com senha e nascimento Auth preservados. Nenhum trial foi ampliado.

## Continuidade

- Cadastro aberto; não repetir a 0134 nem os três envios desta janela.
- Campanha não alterada pela engenharia. A conclusão pelos destinatários é resultado futuro.
- Webhook Production habilitado; chave temporária revogada. Os links dependem do runtime e
  grants publicados, não dessa chave temporária.
- Em incidente, fechar a entrada por novo deployment e preservar o schema aditivo. Não executar
  DROP, restaurar o banco inteiro ou voltar automaticamente ao janitor antigo, que desconhece
  a retenção nova.
- Sem alteração de preços, contratos legados, desconto vitalício, Meta/Asaas, pacientes ou agenda.
  O diagnóstico solicitado e depois adiado permanece fora deste escopo.

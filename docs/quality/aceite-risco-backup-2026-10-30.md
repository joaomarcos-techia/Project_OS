# Aceite do founder — backup independente adiado

Data: **30/10/2026**, fuso de referência America/Sao_Paulo. Responsável pelo aceite: founder, nesta conversa de engenharia.

Declaração recebida, após ser informado de que o piloto não constituiu cópia real independente e de que faltava a senha custodiada:

> assumo o risco de backup, nao quero fazer mais nada disso, vamos colocar o sistema me go

## Decisão operacional

O founder aceita prosseguir na preparação do lançamento **sem concluir agora a cópia independente real no B2 e a custódia adicional no Bitwarden**. Não pedir novamente a variável/senha, nova chave ou repetição do piloto como pré-requisito desta fase. A rotina opt-in preparada fica preservada, sem execução automática e sem segredos configurados pelo agente.

A engenharia registra **RISCO ACEITO**, não PASS do backup independente. O histórico continua: restauração local de SQL `public`/`auth` e migrations aprovada; Storage local 42/42 e Auth nos escopos documentados; piloto B2 sintético externo aprovado e removido; cópias locais protegidas e backups físicos Supabase observados anteriormente. Nenhum arquivo real foi transferido ao B2 e nenhuma nota/senha de recuperação foi criada pela automação no Bitwarden.

## Limitações que permanecem visíveis

- Os arquivos/chaves/configurações locais dependem do computador/perfil Windows; não existe prova de custódia real independente fora dele.
- O backup físico do Supabase não substitui cópia dos conteúdos binários Storage ou de todas as configurações/segredos gerenciados.
- Sem cópia/chave independente, perda da máquina/perfil ou falha conjunta pode impedir recuperar Storage/configurações locais, mesmo com banco restaurável.
- Não foi comprovada rotina independente recorrente, alerta entregue, retenção imutável ou RTO completo. Não há garantia de perda zero nem SLA de recuperação decorrente deste aceite.
- O aceite anterior do intervalo entre backups diários e a decisão de não contratar PITR permanecem, sem nova compra ou alteração de plano.

O aceite trata a pendência de backup como **exceção de lançamento assumida pelo responsável**, não como capacidade técnica adquirida. Não autoriza apagar backups, relaxar segurança de acesso, modificar contratos, enviar dados médicos a outro destino ou ignorar falhas críticas da aplicação. Não dispensa as verificações possíveis e o backup local pré-migration previstos na janela, usando a senha GPG já existente, sem exigir uma nova senha do founder.

## Efeito sobre o GO

O requisito de cópia independente/cofre não mantém sozinho o NO-GO desta fase. Permanecem separados: checks do SHA candidato, validação efetiva de Turnstile no domínio de produção, configuração operacional Gemini e preflight/migrations/smoke da janela. Solicitar GO não converte testes ausentes em PASS e este registro, isoladamente, não executa nem registra merge/deploy/migration de produção.

Documentos: [relatório](fechamento-definitivo-oferta-2026-10-30.md), [rollout](../runbooks/publicacao-coordenada-oferta-2026-10.md), [rotina opcional preservada](../runbooks/backup-real-b2-bitwarden.md).

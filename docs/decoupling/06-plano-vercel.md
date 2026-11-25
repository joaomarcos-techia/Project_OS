# Plano Vercel: host, scheduler e landing

Fontes [E01, E17–E25](../architecture/01-contexto-atual.md). A hipótese de execução fora da Vercel é tecnicamente plausível; ainda não foi ensaiada. A documentação oficial do [Next 15 para self-hosting](https://nextjs.org/docs/15/app/guides/self-hosting) contempla Node, imagens, streaming e configuração de cache/ambiente. Isso não homologa automaticamente este aplicativo ou outro runtime.

## App

1. **H01:** modelo de ambiente/deployment e origens explícitas; manter adapter Vercel compatível. Remover dependência da detecção de `.vercel.app` para o host de teste aprovado, preservando proteção CSRF e Preview→prod. Recriar allowlists Auth, Turnstile, Meta e callbacks em Sandbox no ensaio autorizado.
2. **H02:** construir imagem Linux Node 22 com pnpm/lockfile, runtime Next 15.5.28, non-root, filesystem temporário controlado, health/readiness, shutdown e recursos. `output: standalone` é opção a validar, ainda não configurada. PDF usa renderer/WASM externalizado; carregar dependências reais, fonts e arquivos necessários. Não assumir export estático do app.
3. **H03:** scheduler externo replica exatamente as 21 linhas do [manifesto inventariado](inventario-codigo.json), em UTC, com deadline/retry e controle de sobreposição. Manter outbox minutely, reconciliações e jobs destrutivos. Endpoint usa Bearer; `OUTBOX_CRON_ALLOW_NON_VERCEL` só afeta log. Segredo destrutivo separado precisa ser enviado pelo executor correspondente se estiver configurado.
4. **H04:** servir landing estática em domínio alternativo aprovado com diretórios/index, 404 real, redirects e headers de vercel.json. Adaptar lib/comecar.ts por configuração segura: Preview atual aceita só padrão Vercel e aponta para um Preview fixo. Domínio público qoro.dev pode ser preservado durante mudança de host.

## Compatibilidade que precisa de prova

| Recurso                                        | Situação no código                                   | Validação alvo                                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| SSR / Server Components / Actions / middleware | Next, runtime Node em rotas sensíveis                | Login, POST nativo/hidratação, cookies e streaming em proxy HTTPS                                                         |
| Cache / revalidate / imagens                   | APIs de framework e configuração Next                | Invalidação entre réplicas, ausência de cache de dados tenant, cache-control e image optimizer                            |
| Actions em múltiplas réplicas                  | Código não define estratégia própria de coordenação  | Mesma release/build e chave de Actions conforme suporte da versão; teste ação renderizada antes do deploy em backend novo |
| Sessão e proxy                                 | Cookies hardened e origem server-side                | Host/proto repassados somente de proxy confiável; Secure/HttpOnly/SameSite e logout                                       |
| Webhooks                                       | Body cap 1 MB e maxDuration=30 em rotas Asaas        | Proxy mantém corpo/headers, timeout útil, sem SSO/challenge público e sem POST redirects                                  |
| Upload de logo / PDF                           | Limite de action compatível Vercel; renderer externo | Mesmo limite do produto, rejeição excedente, bytes e memória medidos                                                      |
| Banco                                          | 6+8+2 conexões por processo como teto configurado    | Orçamento global = réplicas × pools + jobs/admin/monitoring, não só subir réplicas                                        |
| Rate limit                                     | Upstash externo                                      | Limite compartilhado entre réplicas; não substituir por cache local                                                       |
| Secrets                                        | env ou GCP, import lazy                              | Presença de versão antiga e decrypt sintético; nenhuma chave dentro da imagem                                             |
| Observabilidade                                | stdout JSON/Sentry/health                            | Coleta fora da Vercel, request ID, heartbeat, alertas realmente recebidos                                                 |
| Preview privado                                | Vercel SSO/bypass                                    | Solução de acesso do novo host; endpoint público só onde contrato exige, sem vazar bypass em callback                     |
| DNS / TLS / headers                            | Infra externa + Next/vercel.json                     | SNI/TLS, HSTS, CSP, redirects, .well-known se usado e propagação                                                          |

## Landing: alcance menor

`npm run build` inclui prerender e verificadores de links, conversão, segurança e conteúdo. `scripts/serve.mjs` é referência local de resolução de arquivos, não servidor de produção homologado. Substituir apenas hospedagem estática; Vercel Analytics e `track()` precisam substituto ou perda de telemetria explicitamente aprovada. Preservar atribuição Ads e não alterar trigger de conversão como efeito colateral desta migração.

`.env.example` da landing informa ausência de variáveis funcionais; URLs/IDs públicos são constantes. Isso é seguro contra open redirect, mas dificulta Preview em host novo. Propor configuração de build validada com destinos exatos separados por ambiente; nenhuma credencial no Vite client. Não copiar env do app para landing.

## Ensaio H / X01

Build imutável → iniciar app e landing em host alternativo de teste → apontar só backend DEV dedicado/fixtures → validar identidade do backend antes de cada mutação → testar UI/API/headers/cron/arquivos → medir recursos e pool → rollback de release sem writers concorrentes. Desabilitar efeitos externos por configuração/test adapters em staging; um scheduler que acidentalmente use DEV compartilhado pode enviar mensagens reais de teste ou executar retenção.

**Gate G7:** app e landing executam fora da Vercel com 21 schedules representados/testados, callbacks corretos, segurança e falhas/retorno exercitados. `next start` retornando home não basta. Migração de produção e alteração de CI/build precisam aprovação concreta; esta rodada só deixa o plano.

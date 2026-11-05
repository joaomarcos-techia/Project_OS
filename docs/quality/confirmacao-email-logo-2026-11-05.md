# Logo no e-mail de confirmação — 05/11/2026

## Escopo

Branch `codex/email-confirmation-logo-20261105`, base `af677c00`.
Decisão expressa: manter Resend e mudar somente o cabeçalho do e-mail de código.
Não foi feita migração para o envio nativo do Supabase.

`src/lib/email/templates/signup-code.ts` substitui o nome escrito pela logo
vetorial que já existe em `src/components/shared/logo.tsx`. O SVG é incluído
como imagem em um elemento `picture`; o `img` mantém a imagem pública já usada
nos demais templates como alternativa para leitores que descartam a fonte SVG.
Não há download de logo em tempo de renderização no servidor.

O teste compara os seis paths com o componente existente. Não foram alterados
o transporte, assunto, texto simples, instruções, código de oito dígitos, prazo,
reenvio ou confirmação. O diff do HTML, normalizado apenas pelo bloco da logo,
coincidiu integralmente com a versão-base.

## Validação

| Gate | Resultado |
| --- | --- |
| Templates de e-mail e entrega da confirmação | PASS — 104/104, 8 arquivos |
| Novos testes da logo/código | PASS — 8/8, incluídos no total acima |
| Render desktop/mobile | PASS — 6/6, larguras 600, 375 e 320 px, com SVG e com a fonte SVG removida |
| Paridade da logo e preservação de conteúdo | PASS |
| ESLint focado | PASS |
| Prettier focado | PASS |
| Build Next isolado | PASS — exit 0, compilação, lint, tipos e 19 páginas estáticas |
| TypeScript | PASS — `tsc --noEmit`, exit 0 |

As inspeções visuais usaram o template real com código sintético `12345678`.
A logo carregou nos dois caminhos e não houve overflow. Resultado em
`dist/quality/email-logo-browser.json`; HTML de prévia em
`dist/quality/confirmacao-qoro-logo.html`.

A simulação de fonte SVG removida confirma o fallback no Chromium; não equivale
a envio e renderização reais em Gmail, Outlook ou Apple Mail. Não foi enviado
e-mail externo nesta tarefa.

## Segurança e publicação

Nenhuma variável real foi lida para o build; foi utilizado o runner existente
`scripts/security/local-build.ts`, com cópia isolada e credenciais sintéticas.
Não houve migration, mudança de conta ou assinatura, envio a lead ou alteração
de Produção. A publicação desta correção ainda não foi executada.

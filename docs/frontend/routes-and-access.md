# Frontend, rotas e acesso

## Status

Canonical — organização da UI e gates de acesso.

## Source of Truth

`src/app`, layouts de `(app)`/`(admin)`, `src/components` e guards server-side.

## Entrada e autenticação

- `/` redireciona para o login; não há landing pública no app.
- `/login`, `/login/mfa`, `/auth/confirm`, `/reset-password`, `/convite`, `/join/[token]` e `/logout` formam a jornada pública/autenticada.
- Middleware verifica presença de cookie e adiciona request id. Ele não valida usuário, role ou permission.
- Layouts/pages/actions fazem autenticação real no servidor. Super-admin exige AAL2.

## Shell da clínica

| Área | Rotas principais | Permission base |
| --- | --- | --- |
| Dashboard | `/dashboard` | sessão tenant; dados financeiros são filtrados por permission |
| Agenda | `/agenda`, ausências, importação, waitlist | `view:agenda`, `edit:agenda`, `import:agenda`, `manage:availability` |
| Consultório | `/consultorio` | `view:consultorio` |
| Pacientes | `/pacientes`, detalhe e prontuários | `view/create/edit/delete/export:patient` e prontuário |
| Documentos | `/documentos`, PDFs, modelos de prescrição | permissions de prontuário/prescrição |
| Financeiro | `/financeiro`, fornecedores, `/caixa` | `view/manage:financial`, `operate:caixa`, `refund:financial` |
| Conversas | `/conversas`, `/conversas/[id]` | `view:conversations`; resposta/handoff exige `manage:conversations` |
| Relatórios | `/relatorios` e PDF | `view:financial` |
| Equipe | `/equipe` | `manage:employees`; overrides exigem `manage:permissions` |
| Configurações | perfil, horários, procedimentos, recursos, WhatsApp, agente, LGPD, assinatura, auditoria e sugestões | permission específica por módulo |

O menu não é a fronteira de autorização: o servidor sempre repete o guard.

## Shell de plataforma

Rotas `/admin` cobrem clínicas, billing, feedbacks, conversas de IA, métricas, auditoria, configuração e saúde. `guardAdminAccess` exige `super_admin` + AAL2 e responde como não encontrado para outros usuários. Escritas cross-tenant são limitadas a serviços/actions explícitos e auditados.

Super-admin não recebe `clinic_id`. Para operar a UI de uma clínica precisa iniciar sessão de impersonação; banner e trilha de auditoria identificam o contexto.

## Estado e componentes

- Server Components carregam dados; Client Components cuidam de interação local.
- Server Actions invalidam os paths afetados depois da transação.
- Componentes de UI vivem em `src/components/ui`; estilos globais/tokens em `src/app/globals.css`.
- Formulários reutilizam Zod/types do domínio e exibem mensagens sanitizadas.

## Feedback

Sugestão de tenant é privada ao autor por `userId`; outro membro da mesma clínica não pode lê-la. Super-admin tem visão global e exportação. Attachments não fazem parte da implementação atual.

## Failure modes

- Esconder botão não autoriza action.
- Cookie presente não significa sessão válida; o servidor relê o profile.
- Claims antigas falham quando `claims_version` diverge.
- Clínica inadimplente continua lendo/login, mas o chokepoint bloqueia mutations não excepcionadas.

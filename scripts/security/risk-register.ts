/**
 * Registro de risco do endurecimento local (Fase 3, item 4).
 *
 * Existe por um motivo só: aceite sem prazo vira política do sistema por dez
 * anos. Toda linha aqui é um risco que o trabalho local NÃO fechou. O gate
 * (`src/lib/security/risk-register.test.ts`) recusa entrada sem prazo e recusa
 * prazo vencido — CI vermelho é o lembrete que ninguém desliga por engano.
 *
 * `status` é literal:
 *   - 'pendente': ninguém aceitou nada. Precisa de `revisarEm`. Vencido = o
 *     humano tem de reabrir o item, não renovar a data sem olhar.
 *   - 'aceito': alguém com nome assumiu o risco. Precisa de `dono` real (nunca
 *     'pendente do humano') e de `validoAte`. Vencido = o aceite acabou.
 *
 * Não preencher aceite em nome de ninguém. Enquanto a linha diz 'pendente', o
 * relatório não pode dizer que o risco foi aceito.
 */
export interface RiskEntry {
  id: string;
  /** Peso do item no pedido de auditoria, para ordenar a fila do humano. */
  peso: number;
  risco: string;
  status: 'pendente' | 'aceito';
  /** Quem responde. 'pendente do humano' só é válido com status 'pendente'. */
  dono: string;
  /** ISO (YYYY-MM-DD) de quando a linha foi escrita. */
  registradoEm: string;
  /** ISO. Obrigatório em 'pendente': data de reabrir o assunto. */
  revisarEm?: string;
  /** ISO. Obrigatório em 'aceito': data em que o aceite morre. */
  validoAte?: string;
  /** Comando/arquivo que fecha o item, ou o console em que ele vive. */
  evidencia: string;
}

/** Data de revisão padrão desta rodada: ~90 dias após 2026-09-10. */
const REVISAR_EM = '2026-12-09';
const REGISTRADO_EM = '2026-09-10';

export const RISK_REGISTER: RiskEntry[] = [
  {
    id: 'webhook-replay-persistido',
    peso: 9.5,
    risco:
      'Idempotência e dedup dos webhooks foram provadas em teste unitário com dependência substituída. A constraint UNIQUE e o comportamento transacional no Postgres real continuam sem prova local.',
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: REGISTRADO_EM,
    revisarEm: REVISAR_EM,
    evidencia:
      'Banco local com schema completo; reenviar o mesmo id assinado e conferir linhas/outbox antes e depois.',
  },
  {
    id: 'idor-http-dois-usuarios',
    peso: 8,
    risco:
      'Isolamento entre clínicas foi provado no caminho SQL (RLS + withTenant, Postgres temporário). Falta o exercício HTTP com dois usuários autenticados sobre todos os recursos, incluindo export em massa.',
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: REGISTRADO_EM,
    revisarEm: REVISAR_EM,
    evidencia:
      'pnpm security:tenant cobre o SQL; adaptar os E2E cross-tenant para dois usuários locais cobre o resto.',
  },
  {
    id: 'ia-gemini-adversarial',
    peso: 9,
    risco:
      'Os 15 vetores adversariais rodam contra registry, schemas e políticas reais — que são determinísticos. A resposta do modelo real (Gemini) não foi medida.',
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: REGISTRADO_EM,
    revisarEm: REVISAR_EM,
    evidencia:
      'scripts/ai-adversarial-check.ts, com destino e credencial revisados pelo humano antes de executar.',
  },
  {
    id: 'csrf-sessao-valida',
    peso: 7,
    risco:
      'A rejeição nativa de origem forjada foi provada sem sessão. Com cookie Supabase válido, e com double-submit nas ações de dinheiro, continua sem execução local.',
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: REGISTRADO_EM,
    revisarEm: REVISAR_EM,
    evidencia:
      'pnpm exec tsx scripts/security/authenticated-csrf.ts <cookie-file-local> http://localhost:3217, contra Supabase Auth local.',
  },
  {
    id: 'inventario-acesso-rotacao',
    peso: 6.5,
    risco:
      'Chaves de serviço (Supabase, Meta, Asaas, Gemini, Redis, Sentry, CRON, HMAC/crypto) sem dono, data de emissão e validade registrados. Contratado que sai continua com token vivo até alguém lembrar.',
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: REGISTRADO_EM,
    revisarEm: REVISAR_EM,
    evidencia: 'psql <URL-LOCAL> -v ON_ERROR_STOP=1 -f scripts/security/access-inventory.sql',
  },
  {
    id: 'sentry-regiao-retencao',
    peso: 6,
    risco:
      'O scrub de PII foi corrigido e testado no código. Região de ingestão (EUA), retenção, tags e breadcrumbs são configuração de projeto e não foram conferidas.',
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: REGISTRADO_EM,
    revisarEm: REVISAR_EM,
    evidencia: 'Console do Sentry: settings do projeto qoro (ingestão, região, retention).',
  },
  {
    id: 'lgpd-registro-tratamento',
    peso: 5,
    risco:
      'A trilha de leitura de prontuário passou a existir (clinical.prontuario.viewed). O registro de tratamento, a base legal declarada e a rotina de descarte no prazo continuam sem documento aceito pelo controlador.',
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: REGISTRADO_EM,
    revisarEm: REVISAR_EM,
    evidencia:
      'docs/security/ia-privacidade.md descreve o pendente; o documento do controlador não é código.',
  },
  {
    id: 'csp-nonce-inline-script',
    peso: 3,
    risco:
      "A CSP é bloqueante e fecha connect-src/img-src por origem nomeada, mas script-src ainda mantém 'unsafe-inline'. O middleware já cobre as páginas públicas e de autenticação; o residual é gerar uma nonce por resposta HTML, propagá-la pelo request até o <script> de tema em app/layout.tsx e então remover 'unsafe-inline' sem quebrar hidratação ou cache.",
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: REGISTRADO_EM,
    revisarEm: REVISAR_EM,
    evidencia:
      "Repo tem um dangerouslySetInnerHTML (script constante de tema em app/layout.tsx) e nenhum sink de HTML de usuário conhecido. O matcher atual já alcança /login, /convite, /reset-password, /auth/* e /join; falta implementar e testar a nonce antes de retirar 'unsafe-inline'.",
  },
  {
    id: 'ia-teto-custo-corrida',
    peso: 2,
    risco:
      'O teto horário por clínica passou a existir e a ser aplicado antes do provider. Residual: a leitura acontece antes de o turno gravar o próprio custo, então turnos paralelos podem ultrapassar o teto em até OUTBOX_PARALLELISM x custo-de-um-turno (ordem de centavos) antes de o próximo turno bloquear.',
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: REGISTRADO_EM,
    revisarEm: REVISAR_EM,
    evidencia:
      'Fechar exigiria reserva transacional antes da chamada ao LLM, que roda FORA de transação por decisão do R2/ADR-022.',
  },
  {
    id: 'runtime-role-sem-bypassrls',
    peso: 8,
    risco:
      'MEDIDO (contrafactual em Postgres real, 2026-09-11): com o papel do pool (BYPASSRLS) a MESMA policy deixa ler a linha de outra clínica — quem isola é o SET LOCAL ROLE dentro de withTenant. O withTenant agora VERIFICA o papel e aborta se divergir, mas a defesa continua em uma camada: o papel dedicado sem BYPASSRLS (DATABASE_URL_RUNTIME) existe no código e não está provisionado no Postgres.',
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: '2026-09-11',
    revisarEm: REVISAR_EM,
    evidencia:
      'pnpm security:tenant imprime o contrafactual. Provisionar o papel no Supabase e apontar DATABASE_URL_RUNTIME fecha a segunda camada.',
  },
  {
    id: 'auditoria-sem-hash-chain',
    peso: 6,
    risco:
      'audit_events já é append-only para o app (só policies INSERT/SELECT) e NÃO tem FK com ON DELETE CASCADE. Residual: service_role mantém UPDATE/DELETE (0010_c4_hardening.sql:72), e não há encadeamento por hash nem cópia imutável externa — quem controla a plataforma pode reescrever a trilha sem deixar marca.',
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: '2026-09-11',
    revisarEm: REVISAR_EM,
    evidencia:
      'Encadear prev_hash no logAudit e espelhar para storage WORM; revogar UPDATE/DELETE exige revisar o que hoje depende de service_role na tabela.',
  },
  {
    id: 'ci-supply-chain',
    peso: 6,
    risco:
      'Workflows de CI não foram endurecidos: falta `permissions:` mínimo por job, pin de actions por SHA, `--ignore-scripts` com allowlist e proibição de `pull_request_target` com segredo. A cadeia PR -> segredo de deploy -> bundle adulterado atinge todos os tenants de uma vez.',
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: '2026-09-11',
    revisarEm: REVISAR_EM,
    evidencia: '.github/workflows/ci.yml — revisar permissions, pin e scripts de instalação.',
  },
  {
    id: 'deployment-protection-vercel',
    peso: 6,
    risco:
      'A coerência de ambiente passou a ser verificada no parse de env (projeto de auth = projeto do banco; preview não declara prod). Mas de dentro do deployment não dá para saber se a DATABASE_URL deste preview é a mesma de produção quando ambas são refs gerenciados distintos. Preview é público por padrão na Vercel.',
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: '2026-09-11',
    revisarEm: REVISAR_EM,
    evidencia:
      'Painel da Vercel: ativar Deployment Protection e segregar env por ambiente. src/lib/env-coherence.ts cobre o que é detectável por código.',
  },
  {
    id: 'dmarc-inerte',
    peso: 3,
    risco:
      'MEDIDO em 2026-09-11 por consulta DNS pública: `_dmarc.qoro.dev` = "v=DMARC1; p=none;". A política não rejeita nada E não tem `rua=`, então ninguém recebe os relatórios agregados. O registro existe e não faz absolutamente nada: spoofing de @qoro.dev para paciente ou clínica passa, e não há telemetria para perceber.',
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: '2026-09-11',
    revisarEm: REVISAR_EM,
    evidencia:
      'nslookup -type=TXT _dmarc.qoro.dev 8.8.8.8. Corrigir no painel de DNS (Hostinger, ns1/ns2.dns-parking.com): acrescentar rua=, observar, e só então subir para p=quarantine e p=reject.',
  },
  {
    id: 'spf-apex-ausente',
    peso: 2,
    risco:
      'MEDIDO em 2026-09-11: `send.qoro.dev` tem SPF ("v=spf1 include:amazonses.com ~all") e o DKIM do Resend está publicado em `resend._domainkey.qoro.dev`, mas o APEX `qoro.dev` não tem registro SPF nenhum. Envelope-from no apex fica sem política declarada.',
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: '2026-09-11',
    revisarEm: REVISAR_EM,
    evidencia:
      'nslookup -type=TXT qoro.dev 8.8.8.8 devolve só google-site-verification e hosting-site. Publicar "v=spf1 -all" no apex se ele nunca envia.',
  },
  {
    id: 'mfa-contas-operacionais',
    peso: 2,
    risco:
      'O apex qoro.dev NÃO tem MX (medido): ninguém recebe e-mail nesse domínio. Logo a recuperação de conta do time acontece em caixas de terceiros (ex.: Gmail pessoal), e o controle que importa é MFA obrigatório nas contas que administram Supabase, Vercel, Asaas, Meta e o registrador do domínio — não um registro de DNS.',
    status: 'pendente',
    dono: 'pendente do humano',
    registradoEm: '2026-09-11',
    revisarEm: REVISAR_EM,
    evidencia:
      'nslookup -type=MX qoro.dev devolve SOA, sem MX. Conferir MFA conta a conta nos consoles; não é verificável a partir do repositório.',
  },
];

export interface RiskViolation {
  id: string;
  problema: string;
}

/**
 * Aplica as regras do registro. `hoje` é injetável para que o teste prove o
 * vencimento sem depender do relógio da máquina que roda o CI.
 */
export function auditRiskRegister(
  entries: readonly RiskEntry[] = RISK_REGISTER,
  hoje: string = new Date().toISOString().slice(0, 10),
): RiskViolation[] {
  const violations: RiskViolation[] = [];
  const seen = new Set<string>();
  const isDate = (value: string | undefined): value is string =>
    !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

  for (const entry of entries) {
    const add = (problema: string) => violations.push({ id: entry.id, problema });
    if (seen.has(entry.id)) add('id duplicado no registro');
    seen.add(entry.id);
    if (!entry.risco.trim()) add('risco sem descrição');
    if (!entry.evidencia.trim()) add('sem evidência: comando, arquivo ou console que fecha o item');
    if (!isDate(entry.registradoEm)) add('registradoEm ausente ou fora de YYYY-MM-DD');

    if (entry.status === 'aceito') {
      if (!entry.dono.trim() || entry.dono.includes('pendente')) {
        add("status 'aceito' exige dono com nome — aceite anônimo não é aceite");
      }
      if (!isDate(entry.validoAte)) add("status 'aceito' exige validoAte (YYYY-MM-DD)");
      else if (entry.validoAte < hoje) add(`aceite venceu em ${entry.validoAte}`);
      if (entry.revisarEm) add("status 'aceito' usa validoAte, não revisarEm");
    } else {
      if (!isDate(entry.revisarEm)) add("status 'pendente' exige revisarEm (YYYY-MM-DD)");
      else if (entry.revisarEm < hoje) {
        add(`revisão venceu em ${entry.revisarEm}: reabra o item em vez de adiar a data`);
      }
      if (entry.validoAte) add("status 'pendente' não tem aceite para expirar");
    }
  }
  return violations;
}

/**
 * Render markdown do registro. O documento é gerado, nunca editado à mão: o
 * teste compara o arquivo em disco com esta saída, então prosa divergente
 * reprova em vez de virar a versão "de verdade".
 */
export function renderRiskRegister(entries: readonly RiskEntry[] = RISK_REGISTER): string {
  const ordered = [...entries].sort((a, b) => b.peso - a.peso || a.id.localeCompare(b.id));
  return [
    '# Registro de risco — endurecimento local',
    '',
    'Gerado por `pnpm exec tsx scripts/security/risk-doc.ts`. Fonte: `scripts/security/risk-register.ts`.',
    '',
    'Cada linha é um risco que o trabalho local NÃO fechou. `pendente` significa que ninguém aceitou nada: a data é de reabrir o assunto, não de aprovação. Um aceite de verdade exige `status: aceito`, dono com nome e `validoAte` — e vence sozinho, por design.',
    '',
    '| Peso | Id | Status | Dono | Registrado | Prazo | Risco | Evidência / como fechar |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...ordered.map((entry) => {
      const prazo =
        entry.status === 'aceito'
          ? `aceite até ${entry.validoAte ?? '—'}`
          : `revisar em ${entry.revisarEm ?? '—'}`;
      return `| ${entry.peso} | \`${entry.id}\` | ${entry.status} | ${entry.dono} | ${entry.registradoEm} | ${prazo} | ${entry.risco} | ${entry.evidencia} |`;
    }),
    '',
  ].join('\n');
}

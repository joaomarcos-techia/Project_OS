/**
 * `provision-templates` — cria na WABA da clínica os templates proativos que
 * ainda não existem, e denuncia os que a Meta reclassificou.
 *
 * POR QUE existe: o provisionamento só rodava no connect do WhatsApp
 * (`connectMyClinicWhatsapp`). Trocar o nome de um template — o único caminho
 * quando a Meta reclassifica um aprovado, já que editar não muda categoria —
 * exigia desconectar e reconectar o número da clínica só para disparar a
 * criação. Aqui o mesmo `ensureMessageTemplates` é chamado direto.
 *
 * O que ele NÃO faz, de propósito:
 *   - não apaga template (a Meta bloqueia reusar o nome por ~30 dias, e o
 *     antigo costuma ser o único aprovado enquanto o novo está em análise);
 *   - não edita template existente (editar não muda categoria);
 *   - não envia mensagem.
 *
 * Os nomes vêm do ambiente (`META_TEMPLATE_*_ID`) e os corpos do catálogo em
 * `src/lib/messaging/proactive-template-catalog.ts`. Para criar com nome novo:
 * troque a env var, rode este script, espere `APPROVED` e só então publique.
 *
 *   pnpm exec tsx --conditions=react-server scripts/provision-templates.ts \
 *     --clinic <uuid> [--dry-run]
 */
import { assertDevContext } from './_env';

import { decryptForTenant } from '@/lib/crypto';
import { env } from '@/lib/env';
import { loadConnectionForHealth } from '@/lib/messaging/connection-store';
import { listProactiveTemplateDefinitions } from '@/lib/messaging/proactive-template-catalog';

import { ensureMessageTemplates } from '@/contexts/messaging/internal/meta-onboarding';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

async function main(): Promise<void> {
  assertDevContext();

  const clinicId = arg('clinic');
  const dryRun = process.argv.includes('--dry-run');
  if (!clinicId || !UUID.test(clinicId)) {
    throw new Error('uso: --clinic <uuid> [--dry-run]');
  }

  const definitions = listProactiveTemplateDefinitions();
  if (definitions.length === 0) {
    throw new Error('nenhum template configurado por ENV (META_TEMPLATE_*_ID vazias)');
  }

  const conn = await loadConnectionForHealth(clinicId);
  if (!conn) throw new Error('clínica sem conexão WhatsApp ativa');
  if (!conn.metaBusinessId) throw new Error('conexão sem meta_business_id');

  console.log(`clínica ${clinicId} · waba ${conn.metaBusinessId} · ${conn.connectionStatus}`);

  const token = await decryptForTenant(clinicId, conn.tokenCiphertext);

  if (dryRun) {
    // Auditoria: confronta o que o ambiente aponta com o que existe na WABA.
    // Nome de env var apontando para template inexistente é falha silenciosa —
    // o envio só quebra quando alguém precisa dele.
    const url = new URL(
      `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${conn.metaBusinessId}/message_templates`,
    );
    url.searchParams.set('fields', 'name,status,category,language');
    url.searchParams.set('limit', '250');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const payload = (await res.json()) as {
      data?: Array<{ name: string; status: string; category: string; language: string }>;
      error?: { message: string };
    };
    if (!res.ok || payload.error) {
      throw new Error(`Graph ${res.status}: ${payload.error?.message ?? 'erro desconhecido'}`);
    }
    const remote = new Map((payload.data ?? []).map((t) => [t.name, t]));

    console.log(`\nENV → WABA (${definitions.length} configurados):`);
    let problems = 0;
    for (const d of definitions) {
      const found = remote.get(d.name);
      let verdict: string;
      if (!found) {
        verdict = 'AUSENTE NA WABA — envio deste tipo falha';
        problems += 1;
      } else if (found.category !== d.category) {
        verdict = `categoria ${found.category} (esperada ${d.category}) — reclassificado`;
        problems += 1;
      } else if (found.status !== 'APPROVED') {
        verdict = `status ${found.status}`;
        problems += 1;
      } else {
        verdict = `${found.status}/${found.category}`;
      }
      console.log(`  ${d.kind.padEnd(18)} ${d.name.padEnd(26)} ${verdict}`);
    }

    const orphans = [...remote.keys()].filter((n) => !definitions.some((d) => d.name === n));
    if (orphans.length > 0) {
      console.log(`\nna WABA e fora do ambiente: ${orphans.join(', ')}`);
    }
    console.log(`\n--dry-run: nada foi enviado à Meta. problemas=${problems}`);
    if (problems > 0) process.exitCode = 1;
    return;
  }

  const outcomes = await ensureMessageTemplates(conn.metaBusinessId, token, definitions);

  console.log('\nresultado:');
  for (const o of outcomes) {
    const drift = o.categoryDrift
      ? `  <<< CATEGORIA DIVERGENTE: ${o.categoryDrift.expected} → ${o.categoryDrift.actual}`
      : '';
    console.log(`  ${o.status.padEnd(14)} ${o.name}${drift}`);
  }

  const created = outcomes.filter((o) => o.status === 'created');
  const failed = outcomes.filter((o) => o.status === 'failed');
  const drifted = outcomes.filter((o) => o.categoryDrift);

  console.log(
    `\ncriados=${created.length} já existiam=${outcomes.length - created.length - failed.length} falharam=${failed.length} reclassificados=${drifted.length}`,
  );

  if (created.length > 0) {
    console.log(
      '\nCriado NÃO é aprovado: a Meta revisa antes. Confira `APPROVED` e a\n' +
        'CATEGORIA antes de apontar o ambiente para o nome novo — ela pode\n' +
        'aprovar e reclassificar para MARKETING.',
    );
  }
  if (drifted.length > 0) {
    console.log(
      '\nTemplate reclassificado não se conserta por edição. Crie outro, com\n' +
        'nome novo, troque a env var e só apague o antigo depois que o novo\n' +
        'estiver aprovado e enviando.',
    );
  }
  // Falha de criação é informativa, não fatal: cada template é independente e o
  // canal segue funcionando com os que já existem.
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[provision-templates] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

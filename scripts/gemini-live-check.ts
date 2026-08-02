/**
 * Gemini LIVE check (C11) — 2 chamadas REAIS ao gemini-2.5-flash provando o
 * wire format do GeminiProvider de ponta a ponta: tool calling (functionCall),
 * re-chamada com functionResponse e usageMetadata. Custo ≈ $0.001.
 *
 * Requer GEMINI_API_KEY real no .env.local. NÃO toca o banco.
 * Uso: `pnpm ai:live-check`
 */
import './_env';

import { GeminiProvider } from '@/lib/ai/gemini';
import { computeCostUsd } from '@/lib/ai/cost';
import { listToolDeclarations } from '@/contexts/ai-agent/tools/registry';
import { buildSystemPrompt } from '@/contexts/ai-agent/prompts/system';
import type { PromptContext } from '@/contexts/ai-agent/types';

// Side-effect: registra as 15 tools de PRODUÇÃO (mesma whitelist do handler —
// as declarações enviadas ao modelo são idênticas às de produção).
import { PRODUCTION_TOOL_NAMES } from '@/contexts/ai-agent/tools/register';

const ctx: PromptContext = {
  clinic: {
    id: '00000000-0000-0000-0000-000000000000',
    nome: 'Clínica Live Check',
    endereco: 'Rua de Teste, 42',
    timezone: 'America/Sao_Paulo',
  },
  aiConfig: {
    workingHours: { seg_sex: '08:00-18:00' },
    especialidades: ['cardiologia'],
    canScheduleAnonymous: false,
    maxDaysAhead: 30,
    canDisclosePayments: false,
  },
  patient: null,
  history: [],
  currentMessage: 'qual o horário de funcionamento?',
};

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.error('[live-check] GEMINI_API_KEY ausente no .env.local — abortando.');
    process.exit(1);
  }
  const provider = new GeminiProvider();
  const systemPrompt = buildSystemPrompt(ctx);
  const tools = listToolDeclarations();
  console.log(`[live-check] tools declaradas: ${tools.map((t) => t.name).join(', ')}`);

  // Guard de drift: as declarações enviadas ao modelo têm de ser EXATAMENTE as
  // 15 de produção (não as 3 antigas da C11). Falha antes de gastar tokens.
  const declared = tools.map((t) => t.name);
  const expected: string[] = [...PRODUCTION_TOOL_NAMES];
  const missing = expected.filter((n) => !declared.includes(n));
  const extra = declared.filter((n) => !expected.includes(n));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `[live-check] whitelist divergente da produção — faltando: [${missing.join(', ')}] · extra: [${extra.join(', ')}]`,
    );
  }
  console.log(`[live-check] whitelist OK — ${declared.length} tools iguais às de produção.`);

  // Chamada 1 — espera-se functionCall provide_clinic_info (o prompt manda
  // usar tool p/ horários; modelo PODE responder texto — registramos ambos).
  const r1 = await provider.generateWithTools({
    systemPrompt,
    messages: [{ role: 'user', text: 'qual o horário de funcionamento?' }],
    tools,
  });
  console.log('[live-check] r1.toolCalls =', JSON.stringify(r1.toolCalls ?? null));
  console.log('[live-check] r1.text      =', JSON.stringify(r1.text ?? null));
  console.log('[live-check] r1.usage     =', JSON.stringify(r1.usage), '→ USD', computeCostUsd(r1.usage));
  if (r1.usage.tokensInput <= 0) throw new Error('usageMetadata.promptTokenCount não veio');

  if (!r1.toolCalls || r1.toolCalls[0]?.name !== 'provide_clinic_info') {
    console.warn('[live-check] AVISO: modelo não chamou provide_clinic_info nesta amostra.');
    console.log('\n[live-check] PARCIAL — structured output + usage OK; tool round não exercitado.');
    return;
  }

  // Chamada 2 — devolve o functionResponse e espera TEXTO final.
  const r2 = await provider.generateWithTools({
    systemPrompt,
    messages: [{ role: 'user', text: 'qual o horário de funcionamento?' }],
    tools,
    toolResults: [
      {
        name: 'provide_clinic_info',
        args: r1.toolCalls[0]!.args,
        response: {
          nome: ctx.clinic.nome,
          endereco: ctx.clinic.endereco,
          timezone: ctx.clinic.timezone,
          working_hours: ctx.aiConfig.workingHours,
          especialidades: ctx.aiConfig.especialidades,
        },
      },
    ],
  });
  console.log('[live-check] r2.text  =', JSON.stringify(r2.text ?? null));
  console.log('[live-check] r2.usage =', JSON.stringify(r2.usage), '→ USD', computeCostUsd(r2.usage));
  if (!r2.text || r2.text.trim().length === 0) throw new Error('re-chamada não produziu texto final');

  const totalUsd = computeCostUsd(r1.usage) + computeCostUsd(r2.usage);
  console.log(`\n[live-check] OK — tool calling + functionResponse + usage reais. Custo total ≈ $${totalUsd.toFixed(6)}`);
}

main().catch((e) => {
  console.error('[live-check] FALHOU:', e instanceof Error ? e.message : e);
  process.exit(1);
});

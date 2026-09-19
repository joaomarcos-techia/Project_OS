/**
 * arch:graphs — snapshots de arquitetura versionados (Camada -1 do `docs/qorov2.md`).
 *
 * POR QUE existe: o plano exige "diffar antes×depois" a cada camada para flagrar
 * acoplamento acidental (§11 — Gate de Complexidade). Um grafo desenhado à mão
 * envelhece na primeira PR e passa a mentir; gerado, ele vira um lockfile de
 * arquitetura — mudou o acoplamento, o diff aparece na revisão.
 *
 * O que gera (em `docs/architecture/`):
 *   - dependency-graph.mmd : acoplamento por IMPORT, agregado por elemento
 *   - event-flow.mmd       : acoplamento ASSÍNCRONO, evento a evento
 *   - context-map.mmd      : visão alto nível entre bounded contexts
 *   - arch-metrics.json    : fan-in/fan-out por elemento + ciclos (snapshot do §11)
 *
 * POR QUE agrega por elemento (`context:patient`, `lib:db`) e não por arquivo:
 * 839 módulos dariam um grafo ilegível que muda a cada arquivo novo. Agregado, o
 * snapshot só se mexe quando o ACOPLAMENTO muda — que é exatamente o sinal.
 *
 * POR QUE parse estático dos eventos e não introspecção em runtime: `check:registry`
 * precisa de `.env` + import do schema (banco). Um gerador de documentação não pode
 * depender de infraestrutura. Salvaguarda contra o modo de falha do parse (contar a
 * menos em silêncio): toda referência `X_EVENTS.KEY` PRECISA resolver — se uma não
 * resolver, o script aborta.
 *
 * Uso:
 *   pnpm arch:graphs           regenera os quatro artefatos
 *   pnpm arch:graphs --check   falha (exit 1) se o disco divergir do código
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import madge from 'madge';

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');
const OUT_DIR = join(ROOT, 'docs', 'architecture');
const CHECK = process.argv.includes('--check');

const HEADER = '%% GERADO por `pnpm arch:graphs` — não edite à mão.';

// ---------------------------------------------------------------- elementos

type Kind = 'context' | 'lib' | 'app' | 'component';

const KIND_ORDER: Kind[] = ['app', 'context', 'lib', 'component'];

function stripExt(name: string): string {
  return name.replace(/\.(ts|tsx)$/, '');
}

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

/**
 * O grafo mede acoplamento de PRODUÇÃO. Teste que cruza fronteira não é acoplamento
 * embarcado (e um único `.test.ts` na raiz de `app/` viraria um "elemento" sozinho).
 * Assets (`globals.css`) também entram no grafo do madge e não são código.
 */
function isProductionModule(modulePath: string): boolean {
  const p = toPosix(modulePath);
  if (/\.test\.tsx?$/.test(p)) return false;
  return /\.tsx?$/.test(p);
}

/**
 * Mapeia um módulo (caminho relativo a `src/`, POSIX) para o ELEMENTO que o contém.
 * `null` = fora do recorte (módulos fora de src, arquivos soltos na raiz de src).
 */
function elementOf(modulePath: string): string | null {
  if (!isProductionModule(modulePath)) return null;
  const parts = toPosix(modulePath).split('/');
  const head = parts[0];
  const second = parts[1];
  if (head === undefined || second === undefined) return null;
  const nested = parts.length > 2;
  switch (head) {
    case 'contexts':
      return `context:${second}`;
    case 'lib':
      return `lib:${nested ? second : stripExt(second)}`;
    case 'app':
      return `app:${nested ? second : stripExt(second)}`;
    case 'components':
      return `component:${nested ? second : stripExt(second)}`;
    default:
      return null;
  }
}

function kindOf(elementId: string): Kind {
  return elementId.slice(0, elementId.indexOf(':')) as Kind;
}

function labelOf(elementId: string): string {
  return elementId.slice(elementId.indexOf(':') + 1);
}

/** Id seguro para Mermaid (só [A-Za-z0-9_]), com colisão detectada em vez de silenciada. */
const mermaidIds = new Map<string, string>();
function mermaidId(elementId: string): string {
  const cached = mermaidIds.get(elementId);
  if (cached !== undefined) return cached;
  const id = elementId.replace(/[^A-Za-z0-9]/g, '_');
  for (const [other, taken] of mermaidIds) {
    if (taken === id) {
      throw new Error(`[arch:graphs] colisão de id Mermaid: ${elementId} vs ${other}`);
    }
  }
  mermaidIds.set(elementId, id);
  return id;
}

// ------------------------------------------------------------ grafo de import

interface ElementMetric {
  id: string;
  kind: Kind;
  fanIn: number;
  fanOut: number;
  dependsOn: string[];
}

interface ImportGraph {
  edges: Array<[string, string]>;
  metrics: ElementMetric[];
  moduleCount: number;
  moduleCycles: number;
}

async function buildImportGraph(): Promise<ImportGraph> {
  // `tsConfig` é OBRIGATÓRIO aqui: o repo importa tudo por alias (`@/lib/db`), e sem
  // os `paths` do tsconfig o madge não resolve NADA — o grafo sai quase vazio (foi o
  // que aconteceu na primeira execução: 5 arestas para 839 módulos).
  const result = await madge('src', {
    fileExtensions: ['ts', 'tsx'],
    tsConfig: join(ROOT, 'tsconfig.json'),
  });
  const modules = result.obj();
  const moduleNames = Object.keys(modules);
  if (moduleNames.length === 0) throw new Error('[arch:graphs] madge não retornou módulos');

  const out = new Map<string, Set<string>>();
  let mapped = 0;
  for (const [module, deps] of Object.entries(modules)) {
    const from = elementOf(module);
    if (from === null) continue;
    mapped += 1;
    const bucket = out.get(from) ?? new Set<string>();
    out.set(from, bucket);
    for (const dep of deps) {
      const to = elementOf(dep);
      if (to === null || to === from) continue; // acoplamento interno não é acoplamento
      bucket.add(to);
    }
  }
  if (mapped === 0) {
    throw new Error(
      '[arch:graphs] nenhum módulo caiu num elemento — o formato de caminho do madge mudou',
    );
  }

  const ids = [...new Set([...out.keys(), ...[...out.values()].flatMap((s) => [...s])])].sort();
  const fanIn = new Map<string, number>(ids.map((id) => [id, 0]));
  const edges: Array<[string, string]> = [];
  for (const id of ids) {
    for (const dep of [...(out.get(id) ?? [])].sort()) {
      edges.push([id, dep]);
      fanIn.set(dep, (fanIn.get(dep) ?? 0) + 1);
    }
  }

  const metrics: ElementMetric[] = ids.map((id) => {
    const dependsOn = [...(out.get(id) ?? [])].sort();
    return { id, kind: kindOf(id), fanIn: fanIn.get(id) ?? 0, fanOut: dependsOn.length, dependsOn };
  });

  // `mapped` (e não `moduleNames.length`) porque o snapshot conta o que ENTRA no
  // grafo: módulos de produção dentro do recorte, sem testes nem assets.
  return { edges, metrics, moduleCount: mapped, moduleCycles: result.circular().length };
}

// ------------------------------------------------------------------- eventos

interface EventNode {
  type: string;
  producer: string;
  consumers: string[];
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) acc.push(full);
  }
  return acc;
}

/** `contexts/<nome>/...` → `<nome>`; qualquer outro caminho não é dono de evento. */
function contextOfFile(file: string): string {
  const parts = toPosix(file.slice(SRC_DIR.length + 1)).split('/');
  const name = parts[0] === 'contexts' ? parts[1] : undefined;
  if (name === undefined) throw new Error(`[arch:graphs] arquivo fora de src/contexts: ${file}`);
  return name;
}

/**
 * Resolve `SCHEDULING_EVENTS.CREATED` → 'scheduling.appointment.created' lendo os
 * objetos `export const X_EVENTS = { ... }` de cada `events.ts`.
 */
function buildEventConstants(files: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const block of src.matchAll(/export const ([A-Z0-9_]+) = \{([\s\S]*?)\n\}/g)) {
      const constName = block[1];
      const body = block[2];
      if (constName === undefined || body === undefined) continue;
      for (const entry of body.matchAll(/([A-Z0-9_]+):\s*'([^']+)'/g)) {
        const key = entry[1];
        const value = entry[2];
        if (key === undefined || value === undefined) continue;
        map.set(`${constName}.${key}`, value);
      }
    }
  }
  return map;
}

/**
 * Constantes locais de arquivo (`const PATIENT_CORE_DELETED = 'patient.core.deleted';`).
 * Alguns handlers declaram o tipo do evento que consomem localmente em vez de
 * importar o `X_EVENTS` do vizinho — é o mesmo contrato, escrito à mão.
 */
function parseLocalConstants(src: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of src.matchAll(/(?:export )?const ([A-Z0-9_]+) = '([^']+)'/g)) {
    const key = entry[1];
    const value = entry[2];
    if (key === undefined || value === undefined) continue;
    map.set(key, value);
  }
  return map;
}

function resolveRef(ref: string, constants: Map<string, string>, where: string): string {
  const trimmed = ref.trim();
  const literal = /^'([^']+)'$/.exec(trimmed);
  if (literal?.[1] !== undefined) return literal[1];
  const resolved = constants.get(trimmed);
  if (resolved === undefined) {
    throw new Error(`[arch:graphs] referência de evento não resolvida: ${trimmed} (em ${where})`);
  }
  return resolved;
}

function buildEventGraph(): EventNode[] {
  const contextFiles = walk(join(SRC_DIR, 'contexts'));
  const eventFiles = contextFiles.filter((f) => toPosix(f).endsWith('/events.ts'));
  const constants = buildEventConstants(eventFiles);

  const events = new Map<string, EventNode>();
  for (const file of eventFiles) {
    const src = readFileSync(file, 'utf8');
    const producer = contextOfFile(file);
    for (const call of src.matchAll(/registerEventSchema\(\s*([^,]+),/g)) {
      const ref = call[1];
      if (ref === undefined) continue;
      const type = resolveRef(ref, constants, file);
      events.set(type, { type, producer, consumers: [] });
    }
  }

  const handlerFiles = contextFiles.filter((f) => toPosix(f).includes('/internal/handlers/'));
  for (const file of handlerFiles) {
    const src = readFileSync(file, 'utf8');
    const consumer = contextOfFile(file);
    const scoped = new Map([...constants, ...parseLocalConstants(src)]);
    for (const call of src.matchAll(/register(?:Detached)?Handler(?:<[^(]*>)?\(\s*([^,]+),/g)) {
      const ref = call[1];
      if (ref === undefined) continue;
      const type = resolveRef(ref, scoped, file);
      const node = events.get(type);
      if (node === undefined) {
        throw new Error(`[arch:graphs] handler consome evento fora do catálogo: ${type} (${file})`);
      }
      if (!node.consumers.includes(consumer)) node.consumers.push(consumer);
    }
  }

  // Handlers 1:1 que precisam orquestrar mais de um contexto ficam na camada
  // app. Cada participação lógica é declarada ao lado do registro como:
  // `@event-consumer X_EVENTS.KEY context-name`. Isso mantém o grafo fiel sem
  // inventar fan-out no registry nem atribuir ownership do app a um contexto.
  const appFiles = walk(join(SRC_DIR, 'app'));
  const contextNames = new Set(
    readdirSync(join(SRC_DIR, 'contexts'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  for (const file of appFiles) {
    const src = readFileSync(file, 'utf8');
    for (const declaration of src.matchAll(/@event-consumer\s+(\S+)\s+([a-z0-9-]+)/g)) {
      const ref = declaration[1];
      const consumer = declaration[2];
      if (ref === undefined || consumer === undefined) continue;
      if (!contextNames.has(consumer)) {
        throw new Error(`[arch:graphs] consumidor lógico desconhecido: ${consumer} (em ${file})`);
      }
      const type = resolveRef(ref, constants, file);
      const node = events.get(type);
      if (node === undefined) {
        throw new Error(
          `[arch:graphs] composição consome evento fora do catálogo: ${type} (${file})`,
        );
      }
      if (!node.consumers.includes(consumer)) node.consumers.push(consumer);
    }
  }

  return [...events.values()]
    .map((e) => ({ ...e, consumers: [...e.consumers].sort() }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

// ------------------------------------------------------------------ renderers

function renderDependencyGraph(graph: ImportGraph): string {
  const lines = [HEADER, '%% Acoplamento por IMPORT, agregado por elemento.', 'flowchart LR'];
  for (const kind of KIND_ORDER) {
    const ids = graph.metrics.filter((m) => m.kind === kind).map((m) => m.id);
    if (ids.length === 0) continue;
    lines.push(`  subgraph ${kind}s["${kind}"]`);
    for (const id of ids) lines.push(`    ${mermaidId(id)}["${labelOf(id)}"]`);
    lines.push('  end');
  }
  for (const [from, to] of graph.edges) lines.push(`  ${mermaidId(from)} --> ${mermaidId(to)}`);
  return `${lines.join('\n')}\n`;
}

function renderEventFlow(events: EventNode[]): string {
  const lines = [
    HEADER,
    '%% Acoplamento ASSÍNCRONO: produtor -> evento -> consumidor (outbox).',
    '%% Evento sem consumidor é estado terminal legítimo (worker marca `skipped`).',
    'flowchart LR',
  ];
  const contexts = [...new Set(events.flatMap((e) => [e.producer, ...e.consumers]))].sort();
  for (const ctx of contexts) lines.push(`  ${mermaidId(`context:${ctx}`)}(["${ctx}"])`);
  const orphans: string[] = [];
  for (const event of events) {
    const node = `ev_${event.type.replace(/[^A-Za-z0-9]/g, '_')}`;
    lines.push(`  ${node}["${event.type}"]`);
    lines.push(`  ${mermaidId(`context:${event.producer}`)} --> ${node}`);
    for (const consumer of event.consumers) {
      lines.push(`  ${node} --> ${mermaidId(`context:${consumer}`)}`);
    }
    if (event.consumers.length === 0) orphans.push(node);
  }
  if (orphans.length > 0) {
    lines.push('  classDef semConsumidor stroke-dasharray: 4 4;');
    lines.push(`  class ${orphans.join(',')} semConsumidor;`);
  }
  return `${lines.join('\n')}\n`;
}

function renderContextMap(graph: ImportGraph, events: EventNode[]): string {
  const lines = [
    HEADER,
    '%% Alto nível. Linha cheia = evento (outbox). Linha tracejada = import do',
    '%% barrel público do vizinho (exceção `boundaries` justificada no código).',
    'flowchart LR',
  ];
  for (const metric of graph.metrics) {
    if (metric.kind !== 'context') continue;
    lines.push(`  ${mermaidId(metric.id)}["${labelOf(metric.id)}"]`);
  }

  const eventEdges = new Map<string, number>();
  for (const event of events) {
    for (const consumer of event.consumers) {
      const key = `${event.producer}>${consumer}`;
      eventEdges.set(key, (eventEdges.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of [...eventEdges].sort()) {
    const [from, to] = key.split('>');
    if (from === undefined || to === undefined) continue;
    const suffix = count === 1 ? 'evento' : 'eventos';
    lines.push(
      `  ${mermaidId(`context:${from}`)} -->|"${count} ${suffix}"| ${mermaidId(`context:${to}`)}`,
    );
  }
  for (const [from, to] of graph.edges) {
    if (kindOf(from) !== 'context' || kindOf(to) !== 'context') continue;
    lines.push(`  ${mermaidId(from)} -.->|import| ${mermaidId(to)}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderMetrics(graph: ImportGraph, events: EventNode[]): string {
  const snapshot = {
    _comment: 'GERADO por `pnpm arch:graphs`. Baseline do Gate de Complexidade (qorov2 §11).',
    totals: {
      modules: graph.moduleCount,
      elements: graph.metrics.length,
      importEdges: graph.edges.length,
      moduleCycles: graph.moduleCycles,
      events: events.length,
      eventsWithoutConsumer: events.filter((e) => e.consumers.length === 0).length,
    },
    elements: graph.metrics,
  };
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

// ----------------------------------------------------------------------- main

async function main(): Promise<void> {
  const graph = await buildImportGraph();
  const events = buildEventGraph();

  const artifacts: Record<string, string> = {
    'dependency-graph.mmd': renderDependencyGraph(graph),
    'event-flow.mmd': renderEventFlow(events),
    'context-map.mmd': renderContextMap(graph, events),
    'arch-metrics.json': renderMetrics(graph, events),
  };

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const drifted: string[] = [];
  for (const [name, content] of Object.entries(artifacts)) {
    const target = join(OUT_DIR, name);
    if (CHECK) {
      const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
      if (current !== content) drifted.push(name);
    } else {
      writeFileSync(target, content, 'utf8');
    }
  }

  const summary =
    `${graph.metrics.length} elementos · ${graph.edges.length} arestas de import · ` +
    `${graph.moduleCycles} ciclo(s) · ${events.length} eventos ` +
    `(${events.filter((e) => e.consumers.length === 0).length} sem consumidor)`;

  if (CHECK) {
    if (drifted.length > 0) {
      console.error(`[arch:graphs] DRIFT em: ${drifted.join(', ')}`);
      console.error(
        '[arch:graphs] o acoplamento mudou — rode `pnpm arch:graphs` e commite o diff.',
      );
      process.exit(1);
    }
    console.warn(`[arch:graphs] OK — snapshots em dia (${summary}).`);
    return;
  }

  console.warn(`[arch:graphs] gerado em docs/architecture — ${summary}.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

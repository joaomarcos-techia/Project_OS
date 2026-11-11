import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const DIR = path.join(process.cwd(), 'data/tiss/seguranca/202511');
const official = JSON.parse(readFileSync(path.join(DIR, 'requisitos.json'), 'utf8')) as {
  requirements: Array<{ id: number; condition: string; endsOn: string | null }>;
};
const matrix = JSON.parse(readFileSync(path.join(DIR, 'matriz-qoro.json'), 'utf8')) as {
  legenda: Record<string, string>;
  requisitos: Array<{ id: number; situacao: string; evidencia: string }>;
};
const inForce = official.requirements.filter((r) => !r.endsOn || r.endsOn >= '2026-11-11');

describe('matriz Qoro × Componente de Segurança e Privacidade 202511 (S9)', () => {
  it('cobre exatamente os 53 requisitos vigentes, sem repetir nem inventar', () => {
    expect(inForce).toHaveLength(53);
    expect(matrix.requisitos.map((r) => r.id).sort((a, b) => a - b)).toEqual(
      inForce.map((r) => r.id).sort((a, b) => a - b),
    );
  });

  it('toda linha tem situação da legenda e evidência', () => {
    for (const r of matrix.requisitos) {
      expect(Object.keys(matrix.legenda), String(r.id)).toContain(r.situacao);
      expect(r.evidencia.length, String(r.id)).toBeGreaterThan(10);
    }
  });

  it('"recomendado_pendente" só para requisito recomendado; obrigatório nunca fica como recomendado', () => {
    const cond = new Map(inForce.map((r) => [r.id, r.condition]));
    for (const r of matrix.requisitos.filter((x) => x.situacao === 'recomendado_pendente')) {
      expect(cond.get(r.id), String(r.id)).toBe('Recomendado');
    }
  });

  it('não declara conformidade integral: há lacunas e parciais em obrigatórios', () => {
    const cond = new Map(inForce.map((r) => [r.id, r.condition]));
    const openMandatory = matrix.requisitos.filter(
      (r) =>
        cond.get(r.id) === 'Obrigatório' &&
        ['lacuna', 'parcial', 'interpretacao'].includes(r.situacao),
    );
    expect(openMandatory.length).toBeGreaterThan(0);
  });
});

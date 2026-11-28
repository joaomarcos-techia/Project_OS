/**
 * Modelos impressos OFICIAIS da ANS (Componente de Conteúdo e Estrutura 202511):
 * Guia de Consulta (p. 469) e Guia SP/SADT (p. 520), extraídos do PDF oficial por
 * `scripts/tiss/print/extract-official-model.ts` com o SHA-256 do PDF e do zip.
 *
 * O PDF do Qoro desenha as MESMAS caixas e os MESMOS rótulos, nas mesmas posições
 * (pontos, origem no canto superior esquerdo, A4 paisagem): o layout vem deste
 * dado versionado, não de coordenadas digitadas à mão. Assim a conformidade com o
 * modelo é verificável por teste (P13.7), não por impressão de "parecido".
 */
import consultaJson from './models/consulta-p469.json';
import spSadtJson from './models/sp-sadt-p520.json';

export interface ModelLabel {
  text: string;
  x: number;
  /** Linha de base do texto, a partir do topo da página. */
  y: number;
  size: number;
}
export interface ModelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  paint: 'stroke' | 'fill' | 'both' | 'none';
  fill: string | null;
  stroke: string | null;
  lineWidth: number;
}
export interface OfficialModel {
  source: { document: string; zipSha256: string; pdfSha256: string; page: number };
  title: string;
  width: number;
  height: number;
  labels: ModelLabel[];
  boxes: ModelBox[];
}

export const CONSULTA_MODEL = consultaJson as OfficialModel;
export const SP_SADT_MODEL = spSadtJson as OfficialModel;

/**
 * Textos do modelo que são EXEMPLO de preenchimento ou espaço de logotipo, não rótulo:
 * o Qoro põe o dado real no lugar (o número da guia, o nome da operadora).
 */
export const SAMPLE_TEXTS: ReadonlySet<string> = new Set(['12345678901234567890', 'Logo da Empresa']);

/** Número do campo no início do rótulo (`"9- Código…"`, `"26 – Nome Social"`, `"28 -Regime…"`). */
export function fieldNumber(text: string): number | null {
  const m = /^(\d{1,2})\s*[-–]/u.exec(text);
  return m ? Number(m[1]) : null;
}

/** Rótulo oficial do campo (a primeira linha que começa pelo número). */
export function officialLabel(model: OfficialModel, no: number): ModelLabel | null {
  return model.labels.find((l) => fieldNumber(l.text) === no) ?? null;
}

/**
 * Caixa do campo no modelo oficial: a MENOR caixa contornada que contém o início do
 * rótulo. As tabelas (procedimentos, equipe, série) não têm caixa por campo; quem as
 * desenha usa as colunas declaradas no renderizador.
 */
export function fieldBox(model: OfficialModel, no: number): ModelBox | null {
  const label = officialLabel(model, no);
  if (!label) return null;
  const inside = model.boxes.filter(
    (b) =>
      b.paint !== 'fill' &&
      label.x >= b.x - 0.5 &&
      label.x <= b.x + b.w &&
      label.y >= b.y &&
      label.y <= b.y + b.h &&
      b.w < model.width * 0.9,
  );
  inside.sort((a, b) => a.w * a.h - b.w * b.h);
  return inside[0] ?? null;
}

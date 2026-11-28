/**
 * Larguras da Helvetica (AFM das 14 fontes-padrão do PDF, em milésimos do corpo)
 * para encaixar cada valor na caixa do modelo SEM corte e sem sobreposição: o
 * renderizador quebra as linhas e reduz o corpo antes de desenhar, e o que não
 * cabe vai inteiro para a folha de continuação (nunca é truncado em silêncio).
 */
const W: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333, '*': 389,
  '+': 584, ',': 278, '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015, '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333, '{': 334, '|': 260, '}': 334, '~': 584,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833,
  n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '–': 556, '—': 1000, º: 365, ª: 370, '°': 400,
};

/** Largura em pontos (letras acentuadas medem como a letra base). */
export function textWidth(text: string, size: number, bold = false): number {
  let total = 0;
  for (const ch of text.normalize('NFD').replace(/\p{M}/gu, '')) {
    total += W[ch] ?? (/\d/u.test(ch) ? 556 : 600);
  }
  return (total / 1000) * size * (bold ? 1.06 : 1);
}

/** Quebra em linhas que cabem em `width` (palavra longa demais é partida). */
export function wrapText(text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/gu, '\n').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (textWidth(word, size) <= width) {
        line = word;
        continue;
      }
      let chunk = '';
      for (const ch of word) {
        if (textWidth(chunk + ch, size) > width && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export interface FittedText {
  size: number;
  lines: string[];
  /** O texto inteiro não coube nem no corpo mínimo: vai para a folha de continuação. */
  overflow: boolean;
}

/**
 * Maior corpo (de `max` até `min`, de 0,25 em 0,25) em que o texto cabe na área.
 * Linha a linha com entrelinha de 1,15 × corpo.
 */
export function fitText(text: string, area: { width: number; height: number }, max: number, min: number): FittedText {
  for (let size = max; size >= min - 1e-9; size -= 0.25) {
    const lines = wrapText(text, size, area.width);
    if (lines.length * size * 1.15 <= area.height + 0.01) return { size, lines, overflow: false };
  }
  const lines = wrapText(text, min, area.width);
  const fits = Math.max(1, Math.floor((area.height + 0.01) / (min * 1.15)));
  return { size: min, lines: lines.slice(0, fits), overflow: lines.length > fits };
}

/**
 * madge@8 não publica tipos. Declaração mínima da superfície que
 * `scripts/arch-graphs.ts` usa — nada além disso (o resto da API não nos
 * interessa e tipar a mais só cria manutenção sem uso).
 */
declare module 'madge' {
  interface MadgeConfig {
    fileExtensions?: string[];
    tsConfig?: string;
    detectiveOptions?: Record<string, unknown>;
  }

  interface MadgeResult {
    /** Grafo de dependências: caminho relativo à raiz analisada → dependências. */
    obj(): Record<string, string[]>;
    /** Ciclos detectados, cada um como a lista ordenada de módulos. */
    circular(): string[][];
  }

  function madge(path: string | string[], config?: MadgeConfig): Promise<MadgeResult>;

  export default madge;
}

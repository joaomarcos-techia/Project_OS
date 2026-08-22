import type { CaixaItem } from '@/contexts/financial/types';

/** Mantém o arredondamento centesimal usado nos totais, linhas e ações do Caixa. */
export const outstandingBalance = (item: CaixaItem) =>
  Math.round((item.valor - item.valorPago) * 100) / 100;

import 'server-only';

import { cache } from 'react';

import { loadTrialAccess } from '@/lib/trial-access';

/**
 * P-11 (docs/otimização_ui_final.md): a leitura do trial memoizada POR REQUISIÇÃO.
 *
 * O layout do shell e as páginas de Equipe, Pagamentos e WhatsApp liam o mesmo dado, cada um
 * abrindo a própria transação (`withTenant`). Com `cache`, a segunda chamada da mesma
 * requisição reaproveita a primeira. Nada muda no contrato: mesma função, mesmo resultado, e o
 * cache morre com a requisição (uma mudança de plano vale na próxima carga, como antes).
 */
export const loadTrialAccessForRequest = cache(loadTrialAccess);

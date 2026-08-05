'use server';

/**
 * Procedures catalog Server Actions (C6). Procedures NÃO emitem evento de
 * domínio — usam idempotentMutation (idempotência + audit). Mudanças de
 * preço/duração/etc. gravam `procedure_history` na MESMA tx (teste 6.6.2).
 * Procedure NUNCA é deletado (FK RESTRICT) — apenas `ativo=false`.
 *
 * Permissão: manage:procedures (catálogo/preço é configuração sensível).
 */
import { and, eq, sql } from 'drizzle-orm';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { MUTATION_IDEM_TTL_SECONDS } from '@/lib/idempotency/ttl';
import { isUniqueViolation } from '@/lib/outbox/errors';
import type { Tx } from '@/lib/db';

import { ProcedureNotFoundError, SchedulingConflictError } from './errors';
import { idemKey, jsonSafe, requestContext } from './internal/action-helpers';
import { getProcedure, toProcedureSummary } from './queries';
import { procedureHistory, procedures, type ProcedureRow } from './schema';
import {
  CreateProcedureSchema,
  UpdateProcedureSchema,
  type CreateProcedureInput,
  type ProcedureSummary,
  type UpdateProcedureInput,
} from './types';

export async function createProcedure(
  input: CreateProcedureInput,
  idempotencyKey: string,
): Promise<ProcedureSummary> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_PROCEDURES);
  const data = CreateProcedureSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  try {
    return await idempotentMutation(
      {
        idempotency: {
          key: idemKey('proc_create', idempotencyKey),
          payload: jsonSafe(data),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
        audit: {
          action: 'procedure.created',
          resourceType: 'procedure',
          resourceId: null,
          before: null,
          requestContext: ctx,
        },
      },
      async (tx) => {
        const [row] = await tx
          .insert(procedures)
          .values({
            clinicId,
            codigo: data.codigo,
            descricao: data.descricao,
            categoria: data.categoria ?? null,
            valorPadrao: data.valorPadrao.toFixed(2),
            duracaoPadraoMin: data.duracaoPadraoMin,
            ativo: data.ativo ?? true,
          })
          .returning();
        return toProcedureSummary(row!);
      },
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new SchedulingConflictError('código de procedimento já existe nesta clínica');
    }
    throw err;
  }
}

export async function updateProcedure(
  id: string,
  input: UpdateProcedureInput,
  idempotencyKey: string,
): Promise<ProcedureSummary> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_PROCEDURES);
  const data = UpdateProcedureSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const before = await getProcedure(clinicId, id);
  if (!before) throw new ProcedureNotFoundError(id);

  try {
    return await idempotentMutation(
      {
        idempotency: {
          key: idemKey('proc_update', idempotencyKey),
          payload: jsonSafe({ id, data }),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
        audit: {
          action: 'procedure.updated',
          resourceType: 'procedure',
          resourceId: id,
          before,
          requestContext: ctx,
        },
      },
      async (tx) => {
        const [current] = await tx
          .select()
          .from(procedures)
          .where(and(eq(procedures.clinicId, clinicId), eq(procedures.id, id)))
          .for('update')
          .limit(1);
        if (!current) throw new ProcedureNotFoundError(id);

        const set: Partial<ProcedureRow> = {};
        const history: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];
        if (data.codigo !== undefined && data.codigo !== current.codigo) {
          set.codigo = data.codigo;
          history.push({ field: 'codigo', oldValue: current.codigo, newValue: data.codigo });
        }
        if (data.descricao !== undefined && data.descricao !== current.descricao) {
          set.descricao = data.descricao;
          history.push({
            field: 'descricao',
            oldValue: current.descricao,
            newValue: data.descricao,
          });
        }
        if (
          data.categoria !== undefined &&
          (data.categoria ?? null) !== (current.categoria ?? null)
        ) {
          set.categoria = data.categoria ?? null;
          history.push({
            field: 'categoria',
            oldValue: current.categoria,
            newValue: data.categoria ?? null,
          });
        }
        if (data.valorPadrao !== undefined && data.valorPadrao !== Number(current.valorPadrao)) {
          set.valorPadrao = data.valorPadrao.toFixed(2);
          history.push({
            field: 'valor_padrao',
            oldValue: Number(current.valorPadrao),
            newValue: data.valorPadrao,
          });
        }
        if (
          data.duracaoPadraoMin !== undefined &&
          data.duracaoPadraoMin !== current.duracaoPadraoMin
        ) {
          set.duracaoPadraoMin = data.duracaoPadraoMin;
          history.push({
            field: 'duracao_padrao_min',
            oldValue: current.duracaoPadraoMin,
            newValue: data.duracaoPadraoMin,
          });
        }
        if (data.ativo !== undefined && data.ativo !== current.ativo) {
          set.ativo = data.ativo;
          history.push({ field: 'ativo', oldValue: current.ativo, newValue: data.ativo });
        }

        if (history.length === 0) return toProcedureSummary(current);

        const [row] = await tx
          .update(procedures)
          .set({ ...set, updatedAt: sql`now()` })
          .where(and(eq(procedures.id, id), eq(procedures.clinicId, clinicId)))
          .returning();
        await recordHistory(tx, clinicId, id, user.userId, history);
        return toProcedureSummary(row!);
      },
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new SchedulingConflictError('código de procedimento já existe nesta clínica');
    }
    throw err;
  }
}

/** Soft-disable (REGRA: nunca DELETE — FK RESTRICT protege appointments). */
export async function deactivateProcedure(
  id: string,
  idempotencyKey: string,
): Promise<ProcedureSummary> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_PROCEDURES);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const before = await getProcedure(clinicId, id);
  if (!before) throw new ProcedureNotFoundError(id);

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('proc_deactivate', idempotencyKey),
        payload: jsonSafe({ id }),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'procedure.deactivated',
        resourceType: 'procedure',
        resourceId: id,
        before,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [row] = await tx
        .update(procedures)
        .set({ ativo: false, updatedAt: sql`now()` })
        .where(and(eq(procedures.clinicId, clinicId), eq(procedures.id, id)))
        .returning();
      if (!row) throw new ProcedureNotFoundError(id);
      if (before.ativo) {
        await recordHistory(tx, clinicId, id, user.userId, [
          { field: 'ativo', oldValue: true, newValue: false },
        ]);
      }
      return toProcedureSummary(row);
    },
  );
}

// --- helpers ---------------------------------------------------------------

type ChangedField =
  | 'valor_padrao'
  | 'duracao_padrao_min'
  | 'descricao'
  | 'ativo'
  | 'categoria'
  | 'codigo';

async function recordHistory(
  tx: Tx,
  clinicId: string,
  procedureId: string,
  changedBy: string,
  changes: Array<{ field: string; oldValue: unknown; newValue: unknown }>,
): Promise<void> {
  for (const c of changes) {
    await tx.insert(procedureHistory).values({
      clinicId,
      procedureId,
      changedField: c.field as ChangedField,
      oldValue: c.oldValue as never,
      newValue: c.newValue as never,
      changedBy,
    });
  }
}

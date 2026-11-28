import 'server-only';

import { ZodError } from 'zod';

import { AuthError } from '@/lib/auth/tenant-context';
import { TrialAccessError } from '@/lib/trial-access/policy';

import type { SchedulingActionResult } from '../action-result';
import {
  AppointmentNotFoundError,
  ProcedureNotFoundError,
  SchedulingConflictError,
  SchedulingValidationError,
} from '../errors';

/**
 * Tradutor de negativa ESPERADA em resultado controlado (OBS-002).
 *
 * ===================================================================
 * O problema
 * ===================================================================
 * As actions de configuração deixavam `ZodError`, violação de unicidade,
 * overlap e erros de domínio escaparem cruas pela fronteira RSC/Server Action.
 * O runtime de produção mascara a mensagem, então o cliente recebia HTTP 500 e
 * o manager renderizava um alert VAZIO. O pentest reproduziu quatro vezes:
 * código de procedimento com 41 caracteres, código duplicado, janela de
 * horário sobreposta e feriado duplicado. O banco ficou íntegro nas quatro —
 * Zod e os índices únicos funcionaram como barreira de DADOS. O defeito é de
 * CONTRATO: entrada adulterada e conflito de negócio esperado não são falha
 * interna, não devem acionar alerta 5xx e precisam devolver texto acionável.
 *
 * ===================================================================
 * O que NÃO é traduzido, de propósito
 * ===================================================================
 * Só as classes listadas viram resultado. Qualquer outra exceção — timeout de
 * banco, bug de código — continua subindo, virando 5xx e chegando ao Sentry.
 * Um `catch` genérico aqui trocaria ruído por cegueira.
 */
/** Primeira mensagem do Zod, já legível; sem `path` nem stack. */
function zodMessage(err: ZodError): string {
  return err.issues[0]?.message ?? 'Dados inválidos.';
}

/**
 * Executa a operação e converte as negativas conhecidas.
 *
 * `AuthError` entra na lista porque, depois do AUTHZ-007, negar o médico que
 * tenta mexer na agenda alheia passou a ser um caminho NORMAL desta action —
 * e a correção de um achado não pode introduzir o 500 de outro.
 */
export async function toActionResult<T>(run: () => Promise<T>): Promise<SchedulingActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (err) {
    if (err instanceof TrialAccessError) return { ok: false, message: err.message };
    if (err instanceof ZodError) return { ok: false, message: zodMessage(err) };
    if (err instanceof AuthError) {
      return {
        ok: false,
        message:
          err.reason === 'PERMISSION_DENIED'
            ? 'Você não tem permissão para esta alteração.'
            : 'Sua sessão expirou. Entre novamente para continuar.',
      };
    }
    if (
      err instanceof SchedulingConflictError ||
      err instanceof SchedulingValidationError ||
      err instanceof AppointmentNotFoundError ||
      err instanceof ProcedureNotFoundError
    ) {
      return { ok: false, message: err.message };
    }
    throw err; // inesperado — 5xx + Sentry, como deve ser
  }
}

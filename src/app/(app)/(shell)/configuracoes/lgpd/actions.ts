'use server';

import { revalidatePath } from 'next/cache';

import {
  assignLgpdRequest,
  markLgpdRequesterNotified,
  processLgpdRequest,
} from '@/contexts/patient/actions';

function required(fd: FormData, field: string): string {
  const value = fd.get(field);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} obrigatorio`);
  return value.trim();
}

export async function processLgpdRequestForm(fd: FormData): Promise<void> {
  await processLgpdRequest(
    required(fd, 'requestId'),
    required(fd, 'reason'),
    required(fd, 'idempotencyKey'),
  );
  revalidatePath('/configuracoes/lgpd');
}

export async function assignLgpdRequestForm(fd: FormData): Promise<void> {
  await assignLgpdRequest(
    required(fd, 'requestId'),
    required(fd, 'assignedToUserId'),
    required(fd, 'idempotencyKey'),
  );
  revalidatePath('/configuracoes/lgpd');
}

export async function notifyLgpdRequesterForm(fd: FormData): Promise<void> {
  await markLgpdRequesterNotified(
    required(fd, 'requestId'),
    required(fd, 'channel'),
    required(fd, 'note'),
    required(fd, 'idempotencyKey'),
  );
  revalidatePath('/configuracoes/lgpd');
}

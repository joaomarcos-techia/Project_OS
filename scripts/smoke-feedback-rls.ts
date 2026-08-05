/**
 * Prova a RLS autor-privada da central de feedback em um Supabase de DEV.
 *
 * Cria uma clínica e dois usuários descartáveis. O autor A deve ver somente
 * suas sugestões/histórico; o autor B não pode ler nem escrever em nome de A.
 * Tudo é removido no finally.
 */
// Deve carregar aliases *_DEV antes dos módulos que validam env no import.
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { feedbackHistory, feedbackSuggestions } from '@/contexts/feedback/schema';

type CreatedFeedback = { id: string };

assertDevContext();

const runId = randomUUID().replace(/-/g, '');
const slug = `feedback-rls-${runId.slice(0, 16)}`;
const emailA = `feedback-author-a-${runId}@example.test`;
const emailB = `feedback-author-b-${runId}@example.test`;
const admin = createAdminClient();
let clinicId: string | undefined;
let userA: string | undefined;
let userB: string | undefined;

try {
  const createdClinicId = await createClinic(slug);
  clinicId = createdClinicId;
  const createdUserA = await createUser(emailA);
  userA = createdUserA;
  const createdUserB = await createUser(emailB);
  userB = createdUserB;

  const feedbackA = await createFeedbackAsAdmin(
    createdClinicId,
    createdUserA,
    'Sugestão do autor A',
  );
  await dbAdmin.insert(feedbackHistory).values({
    clinicId: createdClinicId,
    feedbackId: feedbackA.id,
    action: 'created',
    changedBy: createdUserA,
  });

  assert(
    (await countSuggestions(createdClinicId, createdUserA)) === 1,
    'o autor A deveria ler a própria sugestão',
  );
  assert(
    (await countSuggestions(createdClinicId, createdUserB)) === 0,
    'o autor B não pode ler a sugestão do autor A',
  );
  assert(
    (await countHistory(createdClinicId, createdUserA, feedbackA.id)) === 1,
    'o autor A deveria ler o próprio histórico',
  );
  assert(
    (await countHistory(createdClinicId, createdUserB, feedbackA.id)) === 0,
    'o autor B não pode ler o histórico do autor A',
  );

  const crossSuggestionDenied = await isDenied(() =>
    withTenant(
      createdClinicId,
      async (tx) => {
        await tx.insert(feedbackSuggestions).values({
          clinicId: createdClinicId,
          userId: createdUserA,
          title: 'Tentativa cruzada',
          description: 'O autor B não pode criar uma sugestão em nome do autor A.',
          category: 'bug',
          priority: 'high',
          attachments: [],
        });
      },
      createdUserB,
    ),
  );
  assert(crossSuggestionDenied, 'RLS deveria negar sugestão com autor divergente');

  const crossHistoryDenied = await isDenied(() =>
    withTenant(
      createdClinicId,
      async (tx) => {
        await tx.insert(feedbackHistory).values({
          clinicId: createdClinicId,
          feedbackId: feedbackA.id,
          action: 'note_added',
          changedBy: createdUserB,
          note: 'Tentativa cruzada',
        });
      },
      createdUserB,
    ),
  );
  assert(crossHistoryDenied, 'RLS deveria negar histórico em feedback de outro autor');

  const feedbackB = await withTenant(
    createdClinicId,
    async (tx): Promise<CreatedFeedback> => {
      const [created] = await tx
        .insert(feedbackSuggestions)
        .values({
          clinicId: createdClinicId,
          userId: createdUserB,
          title: 'Sugestão do autor B',
          description: 'A própria sugestão do autor B deve ser aceita pela RLS.',
          category: 'improvement',
          priority: 'medium',
          attachments: [],
        })
        .returning({ id: feedbackSuggestions.id });
      if (!created) throw new Error('a sugestão própria do autor B não foi criada');
      return created;
    },
    createdUserB,
  );
  assert(feedbackB.id.length > 0, 'a sugestão própria do autor B deveria ser criada');

  console.log('[feedback-rls] OK — visibilidade e escrita são privadas por autor.');
} finally {
  await cleanup();
}

async function createClinic(slugValue: string): Promise<string> {
  const rows = (await dbAdmin.execute(
    sql`INSERT INTO public.clinics (slug, nome, status)
        VALUES (${slugValue}, 'Smoke feedback RLS', 'active')
        RETURNING id::text AS id`,
  )) as unknown as Array<{ id: string }>;
  const id = rows[0]?.id;
  if (!id) throw new Error('não foi possível criar a clínica descartável');
  return id;
}

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: randomUUID(),
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error('não foi possível criar usuário descartável');
  return data.user.id;
}

async function createFeedbackAsAdmin(
  targetClinicId: string,
  targetUserId: string,
  title: string,
): Promise<CreatedFeedback> {
  const [created] = await dbAdmin
    .insert(feedbackSuggestions)
    .values({
      clinicId: targetClinicId,
      userId: targetUserId,
      title,
      description: 'Registro descartável para validar o isolamento de feedback por autor.',
      category: 'feature',
      priority: 'low',
      attachments: [],
    })
    .returning({ id: feedbackSuggestions.id });
  if (!created) throw new Error('não foi possível criar feedback descartável');
  return created;
}

async function countSuggestions(targetClinicId: string, actorUserId: string): Promise<number> {
  return withTenant(
    targetClinicId,
    async (tx) => {
      const rows = await tx
        .select({ id: feedbackSuggestions.id })
        .from(feedbackSuggestions)
        .where(eq(feedbackSuggestions.clinicId, targetClinicId));
      return rows.length;
    },
    actorUserId,
  );
}

async function countHistory(
  targetClinicId: string,
  actorUserId: string,
  feedbackId: string,
): Promise<number> {
  return withTenant(
    targetClinicId,
    async (tx) => {
      const rows = await tx
        .select({ id: feedbackHistory.id })
        .from(feedbackHistory)
        .where(
          and(
            eq(feedbackHistory.clinicId, targetClinicId),
            eq(feedbackHistory.feedbackId, feedbackId),
          ),
        );
      return rows.length;
    },
    actorUserId,
  );
}

async function isDenied(operation: () => Promise<void>): Promise<boolean> {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}

async function cleanup(): Promise<void> {
  if (clinicId) {
    await dbAdmin.delete(feedbackHistory).where(eq(feedbackHistory.clinicId, clinicId));
    await dbAdmin.delete(feedbackSuggestions).where(eq(feedbackSuggestions.clinicId, clinicId));
    await dbAdmin.execute(sql`DELETE FROM public.clinics WHERE id = ${clinicId}::uuid`);
  }
  for (const userId of [userA, userB]) {
    if (!userId) continue;
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[feedback-rls] ${message}`);
}

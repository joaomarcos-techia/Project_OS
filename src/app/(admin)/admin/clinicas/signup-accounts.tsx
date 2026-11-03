import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@/components/ui/table';

import type { SignupAccountDTO } from '../_lib/dto';
import { formatDateTime } from '../_lib/format';
import { guardAdminAccess } from '../_lib/guard';
import { signupAccountRepository } from '../_lib/repositories/signup-accounts.repo';

const STAGES: Record<SignupAccountDTO['stage'], string> = {
  email_pending: 'Aguardando confirmar e-mail',
  password_pending: 'E-mail confirmado; falta criar senha',
  plan_pending: 'Falta concluir plano e Checkout',
  checkout_pending: 'Checkout iniciado; ativação pendente',
};

export function SignupAccountsLoading() {
  return (
    <p role="status" className="mt-(--sp-4) text-sm text-fg-muted">
      Consultando contas de cadastro autônomo…
    </p>
  );
}

export async function SignupAccounts({ page }: { page: number }) {
  await guardAdminAccess();
  const result = await signupAccountRepository.list(page);
  return (
    <Card
      id="cadastros-autonomos"
      className="mt-(--sp-4)"
      role="region"
      aria-labelledby="signup-accounts-title"
    >
      <CardHeader>
        <CardTitle id="signup-accounts-title">Contas autônomas sem clínica</CardTitle>
        <CardDescription>
          Contas iniciadas pelo site que ainda não concluíram a ativação. Elas não entram no total
          de clínicas. Após o provisionamento, aparecem na lista de clínicas acima, junto às criadas
          por convite.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!result.ok ? (
          <Alert variant="warning">
            Não foi possível consultar as contas. Atualize a página para tentar novamente; isso não
            significa que a lista está vazia.
          </Alert>
        ) : (
          <>
            {result.items.length === 0 ? (
              <EmptyState
                variant="compact"
                title="Nenhuma conta autônoma sem clínica nesta página."
                description="A consulta é paginada. Outras páginas podem conter contas pendentes; as respostas temporárias do formulário podem já ter expirado."
              />
            ) : (
              <TableScroll>
                <Table className="min-w-160">
                  <TableHeader>
                    <TableRow>
                      <TableHead>E-mail parcialmente oculto</TableHead>
                      <TableHead>Conta criada</TableHead>
                      <TableHead>Etapa atual</TableHead>
                      <TableHead>Formulário temporário</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.items.map((account) => (
                      <TableRow key={account.id} data-signup-account-id={account.id}>
                        <TableCell>{account.maskedEmail}</TableCell>
                        <TableCell className="tabular-nums">
                          {formatDateTime(account.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge tone="amber">{STAGES[account.stage]}</Badge>
                        </TableCell>
                        <TableCell>
                          {account.liveDraft
                            ? 'Ainda válido'
                            : 'Indisponível; precisa retomar o cadastro'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScroll>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-fg-muted">
                Página {result.page}. Cada página consulta até 100 contas de acesso e mostra apenas
                os cadastros autônomos sem clínica.
              </p>
              <div className="flex gap-2">
                {result.page > 1 ? (
                  <Link
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                    href={`/admin/clinicas?cadastrosPage=${result.page - 1}#cadastros-autonomos`}
                  >
                    Cadastros anteriores
                  </Link>
                ) : null}
                {result.hasNextPage ? (
                  <Link
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                    href={`/admin/clinicas?cadastrosPage=${result.page + 1}#cadastros-autonomos`}
                  >
                    Mais cadastros
                  </Link>
                ) : null}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

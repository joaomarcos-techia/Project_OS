import { describe, expect, it, vi } from 'vitest';
import { TestCommandJournal } from '../../test/command-journal';
import { createAbacatePayCommands } from './sandbox-commands';

const input = {
  operationId: 'ed9148ee-3ca5-4b87-b5b3-d18da8076053',
  checkoutId: 'bill_old',
  externalId: 'qoro-initial-synthetic',
  productId: 'prod_one',
  expectedAmountMinor: 19700,
};
function setup() {
  const state = {
    closed: false,
    status: 'PENDING',
    paidAmount: null as number | null,
    customerId: null as string | null,
    amount: 19700,
    productId: 'prod_one',
    devMode: true,
    store: 'store_synthetic',
    subs: false,
    keepListed: false,
    lostResponse: false,
    paidDuringClosure: false,
    hasMore: false,
    wrongReference: false,
  };
  const fetcher = vi.fn<typeof fetch>(async (urlInput, init) => {
    const u = new URL(String(urlInput));
    const reply = (data: unknown) => Response.json({ success: true, data });
    if (init?.method === 'POST') {
      expect(u.pathname).toBe('/v2/subscriptions/checkouts/delete');
      expect(u.searchParams.get('id')).toBe(input.checkoutId);
      state.closed = true;
      if (state.paidDuringClosure) state.paidAmount = 19700;
      if (state.lostResponse) throw new Error('Synthetic lost acknowledgement');
      return reply({ id: input.checkoutId, devMode: state.devMode });
    }
    if (u.pathname.endsWith('/stores/get')) return reply({ id: state.store });
    if (u.pathname.endsWith('/products/get'))
      return reply({
        id: u.searchParams.get('id'),
        externalId: 'synthetic',
        price: 19700,
        currency: 'BRL',
        devMode: state.devMode,
        cycle: 'MONTHLY',
        trialDays: null,
      });
    if (u.pathname.endsWith('/checkouts/get'))
      return reply({
        id: input.checkoutId,
        frequency: 'SUBSCRIPTION',
        customerId: state.customerId,
        status: state.status,
        devMode: state.devMode,
        amount: state.amount,
        paidAmount: state.paidAmount,
        items: [{ id: state.productId, quantity: 1 }],
      });
    if (u.pathname.endsWith('/checkouts/list'))
      return Response.json({
        success: true,
        data:
          state.closed && !state.keepListed
            ? []
            : [
                {
                  id: input.checkoutId,
                  externalId: state.wrongReference ? 'wrong' : input.externalId,
                  devMode: state.devMode,
                },
              ],
        pagination: { hasMore: state.hasMore, next: null },
      });
    if (u.pathname.endsWith('/subscriptions/list'))
      return Response.json({
        success: true,
        data: state.subs
          ? [
              {
                id: 'subs_existing',
                checkoutId: input.checkoutId,
                customerId: 'cust_existing',
                amount: 19700,
                status: 'ACTIVE',
                method: 'CARD',
                devMode: true,
                trialEndsAt: null,
              },
            ]
          : [],
        pagination: { hasMore: false, next: null },
      });
    throw new Error('Unexpected route');
  });
  const commands = createAbacatePayCommands(
    {
      apiKey: 'synthetic',
      environment: 'sandbox',
      storeId: 'store_synthetic',
      probeProductId: 'prod_probe',
    },
    new TestCommandJournal(),
    fetcher,
  );
  const posts = () => fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  return { state, commands, posts };
}
describe('unpaid checkout closure before a corrective replacement', () => {
  it('deletes once, accepts readable PENDING GET only with absent listing and no subscription', async () => {
    const f = setup();
    expect(await f.commands.closeUnpaidCheckout(input)).toEqual({
      checkoutId: input.checkoutId,
      productId: input.productId,
      amountMinor: 19700,
      closed: true,
    });
    await f.commands.closeUnpaidCheckout(input);
    expect(f.posts()).toHaveLength(1);
  });
  for (const name of [
    'status',
    'paidAmount',
    'customerId',
    'amount',
    'productId',
    'devMode',
    'store',
    'subs',
    'hasMore',
    'wrongReference',
  ] as const) {
    it(`refuses ${name} mismatch before any DELETE`, async () => {
      const f = setup();
      switch (name) {
        case 'status':
          f.state.status = 'PAID';
          break;
        case 'paidAmount':
          f.state.paidAmount = 1;
          break;
        case 'customerId':
          f.state.customerId = 'cust_unsettled';
          break;
        case 'amount':
          f.state.amount = 39700;
          break;
        case 'productId':
          f.state.productId = 'prod_other';
          break;
        case 'devMode':
          f.state.devMode = false;
          break;
        case 'store':
          f.state.store = 'store_other';
          break;
        case 'subs':
          f.state.subs = true;
          break;
        case 'hasMore':
          f.state.hasMore = true;
          break;
        case 'wrongReference':
          f.state.wrongReference = true;
          break;
      }
      await expect(f.commands.closeUnpaidCheckout(input)).rejects.toThrow();
      expect(f.posts()).toHaveLength(0);
    });
  }
  for (const failure of ['keepListed', 'lostResponse', 'paidDuringClosure'] as const) {
    it(`does not retry an ambiguous DELETE (${failure})`, async () => {
      const f = setup();
      f.state[failure] = true;
      await expect(f.commands.closeUnpaidCheckout(input)).rejects.toThrow();
      await expect(
        f.commands.closeUnpaidCheckout({ ...input, operationId: input.operationId }),
      ).rejects.toThrow();
      expect(f.posts()).toHaveLength(1);
    });
  }
});

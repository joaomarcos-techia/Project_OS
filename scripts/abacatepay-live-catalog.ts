/** Catalog-only operator. No checkout, subscription, payment or webhook mutations. */
import { z } from 'zod';
import {
  OFFER_2026_PLAN_CODES,
  quoteProposedOffer,
  type Offer2026PlanCode,
} from '../src/contexts/billing/proposed-offer';

export const liveProductSchema = z.object({
  id: z.string().regex(/^prod_[A-Za-z0-9_-]+$/),
  externalId: z.string().min(1),
  name: z.string().min(1),
  price: z.number().int().positive(),
  currency: z.literal('BRL'),
  cycle: z.literal('MONTHLY'),
  devMode: z.literal(false),
  status: z.literal('ACTIVE'),
  trialDays: z.null().optional(),
});
export type LiveProduct = z.infer<typeof liveProductSchema>;
export interface LiveProductInput {
  externalId: string;
  name: string;
  price: number;
  currency: 'BRL';
  cycle: 'MONTHLY';
}
export function liveCatalogSpecification(): {
  plan: Offer2026PlanCode;
  doctors: number;
  staff: number;
  input: LiveProductInput;
}[] {
  return OFFER_2026_PLAN_CODES.map((plan, index) => {
    const doctors = index + 1;
    const quote = quoteProposedOffer(doctors, 3);
    if (!quote) throw new Error('Approved monthly quote unavailable');
    return {
      plan,
      doctors,
      staff: quote.staffLogins,
      input: {
        externalId: `qoro-2026-${plan}-monthly`,
        name: doctors === 1 ? 'Qoro Consultório — 1 médico' : `Qoro Clínica — ${doctors} médicos`,
        price: quote.monthly * 100,
        currency: 'BRL',
        cycle: 'MONTHLY',
      },
    };
  });
}
export interface CatalogOnlyOperations {
  readStore(): Promise<unknown>;
  listProducts(): Promise<unknown>;
  createProduct(input: LiveProductInput): Promise<unknown>;
  /** Durably save BEFORE sending a POST; unknown outcomes require GET reconciliation. */
  started(externalId: string): Promise<void>;
  confirmed(product: LiveProduct): Promise<void>;
}
function validateProduct(raw: unknown, expected: LiveProductInput): LiveProduct {
  const product = liveProductSchema.parse(raw);
  for (const key of ['externalId', 'name', 'price', 'currency', 'cycle'] as const)
    if (product[key] !== expected[key])
      throw new Error('Live product differs from approved catalog');
  return product;
}
/** Exact store/mode and all existing matches are checked before the first write.
 * A journaled unknown POST is NEVER replayed, even after a process restart.
 */
export async function ensureMonthlyLiveCatalog(
  expectedStoreId: string,
  operations: CatalogOnlyOperations,
  previouslyStarted: ReadonlySet<string>,
): Promise<LiveProduct[]> {
  z.string()
    .regex(/^store_[A-Za-z0-9_-]+$/)
    .parse(expectedStoreId);
  const store = z.object({ id: z.string() }).parse(await operations.readStore());
  if (store.id !== expectedStoreId) throw new Error('Unexpected live store');
  const listed = z
    .array(z.object({ externalId: z.string() }).passthrough())
    .parse(await operations.listProducts());
  const specification = liveCatalogSpecification();
  const existing = new Map<string, LiveProduct>();
  for (const { input } of specification) {
    const matches = listed.filter((product) => product.externalId === input.externalId);
    if (matches.length > 1) throw new Error('Duplicate live product identity');
    if (matches[0]) existing.set(input.externalId, validateProduct(matches[0], input));
    else if (previouslyStarted.has(input.externalId))
      throw new Error('Unknown live creation outcome; preserve journal and reconcile');
  }
  const result: LiveProduct[] = [];
  for (const { input } of specification) {
    const saved = existing.get(input.externalId);
    if (saved) {
      await operations.confirmed(saved);
      result.push(saved);
      continue;
    }
    await operations.started(input.externalId);
    const product = validateProduct(await operations.createProduct(input), input);
    await operations.confirmed(product);
    result.push(product);
  }
  if (new Set(result.map((product) => product.id)).size !== result.length)
    throw new Error('Live product IDs are not distinct');
  return result;
}

/** Preparation/readback validation only. No network, deployment or configuration writes. */
import assert from 'node:assert/strict';
import { z } from 'zod';

export const GATE_B_PROJECT = 'prj_GYB0Y9e02ka9jurpJvF6m0feH3eZ';
export const GATE_B_TEAM = 'team_ml9fFeF262JqUMwFB6Vy61Cj';
export const GATE_B_ACQUISITION_ROUTES = ['/api/signup/sessions', '/api/signup/checkout'] as const;

// Official Vercel SDK contract, source 35df178c629776dfd204660b562c983c6969ccc9,
// src/models/updatefirewallconfigop.ts. This is a proposed PATCH body, never sent here.
export function buildGateBFirewallProposal() {
  return {
    action: 'rules.insert',
    value: {
      name: 'Qoro Gate B — aquisição temporariamente fechada',
      active: true,
      conditionGroup: GATE_B_ACQUISITION_ROUTES.map((route) => ({
        conditions: [
          { type: 'environment', op: 'eq', value: 'production' },
          { type: 'method', op: 'eq', value: 'POST' },
          { type: 'route', op: 'eq', value: route },
        ],
      })),
      action: { mitigate: { action: 'deny' } },
    },
  };
}

export function assertGateBContainmentConfiguration(input: unknown) {
  const snapshot = z
    .object({
      projectId: z.literal(GATE_B_PROJECT),
      teamId: z.literal(GATE_B_TEAM),
      deploymentId: z.string().regex(/^dpl_[A-Za-z0-9]+$/u),
      closureRuleId: z.string().min(1),
      firewall: z.object({
        firewallEnabled: z.literal(true),
        version: z.number().int().nonnegative(),
        rules: z.array(z.unknown()).min(1),
      }),
      // Values read from the actual deployment, not only saved project settings.
      deploymentFlags: z
        .object({
          SIGNUP_ENABLED: z.literal('false'),
          SAAS_SIGNUP_PROVIDER: z.literal('asaas'),
          ABACATEPAY_NEW_CHECKOUTS_ENABLED: z.literal('false'),
          ABACATEPAY_CHECKOUT_CLINIC_IDS: z.literal(''),
          ABACATEPAY_ENVIRONMENT: z.null(),
        })
        .strict(),
    })
    .parse(input);
  const first = z
    .object({
      id: z.string(),
      active: z.literal(true),
      conditionGroup: z.unknown(),
      action: z.object({ mitigate: z.object({ action: z.literal('deny') }) }),
    })
    .parse(snapshot.firewall.rules[0]);
  assert.equal(first.id, snapshot.closureRuleId, 'Containment must precede custom bypass rules');
  assert.deepEqual(
    first.conditionGroup,
    buildGateBFirewallProposal().value.conditionGroup,
    'Environment/method/resolved-route conditions differ',
  );
  return {
    status: 'CONFIGURATION_MATCHES_CLOSED_GATE_B_REQUIRES_LIVE_PROBES',
    deploymentId: snapshot.deploymentId,
    firewallVersion: snapshot.firewall.version,
    closureRuleId: first.id,
    liveProbeVerified: false,
    productionWrites: 0,
  } as const;
}

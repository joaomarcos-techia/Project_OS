import { describe, expect, it } from 'vitest';
import {
  assertGateBContainmentConfiguration,
  buildGateBFirewallProposal,
  GATE_B_PROJECT,
  GATE_B_TEAM,
} from '../../../../scripts/gate-b-containment';

const fixture = () => ({
  projectId: GATE_B_PROJECT,
  teamId: GATE_B_TEAM,
  deploymentId: 'dpl_synthetic',
  closureRuleId: 'rule_synthetic_closure',
  firewall: {
    firewallEnabled: true,
    version: 4,
    rules: [{ id: 'rule_synthetic_closure', ...buildGateBFirewallProposal().value }],
  },
  deploymentFlags: {
    SIGNUP_ENABLED: 'false',
    SAAS_SIGNUP_PROVIDER: 'asaas',
    ABACATEPAY_NEW_CHECKOUTS_ENABLED: 'false',
    ABACATEPAY_CHECKOUT_CLINIC_IDS: '',
    ABACATEPAY_ENVIRONMENT: null,
  },
});

describe('Gate B reproducible configuration, not live WAF proof', () => {
  it('requires exact Production/method/resolved-route conditions and disarmed deployment flags', () => {
    expect(assertGateBContainmentConfiguration(fixture())).toMatchObject({
      status: 'CONFIGURATION_MATCHES_CLOSED_GATE_B_REQUIRES_LIVE_PROBES',
      liveProbeVerified: false,
      productionWrites: 0,
    });
  });
  it('rejects an earlier custom rule rather than assuming a later deny overrides bypass', () => {
    const input = fixture();
    input.firewall.rules.unshift({ ...input.firewall.rules[0]!, id: 'earlier_bypass' });
    expect(() => assertGateBContainmentConfiguration(input)).toThrow();
  });
  it.each([
    'SIGNUP_ENABLED',
    'ABACATEPAY_NEW_CHECKOUTS_ENABLED',
    'ABACATEPAY_CHECKOUT_CLINIC_IDS',
    'SAAS_SIGNUP_PROVIDER',
  ])('rejects a changed or missing %s in the deployment readback', (key) => {
    const input = fixture();
    Object.assign(input.deploymentFlags, { [key]: 'unexpected' });
    expect(() => assertGateBContainmentConfiguration(input)).toThrow();
    const missing = fixture();
    expect(() =>
      assertGateBContainmentConfiguration({
        ...missing,
        deploymentFlags: Object.fromEntries(
          Object.entries(missing.deploymentFlags).filter(([name]) => name !== key),
        ),
      }),
    ).toThrow();
  });
  it('rejects armed runtime, wrong project/team and a disabled firewall', () => {
    const input = fixture();
    expect(() =>
      assertGateBContainmentConfiguration({
        ...input,
        deploymentFlags: { ...input.deploymentFlags, ABACATEPAY_ENVIRONMENT: 'production' },
      }),
    ).toThrow();
    expect(() =>
      assertGateBContainmentConfiguration({ ...input, projectId: 'another_project' }),
    ).toThrow();
    expect(() =>
      assertGateBContainmentConfiguration({ ...input, teamId: 'another_team' }),
    ).toThrow();
    expect(() =>
      assertGateBContainmentConfiguration({
        ...input,
        firewall: { ...input.firewall, firewallEnabled: false },
      }),
    ).toThrow();
  });
  it.each(['header', 'path', 'raw_path'])(
    'does not substitute %s for framework-resolved route',
    (type) => {
      const input = fixture();
      input.firewall.rules[0]!.conditionGroup[0]!.conditions[2]!.type = type;
      expect(() => assertGateBContainmentConfiguration(input)).toThrow();
    },
  );
  it('rejects Preview, non-POST, extra routes and log-only mitigation', () => {
    for (const [index, value] of [
      [0, 'preview'],
      [1, 'GET'],
      [2, '/api/webhooks/asaas'],
    ] as const) {
      const input = fixture();
      input.firewall.rules[0]!.conditionGroup[0]!.conditions[index]!.value = value;
      expect(() => assertGateBContainmentConfiguration(input)).toThrow();
    }
    const input = fixture();
    input.firewall.rules[0]!.action.mitigate.action = 'log';
    expect(() => assertGateBContainmentConfiguration(input)).toThrow();
  });
});

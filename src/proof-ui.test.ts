import { describe, expect, it } from 'vitest';
import { AnomalyType } from './domain';
import { comparePlantedToCaught, displayedLeakTotal, friendlyLabel, matchExplanation } from './proof';
import type { Finding, ReconciliationResult } from './reconzero-api';

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'finding-1', orderId: 'ORD-1', type: 'EXCESS_FEE', leakedPaise: 7, delayedPaise: 0,
  description: 'fixture', evidence: [], ...overrides,
});
const result = (findings: Finding[]): ReconciliationResult => ({ matchPercentage: 100, leakedByType: {}, delayedPaise: 0, findings });
const ledger = (planted: SyntheticLedger['manifest']['planted']): SyntheticLedger => ({ orders: [], transactions: [], settlements: [], bankStatement: [], manifest: { seed: 1, enabled: true, planted } });

import type { SyntheticLedger } from './domain';

describe('proof presentation', () => {
  it('maps every manifest and public type to a friendly label', () => {
    expect(Object.values(AnomalyType).map(friendlyLabel)).toEqual([
      'Excess fee', 'Not settled', 'Late settlement', 'Duplicate refund', 'Refund over order', 'Rounding leak',
    ]);
  });

  it('does not report Match when an unexpected finding shares the displayed type', () => {
    const planted = { type: AnomalyType.EXCESS_FEE, order_id: 'ORD-1', amount_paise: 7, detail: 'fee' };
    const comparison = comparePlantedToCaught(ledger([planted]), result([
      finding(), finding({ id: 'finding-2', orderId: 'ORD-2' }),
    ]));
    expect(comparison.rows.find((row) => row.type === AnomalyType.EXCESS_FEE)?.status).toBe('MISSED');
    expect(comparison.unexpected).toHaveLength(1);
  });

  it('keeps unsettled principal out of the displayed leak total and explains the match rate', () => {
    const comparison = displayedLeakTotal({ ...result([
      finding({ type: 'NOT_SETTLED', leakedPaise: 263985 }),
      finding({ id: 'finding-2', type: 'EXCESS_FEE', leakedPaise: 37 }),
    ]), leakedByType: { NOT_SETTLED: 263985, EXCESS_FEE: 37 } });
    expect(comparison).toBe(37);
    expect(matchExplanation(result([
      finding({ type: 'NOT_SETTLED' }),
      finding({ id: 'finding-2', orderId: 'ORD-2', type: 'ROUNDING_LEAK' }),
    ]), 100)).toBe('98 of 100 orders fully reconciled · 2 affected by findings');
  });
});

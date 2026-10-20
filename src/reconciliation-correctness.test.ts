import { describe, expect, it } from 'vitest';
import { generateSyntheticLedger } from './generator/synthetic-ledger';
import { reconcile } from './reconciliation/engine';

describe('reconciliation correctness', () => {
  it('suppresses the settlement duplicate for one excess fee', () => {
    const ledger = generateSyntheticLedger({ seed: 42, orderCount: 100 });
    const result = reconcile(ledger);
    const excess = result.findings.filter((finding) => finding.type === 'EXCESS_FEE');
    expect(excess).toHaveLength(1);
    expect(excess[0]).toMatchObject({ orderId: 'ORD-00003', leakedPaise: 37 });
    expect(result.leakedByType.EXCESS_FEE).toBe(37);
  });

  it('reports the missing settlement net in both the finding and manifest', () => {
    const ledger = generateSyntheticLedger({ seed: 42, orderCount: 100 });
    const planted = ledger.manifest.planted.find((item) => item.type === 'MISSING_SETTLEMENT')!;
    const capture = ledger.transactions.find((row) => row.transaction_id === planted.transaction_id)!;
    const expectedNet = capture.amount_paise - capture.fee_amount_paise;
    const finding = reconcile(ledger).findings.find((item) => item.type === 'NOT_SETTLED')!;
    expect(planted.amount_paise).toBe(expectedNet);
    expect(finding.leakedPaise).toBe(expectedNet);
  });

  it('keeps the seed 42 order-count proof totals stable', () => {
    const ledger = generateSyntheticLedger({ seed: 42, orderCount: 100 });
    const result = reconcile(ledger);
    expect(result.findings).toHaveLength(10);
    expect(result.findings.filter((finding) => finding.type === 'EXCESS_FEE')).toHaveLength(1);
    expect(result.findings.filter((finding) => finding.type === 'NOT_SETTLED')).toHaveLength(1);
    expect(result.findings.filter((finding) => finding.type === 'LATE_SETTLEMENT')).toHaveLength(1);
    expect(result.findings.filter((finding) => finding.type === 'DUPLICATE_REFUND')).toHaveLength(2);
    expect(result.findings.filter((finding) => finding.type === 'ROUNDING_LEAK')).toHaveLength(5);
    expect(result.leakedByType.EXCESS_FEE).toBe(37);
    expect(result.leakedByType.DUPLICATE_REFUND).toBe(1001);
    expect(result.leakedByType.ROUNDING_LEAK).toBe(30);
    expect(result.findings.filter((finding) => finding.type !== 'NOT_SETTLED')
      .reduce((total, finding) => total + finding.leakedPaise, 0)).toBe(1068);
    expect(result.matchPercentage).toBe(91);
  });
});

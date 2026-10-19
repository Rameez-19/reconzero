import { describe, expect, it } from 'vitest';
import { getApi } from './reconzero-api';
import {
  AnomalyType, TransactionType, expectedFeePaise, generateSyntheticLedger,
  type SyntheticLedger,
} from './domain';
import { CsvValidationError } from './reconciliation';

const api = getApi();
const clean = (seed = 42, orderCount = 30) => generateSyntheticLedger({ seed, orderCount, anomalies: false });
const anomalous = (seed = 42, orderCount = 30) => generateSyntheticLedger({ seed, orderCount, anomalies: true });
const result = (ledger: SyntheticLedger, asOfDate?: string) => api.reconcile({ ...ledger, asOfDate });
const findingsFor = (ledger: SyntheticLedger, type: string) => result(ledger).findings.filter((f) => f.type === type);

describe('ReconZero contract and anomaly manifest', () => {
  it('detects every planted anomaly, without deriving expectations from engine output', () => {
    const ledger = anomalous(42, 30);
    const planted = new Set(ledger.manifest.planted.map((x) => x.type));
    const detected = new Set(result(ledger).findings.map((x) => x.type));
    // The public finding enum calls both missing/expired settlement "NOT_SETTLED"
    // and both refund violations "DUPLICATE_REFUND"; the manifest keeps the
    // more specific planted reason.
    const expectedPublicTypes = new Set([...planted].map((type) =>
      type === AnomalyType.MISSING_SETTLEMENT ? 'NOT_SETTLED' :
      type === AnomalyType.REFUND_OVER_ORDER ? 'DUPLICATE_REFUND' : type));
    expect(ledger.manifest.enabled).toBe(true);
    expect([...planted]).toEqual(expect.arrayContaining([
      AnomalyType.EXCESS_FEE, AnomalyType.MISSING_SETTLEMENT, AnomalyType.LATE_SETTLEMENT,
      AnomalyType.DUPLICATE_REFUND, AnomalyType.REFUND_OVER_ORDER, AnomalyType.ROUNDING_LEAK,
    ]));
    expect([...expectedPublicTypes].every((type) => detected.has(type))).toBe(true);
  });

  it('has zero findings when anomalies are disabled', () => {
    const ledger = clean(7, 40);
    expect(ledger.manifest.planted).toHaveLength(0);
    expect(result(ledger).findings).toEqual([]);
  });

  it('reports malformed CSV as a clear validation error, not a crash', () => {
    const ledger = clean();
    const bad = { ...ledger, orders: 'order_id,not_the_contract\nORD-1' };
    expect(() => api.reconcile(bad)).toThrow(CsvValidationError);
    try { api.reconcile(bad); } catch (error) {
      expect(error).toMatchObject({ name: 'CsvValidationError', ledger: 'orders', row: 1 });
      expect((error as Error).message).toMatch(/header|CSV/i);
    }
  });

  it('is deterministic for the same seed and changes for a different seed', () => {
    expect(generateSyntheticLedger({ seed: 123 })).toEqual(generateSyntheticLedger({ seed: 123 }));
    expect(generateSyntheticLedger({ seed: 123 })).not.toEqual(generateSyntheticLedger({ seed: 124 }));
  });

  it('uses integer round-half-up fee arithmetic', () => {
    expect(expectedFeePaise(25, 200)).toBe(1); // 0.5 paise rounds upward
    expect(expectedFeePaise(26, 200)).toBe(1);
    expect(expectedFeePaise(24, 200)).toBe(0);
    expect(Number.isInteger(expectedFeePaise(12345, 237))).toBe(true);
  });

  it('reports excess fee by the fee amount over the contracted fee', () => {
    const ledger = anomalous(42, 30);
    const finding = findingsFor(ledger, 'EXCESS_FEE')[0];
    const planted = ledger.manifest.planted.find((x) => x.type === AnomalyType.EXCESS_FEE)!;
    expect(finding.orderId).toBe(planted.order_id);
    expect(finding.leakedPaise).toBe(planted.amount_paise);
  });

  it('allows legitimate partial refunds but flags duplicate and overflow refunds', () => {
    const ledger = clean(9, 3);
    const order = ledger.orders[0];
    const capture = ledger.transactions[0];
    const partial = { transaction_id: 'REF-PARTIAL', order_id: order.order_id, transaction_type: TransactionType.REFUND,
      amount_paise: Math.floor(order.gross_amount_paise / 4), fee_amount_paise: 0, transaction_at: order.order_date,
      settlement_batch_id: capture.settlement_batch_id };
    const valid: SyntheticLedger = { ...ledger, transactions: [...ledger.transactions, partial] };
    expect(findingsFor(valid, 'DUPLICATE_REFUND')).toHaveLength(0);

    const duplicate: SyntheticLedger = { ...valid, transactions: [...valid.transactions,
      { ...partial, transaction_id: 'REF-DUP' }] };
    expect(findingsFor(duplicate, 'DUPLICATE_REFUND').length).toBeGreaterThan(0);

    const overflow: SyntheticLedger = { ...ledger, transactions: [...ledger.transactions,
      { ...partial, transaction_id: 'REF-OVER', amount_paise: order.gross_amount_paise + 1 }] };
    expect(findingsFor(overflow, 'DUPLICATE_REFUND').length).toBeGreaterThan(0);
  });

  it('distinguishes missing settlement from late settlement', () => {
    const ledger = anomalous(42, 30);
    const missing = ledger.manifest.planted.find((x) => x.type === AnomalyType.MISSING_SETTLEMENT)!;
    const late = ledger.manifest.planted.find((x) => x.type === AnomalyType.LATE_SETTLEMENT)!;
    expect(result(ledger).findings.some((f) => f.type === 'NOT_SETTLED' && f.orderId === missing.order_id)).toBe(true);
    expect(result(ledger).findings.some((f) => f.type === 'LATE_SETTLEMENT' && f.orderId === late.order_id)).toBe(true);
  });

  it('reports each per-batch 1+ paise shortfall as a rounding leak', () => {
    const ledger = anomalous(42, 30);
    const planted = ledger.manifest.planted.find((x) => x.type === AnomalyType.ROUNDING_LEAK)!;
    const finding = findingsFor(ledger, 'ROUNDING_LEAK').find((f) =>
      f.evidence.some((e) => e.value.includes(planted.settlement_batch_id!)));
    expect(finding).toBeDefined();
    expect(finding!.leakedPaise).toBe(planted.amount_paise);
  });

  it('puts late settlement amount in delayed, never leaked', () => {
    const ledger = anomalous(42, 30);
    const late = result(ledger).findings.find((f) => f.type === 'LATE_SETTLEMENT')!;
    expect(late.delayedPaise).toBeGreaterThan(0);
    expect(late.leakedPaise).toBe(0);
    expect(result(ledger).delayedPaise).toBeGreaterThanOrEqual(late.delayedPaise);
  });

  it('defines match percentage as orders without findings divided by total orders', () => {
    const ledger = anomalous(42, 30);
    const reconciliation = result(ledger);
    const affected = new Set(reconciliation.findings.map((f) => f.orderId));
    expect(reconciliation.matchPercentage).toBe(((ledger.orders.length - affected.size) / ledger.orders.length) * 100);
    expect(result(clean(42, 30)).matchPercentage).toBe(100);
  });
});

import { AnomalyType, type PlantedAnomaly, type SyntheticLedger } from './domain';
import type { Finding, FindingType, ReconciliationResult } from './reconzero-api';

export const proofTypes: AnomalyType[] = [AnomalyType.EXCESS_FEE, AnomalyType.MISSING_SETTLEMENT, AnomalyType.LATE_SETTLEMENT, AnomalyType.DUPLICATE_REFUND, AnomalyType.REFUND_OVER_ORDER, AnomalyType.ROUNDING_LEAK];
export interface ProofRow { type: AnomalyType; plantedCount: number; caughtCount: number; plantedPaise: number; caughtPaise: number; status: 'MATCH' | 'MISSED'; }
export interface ProofComparison { rows: ProofRow[]; missed: PlantedAnomaly[]; unexpected: Finding[]; delayedPaise: number; }

/** User-facing names for both manifest-specific and public finding types. */
export const friendlyLabels: Record<AnomalyType | FindingType, string> = {
  EXCESS_FEE: 'Excess fee',
  MISSING_SETTLEMENT: 'Not settled',
  NOT_SETTLED: 'Not settled',
  LATE_SETTLEMENT: 'Late settlement',
  DUPLICATE_REFUND: 'Duplicate refund',
  REFUND_OVER_ORDER: 'Refund over order',
  ROUNDING_LEAK: 'Rounding leak',
};

export const friendlyLabel = (type: string): string => friendlyLabels[type as AnomalyType | FindingType] ?? 'Other finding';

/** Refund overflow is emitted under the engine's duplicate-refund rule. */
export const findingLabel = (finding: Pick<Finding, 'type' | 'description'>): string =>
  finding.type === 'DUPLICATE_REFUND' && finding.description === 'Refunds exceed net order amount'
    ? friendlyLabel(AnomalyType.REFUND_OVER_ORDER)
    : friendlyLabel(finding.type);

/** Late settlement is delayed money, so show that amount instead of a zero leak. */
export const findingDisplayPaise = (finding: Pick<Finding, 'type' | 'leakedPaise' | 'delayedPaise'>): number =>
  finding.type === 'LATE_SETTLEMENT' ? finding.delayedPaise : finding.leakedPaise;

export const findingBadgeClass = (finding: Pick<Finding, 'type' | 'description'>): string =>
  findingLabel(finding).toLowerCase().replaceAll(' ', '_');

/** Leak total excludes unsettled principal, which is shown in its own row. */
export const displayedLeakTotal = (result: ReconciliationResult): number =>
  Object.entries(result.leakedByType).reduce((total, [type, amount]) => type === 'NOT_SETTLED' ? total : total + (amount ?? 0), 0);

export const matchExplanation = (result: ReconciliationResult, orderCount: number): string => {
  const affected = new Set(result.findings.map((finding) => finding.orderId)).size;
  const reconciled = Math.max(0, orderCount - affected);
  return `${reconciled} of ${orderCount} orders fully reconciled · ${affected} affected by findings`;
};

export const hasPlantedRoundingLeak = (comparison: ProofComparison): boolean =>
  comparison.rows.some((row) => row.type === AnomalyType.ROUNDING_LEAK && row.plantedCount > 0);

const publicType = (type: AnomalyType): FindingType => type === AnomalyType.MISSING_SETTLEMENT ? 'NOT_SETTLED' : type === AnomalyType.REFUND_OVER_ORDER ? 'DUPLICATE_REFUND' : type as FindingType;
const describes = (finding: Finding, planted: PlantedAnomaly) => {
  if (planted.order_id && finding.orderId !== planted.order_id) return false;
  if (planted.transaction_id && !finding.evidence.some((e) => e.value.includes(planted.transaction_id!))) return false;
  if (planted.settlement_batch_id && !finding.evidence.some((e) => e.value.includes(planted.settlement_batch_id!))) return false;
  return true;
};

export function comparePlantedToCaught(ledger: SyntheticLedger, result: ReconciliationResult): ProofComparison {
  const used = new Set<string>(); const missed: PlantedAnomaly[] = [];
  const rows = proofTypes.map((type) => {
    const planted = ledger.manifest.enabled ? ledger.manifest.planted.filter((item) => item.type === type) : [];
    const matches: Finding[] = [];
    for (const item of planted) {
      const match = result.findings.find((finding) => !used.has(finding.id) && finding.type === publicType(type) && describes(finding, item));
      if (match) { used.add(match.id); matches.push(match); } else missed.push(item);
    }
    const plantedPaise = planted.reduce((sum, item) => sum + (item.amount_paise ?? 0), 0);
     const caughtPaise = matches.reduce((sum, item) => sum + findingDisplayPaise(item), 0);
    return { type, plantedCount: planted.length, caughtCount: matches.length, plantedPaise, caughtPaise, status: 'MISSED' as const };
  });
  const unexpected = result.findings.filter((finding) => !used.has(finding.id));
  const unexpectedTypes = new Set(unexpected.map((finding) => finding.type));
  return {
    rows: rows.map((row) => ({
      ...row,
      status: row.caughtCount === row.plantedCount && row.caughtPaise === row.plantedPaise && !unexpectedTypes.has(publicType(row.type)) ? 'MATCH' : 'MISSED',
    })),
    missed,
    unexpected,
    delayedPaise: result.delayedPaise,
  };
}

export function isSyntheticLedger(value: unknown): value is SyntheticLedger {
  return !!value && typeof value === 'object' && 'manifest' in value && Array.isArray((value as SyntheticLedger).manifest?.planted);
}

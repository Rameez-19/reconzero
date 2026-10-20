import { AnomalyType, type PlantedAnomaly, type SyntheticLedger } from './domain';
import type { Finding, FindingType, ReconciliationResult } from './reconzero-api';

export const proofTypes: AnomalyType[] = [AnomalyType.EXCESS_FEE, AnomalyType.MISSING_SETTLEMENT, AnomalyType.LATE_SETTLEMENT, AnomalyType.DUPLICATE_REFUND, AnomalyType.REFUND_OVER_ORDER, AnomalyType.ROUNDING_LEAK];
export interface ProofRow { type: AnomalyType; plantedCount: number; caughtCount: number; plantedPaise: number; caughtPaise: number; status: 'MATCH' | 'MISSED'; }
export interface ProofComparison { rows: ProofRow[]; missed: PlantedAnomaly[]; unexpected: Finding[]; delayedPaise: number; }

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
    const caughtPaise = matches.reduce((sum, item) => sum + item.leakedPaise, 0);
    return { type, plantedCount: planted.length, caughtCount: matches.length, plantedPaise, caughtPaise, status: matches.length === planted.length && caughtPaise === plantedPaise ? 'MATCH' as const : 'MISSED' as const };
  });
  return { rows, missed, unexpected: result.findings.filter((finding) => !used.has(finding.id)), delayedPaise: result.delayedPaise };
}

export function isSyntheticLedger(value: unknown): value is SyntheticLedger {
  return !!value && typeof value === 'object' && 'manifest' in value && Array.isArray((value as SyntheticLedger).manifest?.planted);
}

/** Public integration seam. The generator and engine register their public APIs here.
 * The UI intentionally owns no generation or reconciliation business rules. */
export type FindingType = 'EXCESS_FEE' | 'DUPLICATE_REFUND' | 'NOT_SETTLED' | 'ROUNDING_LEAK' | 'LATE_SETTLEMENT';
export interface Evidence { label: string; value: string; }
export interface Finding { id: string; orderId: string; type: FindingType; leakedPaise: number; delayedPaise: number; description: string; evidence: Evidence[]; }
export interface ReconciliationResult { matchPercentage: number; leakedByType: Partial<Record<FindingType, number>>; delayedPaise: number; findings: Finding[]; }
export interface ReconZeroApi { generate(seed: number): unknown; reconcile(input: unknown): ReconciliationResult; }

import { generateSyntheticLedger } from './domain';
import { reconcile } from './reconciliation';

declare global { interface Window { __RECONZERO_API__?: ReconZeroApi; } }

export function getApi(): ReconZeroApi {
  const api = typeof window !== 'undefined' ? window.__RECONZERO_API__ : undefined;
  if (api) return api;
  // The checked-in public generator and engine are the default offline wiring.
  return {
    generate: (seed) => generateSyntheticLedger({ seed }),
    reconcile: (input) => reconcile(input as Parameters<typeof reconcile>[0]),
  };
}

/** Shared, integer-paise contract for the ReconZero demo ledger. */

export enum OrderStatus {
  PAID = "PAID",
  PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED",
  REFUNDED = "REFUNDED",
}

export enum TransactionType {
  CAPTURE = "CAPTURE",
  REFUND = "REFUND",
}

export enum AnomalyType {
  EXCESS_FEE = "EXCESS_FEE",
  MISSING_SETTLEMENT = "MISSING_SETTLEMENT",
  LATE_SETTLEMENT = "LATE_SETTLEMENT",
  DUPLICATE_REFUND = "DUPLICATE_REFUND",
  REFUND_OVER_ORDER = "REFUND_OVER_ORDER",
  ROUNDING_LEAK = "ROUNDING_LEAK",
}

export interface OrderCsvRow {
  order_id: string;
  order_date: string;
  gross_amount_paise: number;
  contracted_bps: number;
  expected_fee_paise: number;
  status: OrderStatus;
}

export interface GatewayTransactionCsvRow {
  transaction_id: string;
  order_id: string;
  transaction_type: TransactionType;
  amount_paise: number;
  fee_amount_paise: number;
  transaction_at: string;
  settlement_batch_id: string | null;
}

export interface GatewaySettlementCsvRow {
  settlement_id: string;
  settlement_batch_id: string;
  transaction_id: string;
  order_id: string;
  gross_amount_paise: number;
  fee_amount_paise: number;
  net_amount_paise: number;
  expected_settlement_date: string;
  settled_at: string;
}

export interface BankStatementCsvRow {
  bank_transaction_id: string;
  settlement_batch_id: string;
  posted_at: string;
  credit_amount_paise: number;
  description: string;
}

export interface PlantedAnomaly {
  type: AnomalyType;
  order_id?: string;
  transaction_id?: string;
  settlement_batch_id?: string;
  amount_paise?: number;
  detail: string;
}

export interface AnomalyManifest {
  seed: number;
  enabled: boolean;
  planted: PlantedAnomaly[];
}

export interface SyntheticLedger {
  orders: OrderCsvRow[];
  transactions: GatewayTransactionCsvRow[];
  settlements: GatewaySettlementCsvRow[];
  bankStatement: BankStatementCsvRow[];
  manifest: AnomalyManifest;
}

export interface LedgerGeneratorOptions {
  seed: number;
  orderCount?: number;
  anomalies?: boolean;
  startDate?: string;
  contractedBps?: number;
}

/** Round half up without ever converting paise to a floating point amount. */
export function expectedFeePaise(grossPaise: number, contractedBps: number): number {
  if (!Number.isSafeInteger(grossPaise) || grossPaise < 0) throw new Error("grossPaise must be a non-negative integer");
  if (!Number.isSafeInteger(contractedBps) || contractedBps < 0) throw new Error("contractedBps must be a non-negative integer");
  return Math.floor((grossPaise * contractedBps + 5_000) / 10_000);
}

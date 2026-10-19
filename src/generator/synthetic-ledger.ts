import {
  AnomalyManifest, AnomalyType, BankStatementCsvRow, GatewaySettlementCsvRow,
  GatewayTransactionCsvRow, LedgerGeneratorOptions, OrderCsvRow, OrderStatus,
  PlantedAnomaly, SyntheticLedger, TransactionType, expectedFeePaise,
} from "../domain/ledger";

const DAY = 86_400_000;

// A small integer-only PRNG makes output reproducible across runtimes.
function rng(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return state >>> 0;
  };
}

function dateAt(base: number, dayOffset: number): string {
  return new Date(base + dayOffset * DAY).toISOString().slice(0, 10);
}

/** Generate a complete, deterministic set of CSV-shaped ledger rows and its anomaly manifest. */
export function generateSyntheticLedger(options: LedgerGeneratorOptions): SyntheticLedger {
  const count = options.orderCount ?? 100;
  if (!Number.isInteger(count) || count < 1) throw new Error("orderCount must be a positive integer");
  const random = rng(options.seed);
  const base = Date.parse(options.startDate ?? "2025-01-01T00:00:00.000Z");
  if (!Number.isFinite(base)) throw new Error("startDate must be an ISO date");
  const bps = options.contractedBps ?? 200;
  const anomaliesEnabled = options.anomalies !== false;
  const orders: OrderCsvRow[] = [];
  const transactions: GatewayTransactionCsvRow[] = [];
  const settlements: GatewaySettlementCsvRow[] = [];
  const bankStatement: BankStatementCsvRow[] = [];
  const planted: PlantedAnomaly[] = [];

  for (let i = 0; i < count; i++) {
    const orderId = `ORD-${String(i + 1).padStart(5, "0")}`;
    const gross = 10_000 + (random() % 490_001); // integer paise
    const fee = expectedFeePaise(gross, bps);
    const orderDate = dateAt(base, i % 30);
    const captureId = `TX-${String(i * 2 + 1).padStart(6, "0")}`;
    const expectedDate = dateAt(base, i % 30 + 2);
    const excess = anomaliesEnabled && i === 2;
    const missing = anomaliesEnabled && i === 7;
    const late = anomaliesEnabled && i === 12;
    const batch = late ? `BATCH-LATE-${String(i + 1).padStart(4, "0")}` : `BATCH-${String(Math.floor(i / 10) + 1).padStart(4, "0")}`;
    const feeAmount = excess ? fee + 37 : fee;
    const net = gross - feeAmount;
    orders.push({ order_id: orderId, order_date: orderDate, gross_amount_paise: gross, contracted_bps: bps, expected_fee_paise: fee, status: OrderStatus.PAID });
    transactions.push({ transaction_id: captureId, order_id: orderId, transaction_type: TransactionType.CAPTURE, amount_paise: gross, fee_amount_paise: feeAmount, transaction_at: orderDate, settlement_batch_id: missing ? null : batch });
    if (!missing) {
      const settledAt = dateAt(base, i % 30 + (late ? 5 : 2));
      settlements.push({ settlement_id: `SET-${String(i + 1).padStart(6, "0")}`, settlement_batch_id: batch, transaction_id: captureId, order_id: orderId, gross_amount_paise: gross, fee_amount_paise: feeAmount, net_amount_paise: net, expected_settlement_date: expectedDate, settled_at: settledAt });
    }
    if (excess) planted.push({ type: AnomalyType.EXCESS_FEE, order_id: orderId, transaction_id: captureId, amount_paise: 37, detail: "Fee exceeds contracted fee by 37 paise" });
    if (missing) planted.push({ type: AnomalyType.MISSING_SETTLEMENT, order_id: orderId, transaction_id: captureId, detail: "Capture has no settlement batch" });
    if (late) planted.push({ type: AnomalyType.LATE_SETTLEMENT, order_id: orderId, transaction_id: captureId, detail: "Settlement posted after expected settlement date" });
  }

  if (anomaliesEnabled) {
    const order = orders[20 % count];
    const capture = transactions.find((t) => t.order_id === order.order_id)!;
    const refundAmount = Math.min(1_000, order.gross_amount_paise);
    const refundId = `TX-${String(count * 2 + 1).padStart(6, "0")}`;
    transactions.push({ transaction_id: refundId, order_id: order.order_id, transaction_type: TransactionType.REFUND, amount_paise: refundAmount, fee_amount_paise: 0, transaction_at: order.order_date, settlement_batch_id: capture.settlement_batch_id });
    transactions.push({ transaction_id: `${refundId}-DUP`, order_id: order.order_id, transaction_type: TransactionType.REFUND, amount_paise: refundAmount, fee_amount_paise: 0, transaction_at: order.order_date, settlement_batch_id: capture.settlement_batch_id });
    planted.push({ type: AnomalyType.DUPLICATE_REFUND, order_id: order.order_id, amount_paise: refundAmount, detail: "Two refund rows have the same order and amount" });
    const overOrder = orders[21 % count];
    const overAmount = overOrder.gross_amount_paise + 1;
    transactions.push({ transaction_id: `${refundId}-OVER`, order_id: overOrder.order_id, transaction_type: TransactionType.REFUND, amount_paise: overAmount, fee_amount_paise: 0, transaction_at: overOrder.order_date, settlement_batch_id: null });
    order.status = OrderStatus.PARTIALLY_REFUNDED;
    overOrder.status = OrderStatus.REFUNDED;
    planted.push({ type: AnomalyType.REFUND_OVER_ORDER, order_id: overOrder.order_id, amount_paise: overAmount - overOrder.gross_amount_paise, detail: `Refund total exceeds order gross by ${overAmount - overOrder.gross_amount_paise} paise` });
  }

  const byBatch = new Map<string, GatewaySettlementCsvRow[]>();
  for (const settlement of settlements) (byBatch.get(settlement.settlement_batch_id) ?? (byBatch.set(settlement.settlement_batch_id, []), byBatch.get(settlement.settlement_batch_id)!)).push(settlement);
  for (const [batch, rows] of byBatch) {
    const sum = rows.reduce((n, row) => n + row.net_amount_paise, 0);
    const batchNumber = Number(batch.slice(-4));
    const leak = anomaliesEnabled && batchNumber % 3 === 1 ? 1 + ((batchNumber * 17) % Math.max(1, rows.length)) : 0;
    const postedAt = batch.startsWith("BATCH-LATE")
      ? rows.reduce((latest, row) => row.settled_at > latest ? row.settled_at : latest, rows[0].settled_at)
      : rows[0].settled_at;
    bankStatement.push({ bank_transaction_id: `BANK-${batch}`, settlement_batch_id: batch, posted_at: postedAt, credit_amount_paise: sum - leak, description: `Gateway settlement ${batch}` });
    if (leak) planted.push({ type: AnomalyType.ROUNDING_LEAK, settlement_batch_id: batch, amount_paise: leak, detail: `Bank credit is short by ${leak} paise versus gateway net` });
  }
  const manifest: AnomalyManifest = { seed: options.seed, enabled: anomaliesEnabled, planted };
  return { orders, transactions, settlements, bankStatement, manifest };
}

import {
  BankStatementCsvRow, GatewaySettlementCsvRow, GatewayTransactionCsvRow,
  OrderCsvRow, OrderStatus, SyntheticLedger, TransactionType, expectedFeePaise,
} from "../domain/ledger";

export type LedgerName = "orders" | "transactions" | "settlements" | "bankStatement";
export type CsvInput<T> = string | readonly T[];
export interface ReconciliationInput {
  orders: CsvInput<OrderCsvRow>;
  transactions: CsvInput<GatewayTransactionCsvRow>;
  settlements: CsvInput<GatewaySettlementCsvRow>;
  bankStatement: CsvInput<BankStatementCsvRow>;
  /** Date used for the expected-settlement-window check (ISO yyyy-mm-dd). */
  asOfDate?: string;
}

export class CsvValidationError extends Error {
  readonly ledger: LedgerName; readonly row: number; readonly column?: string; readonly code: string;
  constructor(message: string, details: { ledger: LedgerName; row: number; column?: string; code?: string }) {
    super(message); this.name = "CsvValidationError"; this.ledger = details.ledger;
    this.row = details.row; this.column = details.column; this.code = details.code ?? "INVALID_VALUE";
  }
}

export type Rule = "EXCESS_FEE" | "DUPLICATE_REFUND" | "NOT_SETTLED" | "ROUNDING_LEAK" | "LATE_SETTLEMENT";
export interface EvidenceRow { ledger: LedgerName; row: unknown; }
export interface EngineFinding {
  id: string; orderId: string; type: Rule; rule: Rule; leakedPaise: number; delayedPaise: number;
  description: string; evidence: { label: string; value: string }[]; evidenceRows: EvidenceRow[];
}
export interface ReconciliationResult {
  matchPercentage: number; leakedByType: Partial<Record<Rule, number>>; delayedPaise: number;
  findings: EngineFinding[];
}

const headers: Record<LedgerName, string[]> = {
  orders: ["order_id", "order_date", "gross_amount_paise", "contracted_bps", "expected_fee_paise", "status"],
  transactions: ["transaction_id", "order_id", "transaction_type", "amount_paise", "fee_amount_paise", "transaction_at", "settlement_batch_id"],
  settlements: ["settlement_id", "settlement_batch_id", "transaction_id", "order_id", "gross_amount_paise", "fee_amount_paise", "net_amount_paise", "expected_settlement_date", "settled_at"],
  bankStatement: ["bank_transaction_id", "settlement_batch_id", "posted_at", "credit_amount_paise", "description"],
};

function csvRows(text: string, ledger: LedgerName): Record<string, string>[] {
  const lines: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); if (row.some(v => v !== "")) lines.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); if (row.some(v => v !== "")) lines.push(row); }
  if (!lines.length) throw new CsvValidationError("CSV is empty", { ledger, row: 1, code: "EMPTY_CSV" });
  const expected = headers[ledger]; const actual = lines[0].map(v => v.trim());
  if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) throw new CsvValidationError(`Invalid ${ledger} header`, { ledger, row: 1, code: "INVALID_HEADER" });
  return lines.slice(1).map((values, n) => Object.fromEntries(expected.map((h, i) => [h, values[i] ?? ""])) as Record<string, string>);
}

const int = (v: string, ledger: LedgerName, row: number, column: string) => {
  if (!/^-?\d+$/.test(v.trim())) throw new CsvValidationError(`Invalid integer in ${column}`, { ledger, row, column, code: "INVALID_INTEGER" });
  const n = Number(v); if (!Number.isSafeInteger(n)) throw new CsvValidationError(`Unsafe integer in ${column}`, { ledger, row, column, code: "UNSAFE_INTEGER" }); return n;
};
const nonNegativeInt = (v: string, ledger: LedgerName, row: number, column: string) => {
  const n = int(v, ledger, row, column);
  if (n < 0) throw new CsvValidationError(`${column} must be non-negative`, { ledger, row, column, code: "INVALID_RANGE" });
  return n;
};
const required = (v: string, ledger: LedgerName, row: number, column: string) => { if (!v.trim()) throw new CsvValidationError(`${column} is required`, { ledger, row, column, code: "REQUIRED" }); return v; };
const date = (v: string, ledger: LedgerName, row: number, column: string) => { required(v, ledger, row, column); if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v)) throw new CsvValidationError(`Invalid date in ${column}`, { ledger, row, column, code: "INVALID_DATE" }); return v; };
const oneOf = <T extends string>(v: string, values: readonly T[], ledger: LedgerName, row: number, column: string): T => { required(v, ledger, row, column); if (!(values as readonly string[]).includes(v)) throw new CsvValidationError(`Invalid ${column}`, { ledger, row, column, code: "INVALID_ENUM" }); return v as T; };

function parse<T>(input: CsvInput<T>, ledger: LedgerName, convert: (r: Record<string, string>, row: number) => T): T[] {
  if (typeof input !== "string") return [...input];
  return csvRows(input, ledger).map((r, i) => convert(r, i + 2));
}
export function parseOrders(input: CsvInput<OrderCsvRow>): OrderCsvRow[] { return parse(input, "orders", (r, n) => ({ order_id: required(r.order_id, "orders", n, "order_id"), order_date: date(r.order_date, "orders", n, "order_date"), gross_amount_paise: nonNegativeInt(r.gross_amount_paise, "orders", n, "gross_amount_paise"), contracted_bps: nonNegativeInt(r.contracted_bps, "orders", n, "contracted_bps"), expected_fee_paise: nonNegativeInt(r.expected_fee_paise, "orders", n, "expected_fee_paise"), status: oneOf(r.status, Object.values(OrderStatus), "orders", n, "status") })); }
export function parseTransactions(input: CsvInput<GatewayTransactionCsvRow>): GatewayTransactionCsvRow[] { return parse(input, "transactions", (r, n) => ({ transaction_id: required(r.transaction_id, "transactions", n, "transaction_id"), order_id: required(r.order_id, "transactions", n, "order_id"), transaction_type: oneOf(r.transaction_type, Object.values(TransactionType), "transactions", n, "transaction_type"), amount_paise: nonNegativeInt(r.amount_paise, "transactions", n, "amount_paise"), fee_amount_paise: nonNegativeInt(r.fee_amount_paise, "transactions", n, "fee_amount_paise"), transaction_at: date(r.transaction_at, "transactions", n, "transaction_at"), settlement_batch_id: r.settlement_batch_id || null })); }
export function parseSettlements(input: CsvInput<GatewaySettlementCsvRow>): GatewaySettlementCsvRow[] { return parse(input, "settlements", (r, n) => ({ settlement_id: required(r.settlement_id, "settlements", n, "settlement_id"), settlement_batch_id: required(r.settlement_batch_id, "settlements", n, "settlement_batch_id"), transaction_id: required(r.transaction_id, "settlements", n, "transaction_id"), order_id: required(r.order_id, "settlements", n, "order_id"), gross_amount_paise: nonNegativeInt(r.gross_amount_paise, "settlements", n, "gross_amount_paise"), fee_amount_paise: nonNegativeInt(r.fee_amount_paise, "settlements", n, "fee_amount_paise"), net_amount_paise: nonNegativeInt(r.net_amount_paise, "settlements", n, "net_amount_paise"), expected_settlement_date: date(r.expected_settlement_date, "settlements", n, "expected_settlement_date"), settled_at: date(r.settled_at, "settlements", n, "settled_at") })); }
export function parseBankStatement(input: CsvInput<BankStatementCsvRow>): BankStatementCsvRow[] { return parse(input, "bankStatement", (r, n) => ({ bank_transaction_id: required(r.bank_transaction_id, "bankStatement", n, "bank_transaction_id"), settlement_batch_id: required(r.settlement_batch_id, "bankStatement", n, "settlement_batch_id"), posted_at: date(r.posted_at, "bankStatement", n, "posted_at"), credit_amount_paise: nonNegativeInt(r.credit_amount_paise, "bankStatement", n, "credit_amount_paise"), description: r.description })); }

function evidence(order: OrderCsvRow | undefined, tx: GatewayTransactionCsvRow[], set: GatewaySettlementCsvRow[], bank: BankStatementCsvRow[]): { evidence: EngineFinding["evidence"]; evidenceRows: EvidenceRow[] } {
  const rows: EvidenceRow[] = []; if (order) rows.push({ ledger: "orders", row: order }); tx.forEach(row => rows.push({ ledger: "transactions", row })); set.forEach(row => rows.push({ ledger: "settlements", row })); bank.forEach(row => rows.push({ ledger: "bankStatement", row }));
  return { evidence: rows.map(x => ({ label: x.ledger, value: JSON.stringify(x.row) })), evidenceRows: rows };
}

export function reconcile(input: ReconciliationInput): ReconciliationResult {
  const orders = parseOrders(input.orders), tx = parseTransactions(input.transactions), settlements = parseSettlements(input.settlements), bank = parseBankStatement(input.bankStatement);
  const findings: EngineFinding[] = []; const add = (rule: Rule, orderId: string, leaked: number, delayed: number, description: string, rows: EvidenceRow[]) => { const e = evidence(orders.find(o => o.order_id === orderId), relatedRows(orderId, rows).filter(x => x.ledger === "transactions").map(x => x.row as GatewayTransactionCsvRow), relatedRows(orderId, rows).filter(x => x.ledger === "settlements").map(x => x.row as GatewaySettlementCsvRow), relatedRows(orderId, rows).filter(x => x.ledger === "bankStatement").map(x => x.row as BankStatementCsvRow)); findings.push({ id: `${rule}-${findings.length + 1}`, orderId, type: rule, rule, leakedPaise: leaked, delayedPaise: delayed, description, ...e }); };
  const byOrder = new Map(orders.map(o => [o.order_id, o])); const txByOrder = new Map<string, GatewayTransactionCsvRow[]>(); tx.forEach(t => (txByOrder.get(t.order_id) ?? (txByOrder.set(t.order_id, []), txByOrder.get(t.order_id)!)).push(t));
  const relatedRows = (orderId: string, rows: EvidenceRow[]): EvidenceRow[] => {
    const orderTransactions = txByOrder.get(orderId) ?? [];
    const orderSettlements = settlements.filter(s => s.order_id === orderId);
    const batchIds = new Set(orderSettlements.map(s => s.settlement_batch_id));
    const orderBank = bank.filter(b => batchIds.has(b.settlement_batch_id));
    const all = [{ ledger: "transactions" as const, row: orderTransactions }, { ledger: "settlements" as const, row: orderSettlements }, { ledger: "bankStatement" as const, row: orderBank }];
    return [...rows, ...all.flatMap(x => x.row.map(row => ({ ledger: x.ledger, row })))].filter((x, i, a) => a.findIndex(y => y.ledger === x.ledger && y.row === x.row) === i);
  };
  for (const [orderId, order] of byOrder) { const ot = txByOrder.get(orderId) ?? [], captures = ot.filter(t => t.transaction_type === TransactionType.CAPTURE), refunds = ot.filter(t => t.transaction_type === TransactionType.REFUND); const orderSet = settlements.filter(s => s.order_id === orderId); const orderBank = bank.filter(b => orderSet.some(s => s.settlement_batch_id === b.settlement_batch_id));
    const expected = expectedFeePaise(order.gross_amount_paise, order.contracted_bps);
    captures.filter(t => t.fee_amount_paise > expected).forEach(t => add("EXCESS_FEE", orderId, t.fee_amount_paise - expected, 0, `Fee exceeds expected fee by ${t.fee_amount_paise - expected} paise`, [{ ledger: "transactions", row: t }]));
    orderSet.filter(s => s.fee_amount_paise > expected).forEach(s => add("EXCESS_FEE", orderId, s.fee_amount_paise - expected, 0, `Settlement fee exceeds expected fee by ${s.fee_amount_paise - expected} paise`, [{ ledger: "settlements", row: s }]));
    const refundGroups = new Map<number, GatewayTransactionCsvRow[]>(); refunds.forEach(r => (refundGroups.get(r.amount_paise) ?? (refundGroups.set(r.amount_paise, []), refundGroups.get(r.amount_paise)!)).push(r)); refundGroups.forEach(group => { if (group.length > 1) add("DUPLICATE_REFUND", orderId, group.slice(1).reduce((n, r) => n + r.amount_paise, 0), 0, "Same-order same-amount duplicate refund rows", group.map(r => ({ ledger: "transactions", row: r }))); });
    const netOrderAmount = (order as OrderCsvRow & { net_order_amount_paise?: number }).net_order_amount_paise ?? order.gross_amount_paise;
    const refundTotal = refunds.reduce((n, r) => n + r.amount_paise, 0); if (refundTotal > netOrderAmount) add("DUPLICATE_REFUND", orderId, refundTotal - netOrderAmount, 0, "Refunds exceed net order amount", refunds.map(r => ({ ledger: "transactions", row: r })));
    const expectedWindow = new Date(`${order.order_date.slice(0, 10)}T00:00:00Z`); expectedWindow.setUTCDate(expectedWindow.getUTCDate() + 2);
    const missing = captures.some(t => !t.settlement_batch_id) || (input.asOfDate !== undefined && captures.length > 0 && orderSet.length === 0 && input.asOfDate >= expectedWindow.toISOString().slice(0, 10)); if (missing) add("NOT_SETTLED", orderId, 0, 0, "Capture is missing a settlement or is past its expected window", [...captures.map(row => ({ ledger: "transactions" as const, row })), ...orderSet.map(row => ({ ledger: "settlements" as const, row }))]);
    orderSet.filter(s => { const b = orderBank.find(x => x.settlement_batch_id === s.settlement_batch_id); return b && b.posted_at.slice(0, 10) > s.expected_settlement_date.slice(0, 10); }).forEach(s => { const b = orderBank.find(x => x.settlement_batch_id === s.settlement_batch_id)!; add("LATE_SETTLEMENT", orderId, 0, s.net_amount_paise, "Bank posted settlement after expected settlement date", [{ ledger: "settlements", row: s }, { ledger: "bankStatement", row: b }]); });
  }
  const batches = new Map<string, GatewaySettlementCsvRow[]>(); settlements.forEach(s => (batches.get(s.settlement_batch_id) ?? (batches.set(s.settlement_batch_id, []), batches.get(s.settlement_batch_id)!)).push(s)); batches.forEach((rows, batch) => { const b = bank.find(x => x.settlement_batch_id === batch); const shortfall = rows.reduce((n, r) => n + r.net_amount_paise, 0) - (b?.credit_amount_paise ?? 0); if (shortfall >= 1 && shortfall <= rows.length) { const orderId = rows[0].order_id; add("ROUNDING_LEAK", orderId, shortfall, 0, `Bank credit is short by ${shortfall} paise`, [...rows.map(row => ({ ledger: "settlements" as const, row })), ...(b ? [{ ledger: "bankStatement" as const, row: b }] : [])]); } });
  const affected = new Set(findings.map(f => f.orderId)); return { matchPercentage: orders.length ? ((orders.length - affected.size) / orders.length) * 100 : 100, leakedByType: findings.reduce((a, f) => { a[f.type] = (a[f.type] ?? 0) + f.leakedPaise; return a; }, {} as Partial<Record<Rule, number>>), delayedPaise: findings.reduce((n, f) => n + f.delayedPaise, 0), findings };
}
export const reconcileLedgers = reconcile;
export const parseCsv = csvRows;

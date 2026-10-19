import { getApi, type Finding, type FindingType, type ReconciliationResult } from './reconzero-api';
import './style.css';

const types: FindingType[] = ['EXCESS_FEE', 'DUPLICATE_REFUND', 'NOT_SETTLED', 'ROUNDING_LEAK'];
const labels: Record<string, string> = { EXCESS_FEE: 'Excess fee', DUPLICATE_REFUND: 'Duplicate refund', NOT_SETTLED: 'Not settled', ROUNDING_LEAK: 'Rounding leak' };
const money = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `<main><header><div class="brand"><span class="mark">RZ</span><div><p class="eyebrow">PAYMENTS CONTROL ROOM</p><h1>Recon<span>Zero</span></h1></div></div><div class="status"><i></i> OFFLINE · LOCAL ONLY</div></header><section class="hero"><p class="eyebrow">RECONCILIATION LAB</p><h2>Find every rupee that<br><em>doesn't belong.</em></h2><p class="lede">Generate a deterministic payment universe, then reconcile gateway records against bank settlement with an explainable evidence trail.</p><div class="controls"><label>Scenario seed<input id="seed" type="number" value="42" min="0" step="1"></label><button id="run">Generate + Reconcile <b>↗</b></button></div><div id="message" class="message" role="status"></div></section><section id="results" hidden></section></main>`;

function render(result: ReconciliationResult) {
  const byType = types.map(t => `<div class="metric"><span>${labels[t]}</span><strong>${money(result.leakedByType[t] ?? 0)}</strong></div>`).join('');
  const rows = result.findings.map((f, i) => `<details class="finding"><summary><span class="num">${String(i + 1).padStart(2, '0')}</span><span class="order">${f.orderId}</span><span class="pill ${f.type.toLowerCase()}">${labels[f.type] ?? f.type}</span><span class="desc">${f.description}</span><span class="amount">${money(f.leakedPaise)}</span></summary><div class="evidence">${f.evidence.map(e => `<div><small>${e.label}</small><span>${e.value}</span></div>`).join('')}</div></details>`).join('');
  const delayed = result.delayedPaise ? `<div class="delayed"><span>Delayed settlement (reported separately)</span><strong>${money(result.delayedPaise)}</strong></div>` : '';
  const empty = result.findings.length === 0 ? '<div class="empty"><strong>Clean reconciliation</strong><span>No anomalies found for this deterministic scenario.</span></div>' : '';
  const results = document.querySelector<HTMLDivElement>('#results')!;
  results.hidden = false;
  results.innerHTML = `<div class="summary"><div class="match"><small>MATCH PERCENTAGE</small><strong>${result.matchPercentage.toFixed(1)}<sup>%</sup></strong><span>orders fully reconciled</span></div><div class="breakdown">${byType}${delayed}</div></div><div class="trail"><div class="trail-head"><div><p class="eyebrow">AUDIT OUTPUT</p><h3>Anomaly evidence trail</h3></div><span>${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}</span></div>${empty}${rows}</div>`;
}

document.querySelector<HTMLButtonElement>('#run')!.addEventListener('click', () => {
  const button = document.querySelector<HTMLButtonElement>('#run')!;
  const message = document.querySelector<HTMLDivElement>('#message')!;
  const seed = Number((document.querySelector<HTMLInputElement>('#seed')!).value);
  if (!Number.isSafeInteger(seed) || seed < 0) { message.textContent = 'Enter a non-negative whole-number seed.'; message.className = 'message error'; return; }
  button.disabled = true; message.textContent = 'Generating deterministic scenario…'; message.className = 'message';
  try { const api = getApi(); render(api.reconcile(api.generate(seed))); message.textContent = 'Reconciliation complete.'; }
  catch (error) { message.textContent = error instanceof Error ? error.message : 'Unable to reconcile this scenario.'; message.className = 'message error'; }
  finally { button.disabled = false; }
});

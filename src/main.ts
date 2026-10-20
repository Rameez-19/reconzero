import { getApi, type FindingType, type ReconciliationResult } from './reconzero-api';
import { comparePlantedToCaught, displayedLeakTotal, friendlyLabel, hasPlantedRoundingLeak, isSyntheticLedger, matchExplanation } from './proof';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import './style.css';
import './proof.css';

const types: FindingType[] = ['EXCESS_FEE', 'DUPLICATE_REFUND', 'NOT_SETTLED', 'LATE_SETTLEMENT', 'ROUNDING_LEAK'];
const money = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `<main><header><div class="brand"><svg class="logo-mark" viewBox="0 0 48 48" role="img" aria-label="ReconZero convergence mark"><title>ReconZero</title><path d="M7 8 24 24M7 40 24 24M41 8 24 24"/><path d="m24 24 6 6 11-14"/></svg><div><p class="eyebrow">PAYMENTS CONTROL ROOM</p><h1>Recon<span>Zero</span></h1></div></div><div class="status"><i></i> LOCAL · NO DATA LEAVES YOUR BROWSER</div></header><section class="hero"><p class="eyebrow">RECONCILIATION LAB</p><h2>Online sellers lose money between <em>orders, gateway and bank.</em></h2><p class="lede">ReconZero reconciles all three records, so you can see exactly where money went missing and why.</p><div class="value-strip"><span><b>01</b>Find leaks</span><span><b>02</b>Separate delays</span><span><b>03</b>Show proof</span></div><div class="controls"><label>Scenario seed<input id="seed" type="number" value="42" min="0" step="1" inputmode="numeric"></label><button id="run" type="button">Generate + Reconcile <b>↗</b></button></div><div id="message" class="message" role="status" aria-live="polite"></div></section><section id="results" aria-live="polite"><div class="empty-state"><div class="empty-icon" aria-hidden="true">◎</div><div><p class="eyebrow">READY WHEN YOU ARE</p><h3>See the money trail in one run</h3><p>Keep the sample seed <strong>42</strong> or enter your own, then click <strong>Generate + Reconcile</strong>. You’ll get a match rate, delayed versus leaked rupees, and proof of what the engine caught.</p><ol><li><span>01</span>Choose or keep the scenario seed</li><li><span>02</span>Run the reconciliation</li><li><span>03</span>Read the proof panel, then expand findings</li></ol></div></div></section></main>`;

function render(result: ReconciliationResult, generated?: unknown) {
  const rows = result.findings.map((f, i) => `<details class="finding"><summary><span class="num">${String(i + 1).padStart(2, '0')}</span><span class="order">${f.orderId}</span><span class="pill ${f.type.toLowerCase()}">${friendlyLabel(f.type)}</span><span class="desc">${f.description}</span><span class="amount">${money(f.leakedPaise)}</span></summary><div class="evidence">${f.evidence.map(e => `<div><small>${e.label}</small><span>${e.value}</span></div>`).join('')}</div></details>`).join('');
  const delayed = result.delayedPaise ? `<div class="delayed"><span>Delayed settlement (reported separately)</span><strong>${money(result.delayedPaise)}</strong></div>` : '';
  const empty = result.findings.length === 0 ? '<div class="empty"><strong>Clean reconciliation</strong><span>No anomalies found for this deterministic scenario.</span></div>' : '';
  const results = document.querySelector<HTMLDivElement>('#results')!;
  results.hidden = false;
  const proof = isSyntheticLedger(generated) ? comparePlantedToCaught(generated, result) : undefined;
  const summaryTypes = proof ? proof.rows.map((row) => ({ label: friendlyLabel(row.type), amount: row.caughtPaise })) : types.map((type) => ({ label: friendlyLabel(type), amount: result.leakedByType[type] ?? 0 }));
  summaryTypes.push({ label: 'Total leaked', amount: displayedLeakTotal(result) });
  const byType = summaryTypes.map(({ label, amount }) => `<div class="metric"><span>${label}</span><strong>${money(amount)}</strong></div>`).join('');
  const roundingLeak = proof ? hasPlantedRoundingLeak(proof) : false;
  const orderCount = isSyntheticLedger(generated) ? generated.orders.length : result.findings.length ? new Set(result.findings.map((finding) => finding.orderId)).size : 0;
  const proofPanel = proof ? `<section class="proof-panel"><div class="trail-head"><div><p class="eyebrow">GENERATED DATA PROOF</p><h3>Can the engine catch what we planted?</h3><p class="proof-intro">This generated scenario has a known set of anomalies. Compare the planted manifest with the engine’s findings below.</p></div><span>generated scenario</span></div>${roundingLeak ? '<p class="proof-note"><strong>Rounding leaks are batch-level discrepancies.</strong> The whole settlement batch is marked unreconciled even when the displayed amount is only the paise shortfall.</p>' : ''}<div class="proof-table"><div class="proof-head"><span>Anomaly type</span><span>Planted</span><span>Caught</span><span>₹ planted</span><span>₹ caught</span><span>Status</span></div>${proof.rows.map((row) => `<div class="proof-row"><span>${friendlyLabel(row.type)}</span><span>${row.plantedCount}</span><span>${row.caughtCount}</span><span>${money(row.plantedPaise)}</span><span>${money(row.caughtPaise)}</span><span class="proof-status ${row.status.toLowerCase()}">${row.status === 'MATCH' ? '✓ Match' : '✕ Missed'}</span></div>`).join('')}</div><div class="proof-money"><span>₹ delayed <strong>${money(proof.delayedPaise)}</strong></span><span>₹ leaked <strong>${money(displayedLeakTotal(result))}</strong></span></div>${proof.missed.length ? `<div class="proof-issues"><strong>Missed anomalies</strong><ul>${proof.missed.map((item) => `<li>${friendlyLabel(item.type)}${item.order_id ? ` · ${item.order_id}` : ''}</li>`).join('')}</ul></div>` : ''}${proof.unexpected.length ? `<div class="proof-issues"><strong>Unexpected findings</strong><ul>${proof.unexpected.map((item) => `<li>${friendlyLabel(item.type)} · ${item.orderId}</li>`).join('')}</ul></div>` : ''}</section>` : '';
  results.innerHTML = `${proofPanel}<div class="summary"><div class="match"><small>MATCH PERCENTAGE</small><strong>${result.matchPercentage.toFixed(1)}<sup>%</sup></strong><span>${orderCount ? matchExplanation(result, orderCount) : 'orders fully reconciled'}</span></div><div class="breakdown">${byType}${delayed}</div></div><div class="trail"><div class="trail-head"><div><p class="eyebrow">AUDIT OUTPUT</p><h3>Anomaly evidence trail</h3></div><span>${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}</span></div>${empty}${rows}</div>`;
}

document.querySelector<HTMLButtonElement>('#run')!.addEventListener('click', () => {
  const button = document.querySelector<HTMLButtonElement>('#run')!;
  const message = document.querySelector<HTMLDivElement>('#message')!;
  const seed = Number((document.querySelector<HTMLInputElement>('#seed')!).value);
  if (!Number.isSafeInteger(seed) || seed < 0) { message.textContent = 'Enter a non-negative whole-number seed to continue.'; message.className = 'message error'; return; }
  button.disabled = true; button.setAttribute('aria-busy', 'true'); message.textContent = 'Generating scenario and checking settlements…'; message.className = 'message loading';
  try { const api = getApi(); const generated = api.generate(seed); render(api.reconcile(generated), generated); message.textContent = 'Reconciliation complete — review the match rate and findings below.'; message.className = 'message success'; }
  catch (error) { message.textContent = error instanceof Error ? `We couldn't complete this run: ${error.message}` : 'We couldn’t complete this run. Check the seed and try again.'; message.className = 'message error'; }
  finally { button.disabled = false; button.removeAttribute('aria-busy'); }
});

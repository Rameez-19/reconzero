import { getApi, type ReconciliationResult } from './reconzero-api';
import { comparePlantedToCaught, displayedLeakTotal, findingBadgeClass, findingDisplayPaise, findingLabel, friendlyLabel, hasPlantedRoundingLeak, isSyntheticLedger, matchExplanation } from './proof';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import './style.css';
import './proof.css';

const money = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `<main><header><a class="brand" href="/" aria-label="ReconZero home"><svg class="logo-mark" viewBox="0 0 48 48" role="img" aria-label="ReconZero convergence mark"><title>ReconZero</title><path d="M7 8 24 24M7 40 24 24M41 8 24 24"/><path d="m24 24 6 6 11-14"/></svg><span><p class="eyebrow">PAYMENTS CONTROL ROOM</p><h1>Recon<span>Zero</span></h1></span></a><div class="header-actions"><span class="status"><i></i> LOCAL-ONLY</span><a class="github-link" href="https://github.com/omnirush/reconzero" target="_blank" rel="noreferrer">GitHub ↗</a></div></header><section class="hero"><p class="eyebrow">RECONCILIATION LAB · DEFAULT SCENARIO: 100 ORDERS</p><h2>Online sellers lose money between <em>orders, gateway and bank.</em></h2><p class="lede">One local reconciliation run shows what leaked, what is at risk, and what is simply late.</p><div class="value-strip"><span><b>01</b>Find leaks</span><span><b>02</b>Separate delays</span><span><b>03</b>Show proof</span></div><div class="controls"><label>Scenario seed<input id="seed" type="number" value="42" min="0" step="1" inputmode="numeric"></label><button id="run" type="button">Generate + Reconcile <b>↗</b></button></div><div id="message" class="message" role="status" aria-live="polite"></div></section><section id="results" aria-live="polite"><div class="empty-state"><div class="empty-icon" aria-hidden="true">◎</div><div><p class="eyebrow">READY WHEN YOU ARE</p><h3>See the money trail in one run</h3><p>Keep the sample seed <strong>42</strong> or enter your own, then click <strong>Generate + Reconcile</strong>. The default scenario contains <strong>100 orders</strong>, with delayed versus leaked rupees and proof of what the engine caught.</p><ol><li><span>01</span>Choose or keep the scenario seed</li><li><span>02</span>Run the reconciliation</li><li><span>03</span>Read the proof panel, then expand findings</li></ol></div></div></section><footer><span>ReconZero runs locally in your browser.</span><a class="github-link" href="https://github.com/omnirush/reconzero" target="_blank" rel="noreferrer">GitHub ↗</a><span>Built with OmniRush</span></footer></main>`;

function render(result: ReconciliationResult, generated?: unknown) {
  const rows = result.findings.map((f, i) => {
    const evidenceGroups = [
      { label: 'Order evidence', entries: f.evidence.filter((e) => e.label === 'orders') },
      { label: 'Gateway evidence', entries: f.evidence.filter((e) => e.label === 'transactions' || e.label === 'settlements') },
      { label: 'Bank evidence', entries: f.evidence.filter((e) => e.label === 'bankStatement') },
    ];
    const evidence = evidenceGroups.map((group) => `<div class="evidence-group"><small>${group.label}</small>${group.entries.length ? group.entries.map((e) => `<span>${e.value}</span>`).join('') : '<span class="evidence-empty">No row</span>'}</div>`).join('');
    const delayed = f.type === 'LATE_SETTLEMENT';
    return `<details class="finding"><summary><span class="num">${String(i + 1).padStart(2, '0')}</span><span class="order">${f.orderId}</span><span class="pill ${findingBadgeClass(f)}">${findingLabel(f)}</span><span class="desc">${f.description}</span><span class="amount ${delayed ? 'delayed-amount' : ''}">${money(findingDisplayPaise(f))}</span></summary><div class="evidence">${evidence}</div></details>`;
  }).join('');
  const empty = result.findings.length === 0 ? '<div class="empty"><strong>Clean reconciliation</strong><span>No anomalies found for this deterministic scenario.</span></div>' : '';
  const results = document.querySelector<HTMLDivElement>('#results')!;
  results.hidden = false;
  const proof = isSyntheticLedger(generated) ? comparePlantedToCaught(generated, result) : undefined;
  const byType = `<div class="metric match-card"><span>Match %</span><strong>${result.matchPercentage.toFixed(1)}%</strong><small>orders fully reconciled</small></div><div class="metric leaked-card"><span>₹ leaked</span><strong>${money(displayedLeakTotal(result))}</strong><small>confirmed money loss</small></div><div class="metric risk-card"><span>₹ at risk · not settled</span><strong>${money(result.leakedByType.NOT_SETTLED ?? 0)}</strong><small>captured, not settled</small></div><div class="metric delayed-card"><span>₹ delayed</span><strong>${money(result.delayedPaise)}</strong><small>late, not lost</small></div>`;
  const roundingLeak = proof ? hasPlantedRoundingLeak(proof) : false;
  const orderCount = isSyntheticLedger(generated) ? generated.orders.length : result.findings.length ? new Set(result.findings.map((finding) => finding.orderId)).size : 0;
  const proofPanel = proof ? `<section class="proof-panel"><div class="trail-head"><div><p class="eyebrow">GENERATED DATA PROOF</p><h3>Can the engine catch what we planted?</h3><p class="proof-intro">This generated scenario has a known set of anomalies. Compare the planted manifest with the engine’s findings below.</p></div><span>generated scenario</span></div>${roundingLeak ? '<p class="proof-note"><strong>Rounding leaks are batch-level discrepancies.</strong> The whole settlement batch is marked unreconciled even when the displayed amount is only the paise shortfall.</p>' : ''}<div class="proof-table"><div class="proof-head"><span>Anomaly type</span><span>Planted</span><span>Caught</span><span>₹ planted</span><span>₹ caught</span><span>Status</span></div>${proof.rows.map((row) => `<div class="proof-row"><span>${friendlyLabel(row.type)}</span><span>${row.plantedCount}</span><span>${row.caughtCount}</span><span>${money(row.plantedPaise)}</span><span class="${row.type === 'LATE_SETTLEMENT' ? 'delayed-amount' : ''}">${money(row.caughtPaise)}</span><span class="proof-status ${row.status.toLowerCase()}">${row.status === 'MATCH' ? '✓ Match' : '✕ Missed'}</span></div>`).join('')}</div><div class="proof-money"><span>₹ delayed <strong>${money(proof.delayedPaise)}</strong></span><span>₹ leaked <strong>${money(displayedLeakTotal(result))}</strong></span></div>${proof.missed.length ? `<div class="proof-issues"><strong>Missed anomalies</strong><ul>${proof.missed.map((item) => `<li>${friendlyLabel(item.type)}${item.order_id ? ` · ${item.order_id}` : ''}</li>`).join('')}</ul></div>` : ''}${proof.unexpected.length ? `<div class="proof-issues"><strong>Unexpected findings</strong><ul>${proof.unexpected.map((item) => `<li>${friendlyLabel(item.type)} · ${item.orderId}</li>`).join('')}</ul></div>` : ''}</section>` : '';
  results.innerHTML = `${proofPanel}<div class="summary"><div class="summary-heading"><p class="eyebrow">RECONCILIATION SUMMARY</p><h3>Where the money stands</h3><p>${orderCount ? matchExplanation(result, orderCount) : 'orders fully reconciled'}</p></div><div class="breakdown">${byType}</div></div><div class="trail"><div class="trail-head"><div><p class="eyebrow">AUDIT OUTPUT</p><h3>Anomaly evidence trail</h3></div><span>${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}</span></div>${empty}${rows}</div>`;
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

const $ = (s) => document.querySelector(s);

let config = { billing: 'demo', bankConnect: 'not-configured', pro: false, freeTierLimit: 3 };

const aud = (n) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

function toast(msg, kind = 'ok', ms = 5000) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), ms);
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// ---------- data sources ----------
$('#fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  try {
    const out = await api('/api/statement', { method: 'POST', body: form });
    toast(`Parsed ${out.transactionCount} transactions`);
    loadAnalysis();
  } catch (err) {
    toast(err.message, 'err', 8000);
  }
  e.target.value = '';
});

$('#sampleBtn').addEventListener('click', async () => {
  const out = await api('/api/sample', { method: 'POST' });
  toast(`Loaded sample statement (${out.transactionCount} transactions)`);
  loadAnalysis();
});

$('#bankConnectBtn').addEventListener('click', async () => {
  try {
    const out = await api('/api/bank/connect', { method: 'POST' });
    window.open(out.consentUrl, '_blank');
    toast('Complete the bank consent in the new tab, then click Connect bank again to sync.');
    // try syncing after consent
    setTimeout(async () => {
      try {
        const sync = await api('/api/bank/sync', { method: 'POST' });
        if (sync.ok) {
          toast(`Synced ${sync.transactionCount} transactions from your bank`);
          loadAnalysis();
        }
      } catch { /* not connected yet */ }
    }, 4000);
  } catch (err) {
    toast(err.message, 'err', 8000);
  }
});

$('#resetBtn').addEventListener('click', () => {
  $('#results').hidden = true;
  $('#onboarding').hidden = false;
});

// ---------- analysis ----------
async function loadAnalysis() {
  const data = await api('/api/analysis');
  if (data.empty) return;

  $('#onboarding').hidden = true;
  $('#results').hidden = false;

  const s = data.summary;
  $('#summary').innerHTML = `
    <div>
      <span class="lbl">You're paying subscriptions worth</span>
      <span class="big">${aud(s.totalAnnual)}/yr</span>
      <span class="lbl">${aud(s.totalMonthly)} per month · ${s.count} recurring charges found · ${
        data.source === 'sample' ? 'sample data' : data.source === 'bank' ? 'live bank data' : 'your statement'
      }</span>
    </div>
    <div class="stat"><span class="lbl">Refund window</span><div class="val">${s.refundWindowCount} charge${s.refundWindowCount === 1 ? '' : 's'}</div></div>
    <div class="stat"><span class="lbl">Price hikes</span><div class="val">${s.priceHikeCount}</div></div>`;

  const list = $('#subList');
  list.innerHTML = '';
  for (const sub of data.subscriptions) list.appendChild(renderSub(sub));

  const upsell = $('#upsell');
  if (data.lockedCount > 0) {
    upsell.hidden = false;
    upsell.innerHTML = `
      <h3>🔒 ${data.lockedCount} more subscription${data.lockedCount === 1 ? '' : 's'} found</h3>
      <p>Upgrade to SubSweep Pro to see everything, get refund-request emails, and keep monitoring for new charges.</p>
      <button class="btn primary" id="upgradeBtn">
        ${config.billing === 'stripe-test' ? 'Upgrade — A$9.99/mo (Stripe test mode)' : 'Upgrade to Pro (demo — simulated)'}
      </button>`;
    $('#upgradeBtn').addEventListener('click', upgrade);
  } else {
    upsell.hidden = true;
  }
}

function renderSub(sub) {
  const el = document.createElement('div');
  el.className = 'sub';
  const badges = [
    `<span class="badge cadence">${sub.cadence} · ${sub.chargeCount} charges</span>`,
    sub.flags.refundWindow ? `<span class="badge refund">💸 charged ${sub.daysSinceLast}d ago — refund window</span>` : '',
    sub.flags.priceHike ? `<span class="badge hike">📈 price up ${sub.flags.priceHikePct}%</span>` : '',
    sub.flags.possiblyLapsed ? `<span class="badge lapsed">💤 no charge for ${sub.daysSinceLast}d — may be cancelled</span>` : ''
  ].join('');

  const actions = [];
  if (sub.cancelUrl) actions.push(`<a class="btn" href="${sub.cancelUrl}" target="_blank" rel="noopener">Cancel guide ↗</a>`);
  if (sub.flags.refundWindow) {
    actions.push(
      sub.refundEmail
        ? `<button class="btn" data-email>Refund email</button>`
        : `<button class="btn" data-locked>Refund email (Pro)</button>`
    );
  }

  el.innerHTML = `
    <div class="sub-head">
      <div>
        <div class="sub-name">${sub.name}</div>
        <div class="sub-cat">${sub.category} · last charged ${sub.lastCharge}</div>
      </div>
      <div class="sub-cost">
        <div class="m">${aud(sub.monthlyCost)}/mo</div>
        <div class="y">${aud(sub.annualCost)}/yr at current price</div>
      </div>
    </div>
    <div class="badges">${badges}</div>
    <div class="sub-actions">${actions.join('')}</div>
    <div class="email-box"></div>`;

  const emailBtn = el.querySelector('[data-email]');
  if (emailBtn) {
    emailBtn.addEventListener('click', () => {
      const box = el.querySelector('.email-box');
      box.classList.toggle('open');
      box.textContent = `Subject: ${sub.refundEmail.subject}\n\n${sub.refundEmail.body}`;
    });
  }
  const lockedBtn = el.querySelector('[data-locked]');
  if (lockedBtn) lockedBtn.addEventListener('click', upgrade);
  return el;
}

// ---------- billing ----------
async function upgrade() {
  try {
    const out = await api('/api/billing/upgrade', { method: 'POST' });
    if (out.mode === 'stripe-test') {
      window.location.href = out.checkoutUrl;
      return;
    }
    config.pro = true;
    $('#planPill').textContent = '⭐ Pro (demo)';
    $('#planPill').classList.add('good');
    toast('Pro unlocked (simulated — no payment taken)');
    loadAnalysis();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('cancelled')) toast('Checkout cancelled — you are still on the free plan.', 'err');
  else if (params.get('checkout_session')) {
    try {
      const out = await api(`/api/billing/confirm?checkout_session=${encodeURIComponent(params.get('checkout_session'))}`);
      if (out.pro) toast('✅ SubSweep Pro active (test subscription)');
    } catch (err) {
      toast(err.message, 'err');
    }
  }
  if ([...params.keys()].length) window.history.replaceState({}, '', window.location.pathname);
}

// ---------- init ----------
(async function init() {
  config = await api('/api/config');
  $('#bankPill').textContent = config.bankConnect === 'available' ? '🏦 Bank connect ready' : '🏦 Bank connect: needs BASIQ_API_KEY';
  if (config.bankConnect === 'available') $('#bankPill').classList.add('good');
  else {
    $('#bankConnectBtn').disabled = true;
    $('#bankHint').textContent = 'Set BASIQ_API_KEY to enable (free sandbox key from basiq.io works).';
  }
  $('#planPill').textContent = config.pro ? '⭐ Pro' : `Free plan (top ${config.freeTierLimit} shown)`;
  if (config.pro) $('#planPill').classList.add('good');
  await handleStripeReturn();
  loadAnalysis();
})();

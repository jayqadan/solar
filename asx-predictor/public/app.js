const $ = (sel) => document.querySelector(sel);

let config = { paymentsMode: 'demo', brokerageFeeAud: 5 };
let stocks = [];

const fmtAud = (n) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 });
const fmtPct = (n) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;

function toast(msg, kind = 'ok', ms = 5000) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), ms);
}

// ---------- sparkline / chart ----------
function sparkline(closes, width = 120, height = 34) {
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const pts = closes
    .map((c, i) => `${((i / (closes.length - 1)) * width).toFixed(1)},${(height - 3 - ((c - min) / span) * (height - 6)).toFixed(1)}`)
    .join(' ');
  const up = closes[closes.length - 1] >= closes[0];
  const color = up ? '#2ecc8f' : '#ff6b6b';
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`;
}

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach((p) =>
      p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`)
    );
    if (btn.dataset.tab === 'portfolio') loadPortfolio();
  });
});

// ---------- market ----------
async function loadMarket() {
  const res = await fetch('/api/stocks');
  const data = await res.json();
  stocks = data.stocks;
  $('#asOf').textContent = `As of ${new Date(data.asOf).toLocaleString('en-AU')} · ${
    stocks[0]?.dataSource === 'live' ? 'live data' : 'simulated data'
  }`;
  $('#marketLoading').hidden = true;

  const tbody = $('#marketTable tbody');
  tbody.innerHTML = '';
  for (const s of stocks) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="stock-cell"><span class="tk">${s.ticker}</span><span class="nm">${s.name} · ${s.sector}</span></td>
      <td>${s.price.toFixed(2)}</td>
      <td class="spark" data-t="${s.ticker}">…</td>
      <td><span class="badge ${s.signal}">${s.signal.replace('-', ' ')}</span></td>
      <td><span class="score-bar"><i style="width:${s.score}%"></i></span>${s.score}</td>
      <td class="${s.expectedGainPct >= 0 ? 'gain-pos' : 'gain-neg'}">${fmtPct(s.expectedGainPct)}</td>
      <td class="range">${fmtPct(s.gainRangePct[0])} … ${fmtPct(s.gainRangePct[1])}</td>
      <td>${s.confidencePct}%</td>
      <td><button class="buy-btn" data-t="${s.ticker}">Buy</button></td>`;
    tr.addEventListener('click', (e) => {
      openModal(s.ticker);
      e.stopPropagation();
    });
    tbody.appendChild(tr);
  }
  // lazily fill sparklines
  for (const s of stocks) {
    fetch(`/api/stocks/${s.ticker}`)
      .then((r) => r.json())
      .then((d) => {
        const cell = document.querySelector(`.spark[data-t="${s.ticker}"]`);
        if (cell) cell.innerHTML = sparkline(d.closes.slice(-120));
        s.closes = d.closes;
      });
  }
}

// ---------- modal ----------
async function openModal(ticker) {
  const res = await fetch(`/api/stocks/${ticker}`);
  const s = await res.json();
  const modal = $('#modal');
  const body = $('#modalBody');
  const gainCls = s.expectedGainPct >= 0 ? 'gain-pos' : 'gain-neg';
  body.innerHTML = `
    <h3>${s.ticker} — ${s.name}</h3>
    <p class="sub">${s.sector} · ${s.dataSource} data · A$${s.price.toFixed(2)}</p>
    <div class="chart">${sparkline(s.closes, 580, 120)}</div>
    <div class="stat-grid">
      <div class="stat"><div class="lbl">Signal</div><div class="val"><span class="badge ${s.signal}">${s.signal.replace('-', ' ')}</span></div></div>
      <div class="stat"><div class="lbl">Potential gain (30d)</div><div class="val ${gainCls}">${fmtPct(s.expectedGainPct)}</div></div>
      <div class="stat"><div class="lbl">Range</div><div class="val" style="font-size:13px">${fmtPct(s.gainRangePct[0])} … ${fmtPct(s.gainRangePct[1])}</div></div>
      <div class="stat"><div class="lbl">Confidence</div><div class="val">${s.confidencePct}%</div></div>
      <div class="stat"><div class="lbl">RSI-14</div><div class="val">${s.indicators.rsi14}</div></div>
      <div class="stat"><div class="lbl">SMA 20 / 50</div><div class="val" style="font-size:13px">${s.indicators.sma20} / ${s.indicators.sma50}</div></div>
      <div class="stat"><div class="lbl">Momentum 20d</div><div class="val">${fmtPct(s.indicators.momentum20Pct)}</div></div>
      <div class="stat"><div class="lbl">Volatility (ann.)</div><div class="val">${s.indicators.annualVolatilityPct}%</div></div>
    </div>
    <div class="buy-form">
      <label for="qty">Units to buy</label>
      <input type="number" id="qty" min="1" step="1" value="10" />
      <div class="cost-line" id="costLine"></div>
      <button class="buy-btn" id="confirmBuy">
        ${config.paymentsMode === 'stripe-test' ? 'Pay with card (Stripe test mode)' : 'Buy (simulated payment)'}
      </button>
      <p class="fine">
        Indicative signal only — not financial advice, gains are not guaranteed. Demo brokerage:
        no real shares are purchased and no real money should ever be used.
        ${config.paymentsMode === 'stripe-test' ? 'Use Stripe test card 4242 4242 4242 4242.' : ''}
      </p>
    </div>`;

  const qtyInput = $('#qty');
  const updateCost = () => {
    const q = Math.max(1, Math.floor(Number(qtyInput.value) || 1));
    const total = q * s.price + config.brokerageFeeAud;
    $('#costLine').innerHTML =
      `${q} × ${fmtAud(s.price)} + ${fmtAud(config.brokerageFeeAud)} brokerage = <strong>${fmtAud(total)}</strong>`;
  };
  qtyInput.addEventListener('input', updateCost);
  updateCost();

  $('#confirmBuy').addEventListener('click', async () => {
    const btn = $('#confirmBuy');
    btn.disabled = true;
    btn.textContent = 'Processing…';
    try {
      const r = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: s.ticker, units: Math.floor(Number(qtyInput.value)) })
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || 'Checkout failed');
      if (out.mode === 'stripe-test') {
        window.location.href = out.checkoutUrl;
        return;
      }
      closeModal();
      toast(`✅ Demo order filled: ${out.order.units} × ${out.order.ticker} for ${fmtAud(out.order.total)} (simulated payment)`);
      loadPortfolio();
    } catch (err) {
      toast(`❌ ${err.message}`, 'err');
      btn.disabled = false;
      btn.textContent = 'Try again';
    }
  });

  modal.hidden = false;
}

function closeModal() {
  $('#modal').hidden = true;
}
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => {
  if (e.target === $('#modal')) closeModal();
});
document.querySelectorAll('#marketTable').forEach((t) =>
  t.addEventListener('click', (e) => {
    const btn = e.target.closest('.buy-btn');
    if (btn) {
      e.stopPropagation();
      openModal(btn.dataset.t);
    }
  })
);

// ---------- portfolio ----------
async function loadPortfolio() {
  const res = await fetch('/api/portfolio');
  const { holdings, orders } = await res.json();

  const hBody = $('#holdingsTable tbody');
  hBody.innerHTML = '';
  $('#holdingsEmpty').hidden = holdings.length > 0;
  for (const h of holdings) {
    const tr = document.createElement('tr');
    const cls = h.gainAud >= 0 ? 'gain-pos' : 'gain-neg';
    tr.innerHTML = `
      <td class="stock-cell"><span class="tk">${h.ticker}</span><span class="nm">${h.name}</span></td>
      <td>${h.units}</td>
      <td>${fmtAud(h.avgPrice)}</td>
      <td>${fmtAud(h.currentPrice)}</td>
      <td>${fmtAud(h.value)}</td>
      <td class="${cls}">${fmtAud(h.gainAud)} (${fmtPct(h.gainPct)})</td>`;
    hBody.appendChild(tr);
  }

  const oBody = $('#ordersTable tbody');
  oBody.innerHTML = '';
  $('#ordersEmpty').hidden = orders.length > 0;
  for (const o of orders) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(o.createdAt).toLocaleString('en-AU')}</td>
      <td>${o.ticker}</td>
      <td>${o.units}</td>
      <td>${fmtAud(o.unitPrice)}</td>
      <td>${fmtAud(o.feeAud)}</td>
      <td>${fmtAud(o.total)}</td>
      <td><span class="badge up">${o.status}</span></td>`;
    oBody.appendChild(tr);
  }
}

// ---------- Stripe redirect handling ----------
async function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('cancelled')) {
    toast('Payment cancelled — no order was placed.', 'err');
  } else if (params.get('session_id') && params.get('order_id')) {
    try {
      const r = await fetch(
        `/api/checkout/confirm?session_id=${encodeURIComponent(params.get('session_id'))}&order_id=${encodeURIComponent(params.get('order_id'))}`
      );
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || 'Could not confirm payment');
      if (out.status === 'filled') toast('✅ Test payment confirmed — demo order filled.');
      else toast(`Payment status: ${out.paymentStatus}`, 'err');
    } catch (err) {
      toast(`❌ ${err.message}`, 'err');
    }
  }
  if ([...params.keys()].length) {
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// ---------- init ----------
(async function init() {
  const res = await fetch('/api/config');
  config = await res.json();
  $('#modePill').textContent =
    config.paymentsMode === 'stripe-test' ? '💳 Stripe TEST mode' : '🧪 Demo payments (simulated)';
  await handleStripeReturn();
  loadMarket();
  loadPortfolio();
})();

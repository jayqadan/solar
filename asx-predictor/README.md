# ASX Gain Predictor (Demo)

A web app that ranks major Australian (ASX) stocks by an **indicative 30-day
"potential gain"** signal and lets you place **demo** buy orders paid by card
through **Stripe Checkout in test mode** (or a fully simulated payment when no
Stripe key is configured).

> ## ⚠️ Important disclaimers
>
> - **Not financial advice.** The "potential gain" figures are technical
>   heuristics (trend, momentum, RSI, volatility). They are *not* forecasts and
>   carry no guarantee — markets regularly move against every signal.
> - **Not a real brokerage.** Providing financial product advice or dealing in
>   securities in Australia requires an **Australian Financial Services Licence
>   (AFSL)**. This app has none and never executes real share trades.
> - **No real payments.** The server refuses `sk_live_` Stripe keys. Only use
>   test keys and Stripe's test cards (e.g. `4242 4242 4242 4242`). Never enter
>   real card details.

## Features

- **Market dashboard** — 20 large-cap ASX stocks ranked by indicative 30-day
  potential gain, with price sparklines, signal badges (strong-up → strong-down),
  a 0–100 composite score, a gain range (± one 30-day sigma) and a confidence
  estimate.
- **Stock detail view** — 250-day price chart plus the underlying indicators:
  SMA 20/50, RSI-14, 20/60-day momentum, annualised volatility.
- **Buy flow** — choose units, see the total incl. a flat A$5 demo brokerage
  fee, then pay via Stripe-hosted Checkout (test mode) or a simulated payment.
- **Portfolio** — holdings with live value and gain/loss, plus order history
  (persisted to `data/orders.json`).

## Prediction methodology

For each stock the engine computes over the daily close series:

| Component | Meaning |
| --- | --- |
| SMA 20 vs 50 crossover | medium-term trend direction |
| 20-day & 60-day momentum | recent price persistence |
| RSI-14 | overbought / oversold mean-reversion hint |
| Realised volatility (60d) | scales the expected move and the range |

These blend into a composite signal in [-1, 1]; the indicative 30-day gain is
`composite × 30-day sigma × 0.9`, with the displayed range at ± one 30-day
sigma. Confidence rises when trend and momentum agree and falls with
volatility.

## Running

```bash
cd asx-predictor
npm install
npm start          # http://localhost:3000
```

### Options (environment variables)

| Variable | Effect |
| --- | --- |
| `PORT` | server port (default 3000) |
| `STRIPE_SECRET_KEY` | a **test** key (`sk_test_...`) enables Stripe-hosted Checkout; live keys are rejected at startup |
| `BASE_URL` | public base URL used for Stripe success/cancel redirects |
| `LIVE_DATA=1` | try to fetch real 1-year daily closes from Yahoo Finance (`<TICKER>.AX`), silently falling back to the deterministic simulation on any failure |

Without `STRIPE_SECRET_KEY` the app runs in **demo payments** mode: no card
form is shown at all — the payment step is a single simulated click.

## What it would take to make this real

Not a code change — a business one: an AFSL (or authorised-representative
arrangement), a market participant / broker execution partner (e.g. an API
broker such as a CHESS-sponsored provider), KYC/AML onboarding, and a proper
payments flow (card-funded share purchases are rare; real brokers use bank
transfers/PayID). The Stripe integration here is deliberately test-mode-only.

## API

- `GET /api/config` — payments mode, fees
- `GET /api/stocks` — ranked quotes with predictions
- `GET /api/stocks/:ticker` — detail incl. close series
- `POST /api/checkout` `{ticker, units}` — create order (Stripe session or simulated fill)
- `GET /api/checkout/confirm?session_id&order_id` — verify a Stripe test payment
- `GET /api/portfolio` — holdings and order history

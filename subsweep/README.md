# SubSweep 🧹

Find the subscriptions you forgot you're paying for. SubSweep analyses bank
transactions, detects recurring charges with an interval/amount-stability
algorithm, and shows a "money leaks" dashboard: cost per month/year,
price-hike alerts, refund-window flags (charged in the last 14 days) with a
generated refund-request email, and per-merchant cancel links.

## Data sources

1. **Statement upload (works today, no keys)** — CSV export from any
   Australian bank (CBA/Westpac/NAB/ANZ/ING/Up formats handled: signed Amount
   or Debit/Credit columns, dd/mm/yyyy and ISO dates, headerless CBA style).
   Processed in memory only; never written to disk.
2. **Bank connect via Basiq (CDR / open banking)** — set `BASIQ_API_KEY` and
   the Connect Bank button lights up, using Basiq's hosted consent UI. A free
   sandbox key from [basiq.io](https://basiq.io) connects simulated test banks
   immediately; production access requires a CDR representative agreement
   with Basiq (or Frollo/Adatree).
3. **Sample data** — one click, seeded with a price hike, a refund-window
   charge, and a lapsed subscription so the demo shows every feature.

## Billing

Freemium: free plan shows the top 3 leaks; **SubSweep Pro** unlocks the full
list and refund emails.

- No Stripe key → demo mode: upgrade is simulated, no card form anywhere.
- `STRIPE_SECRET_KEY` (**test keys only** — `sk_live_` is refused at startup)
  + `STRIPE_PRICE_ID` (a recurring Price) → real Stripe Checkout subscription
  flow in test mode. Subscription state is driven by **webhooks**
  (`POST /api/stripe/webhook`, verified against `STRIPE_WEBHOOK_SECRET`:
  `checkout.session.completed`, `invoice.paid`,
  `customer.subscription.updated/deleted`), and Pro users can manage billing
  through the **Stripe Customer Portal** (`POST /api/billing/portal`).

## Accounts

Email + password auth (scrypt hashes, HMAC-signed session cookies, 30-day
expiry). Anonymous visitors can do everything except keep results; account
holders get their **derived** analysis saved and restored — raw transactions
are never persisted for anyone. User records live in a file-backed store
(`lib/users.js`) whose interface is designed to swap for Postgres.

The site splits into a marketing landing page at `/` and the app at `/app`.

Remaining for production: a real database, rate limiting, email verification
+ password reset, HTTPS/`Secure` cookies behind a proxy, and GST via Stripe
Tax once revenue approaches the A$75k registration threshold.

## Run

```bash
cd subsweep
npm install
npm start        # http://localhost:3100
```

| Env var | Effect |
| --- | --- |
| `PORT` | default 3100 |
| `BASIQ_API_KEY` | enables bank connect (sandbox or production key) |
| `STRIPE_SECRET_KEY` | `sk_test_...` enables Stripe subscription checkout |
| `STRIPE_PRICE_ID` | the recurring Price for SubSweep Pro |
| `BASE_URL` | public URL for Stripe redirects |

## Positioning note

SubSweep reviews the user's own spending on non-financial products
(streaming, apps, gyms). It deliberately does not recommend switching
financial products (insurance, loans, super) — in Australia that would be
financial product advice requiring an AFSL. Keep marketing claims to the
tool's function; avoid promised-savings figures you can't substantiate.

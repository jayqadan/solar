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
  flow in test mode, confirmed server-side on return.

For production you'd add: real accounts + auth, Stripe webhooks
(`invoice.paid` / `customer.subscription.deleted`) instead of the
redirect-confirm shortcut, the Stripe Customer Portal, and GST via Stripe Tax.

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

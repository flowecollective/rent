# rent.flowecollective.com

Internal weekly invoicing tool for chair rental at Flowe Collective.

- Two billing models, chosen per stylist:
  - **Rent + fee** (default): $600/week + 7.5% service fee of net service revenue. Service fee capped at $1,000/stylist/month.
  - **% chair rent**: flat percentage of net service revenue (e.g. 35%) with a weekly minimum floor (e.g. $600). No flat rent. Greater of the two, not additive.
- Net service revenue = service sales − discounts − refunds (tips excluded via Tippy).
- Service-fee cap notes (rent + fee model only):
  - "Month" = calendar month the work week *ends in*. A week spanning months counts entirely toward its ending month.
  - Cap counts invoices in `sent | processing | paid` status. Failed invoices don't consume the cap.
- Payment: ACH via Stripe hosted invoice (stylists receive email, review, then pay; never auto-charged). 2 days to pay. ~$5 max per invoice (vs ~$26 for card).
- Stack: Next.js 15, Supabase, Stripe, Vercel
- Access: single password gate (no per-user auth — it's just the admin)

## First-time setup

### 1. Install dependencies locally

```bash
cd rent-flowe
npm install
```

### 2. Set up Supabase

Open https://supabase.com/dashboard/project/rhqkmzbrmyhsducqhzea/sql and paste the contents of `supabase-schema.sql`. Run it. Two tables appear: `stylists`, `invoices`.

Grab these from Supabase → Settings → API:
- Project URL (you have it)
- `anon` public key
- `service_role` secret key (server-side only, never expose)

### 3. Set up Stripe (test mode)

1. Log into Stripe in **test mode** (toggle top-right)
2. Developers → API keys → grab:
   - Publishable key (`pk_test_...`)
   - Secret key (`sk_test_...`)
3. Skip webhooks for now — we configure that after deploy

### 4. Local development (optional)

Create `.env.local` (do not commit):

```
NEXT_PUBLIC_SUPABASE_URL=https://rhqkmzbrmyhsducqhzea.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your anon key>
SUPABASE_SERVICE_ROLE_KEY=<your service role key>
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_placeholder
ADMIN_PASSWORD=1207W34th
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Then:

```bash
npm run dev
```

Visit http://localhost:3000 — login with password `1207W34th`.

### 5. Deploy to Vercel

1. Push this repo to GitHub (private)
2. In Vercel: New Project → import the repo
3. During setup, add environment variables (same as above, but with production values)
4. Deploy
5. After deploy, add custom domain `rent.flowecollective.com`:
   - Vercel → Project → Settings → Domains → Add
   - Vercel shows you a CNAME target (e.g. `cname.vercel-dns.com`)
   - Add CNAME record in your DNS: `rent` → `cname.vercel-dns.com`
6. Update `NEXT_PUBLIC_APP_URL` env var to `https://rent.flowecollective.com`, redeploy

### 6. Configure Stripe webhook

1. Stripe Dashboard (test mode) → Developers → Webhooks → Add endpoint
2. URL: `https://rent.flowecollective.com/api/stripe/webhook`
3. Subscribe to events:
   - `checkout.session.completed`
   - `setup_intent.succeeded`
   - `invoice.paid`
   - `invoice.payment_failed`
4. After creation, reveal the signing secret (`whsec_...`)
5. Add to Vercel env vars as `STRIPE_WEBHOOK_SECRET`, redeploy

## Usage

### Add stylists
Settings → Add stylist (name + email) → creates a Stripe customer.

### Onboard a stylist for ACH
Settings → click "Send setup link" next to their name → copy the URL → text/email it to them. They'll connect their bank via Stripe (Plaid instant or microdeposits fallback). Status updates automatically via webhook.

### Run weekly billing
1. Home page defaults to the prior Mon–Sun week (change date if needed)
2. Enter each stylist's net service revenue from Boulevard
3. Review totals
4. Click "Create & send invoices"
5. Each stylist receives an email from Stripe with a link to a hosted invoice page. They review line items and click "Pay" to initiate ACH from their saved bank. 2-day payment window.
6. After they pay, ACH takes 3–5 business days to clear. Invoice status: `sent` → `processing` → `paid` (or `failed`), updated by webhook.

### Testing with fake ACH (test mode only)

Stripe test bank accounts: https://docs.stripe.com/payments/ach-direct-debit/accept-a-payment?platform=web#web-test-account-numbers

Routing: `110000000`, Account: `000123456789` (succeeds).

## Going live (when ready)

1. Replace `sk_test_...` with `sk_live_...` in Vercel env vars
2. Replace `pk_test_...` with `pk_live_...`
3. Create a new live-mode webhook endpoint (same URL, same events), replace `STRIPE_WEBHOOK_SECRET`
4. Re-onboard each stylist (test and live mode customers don't carry over — you'll need to resend setup links)
5. Redeploy

## Costs

- Vercel: free tier covers this
- Supabase: free tier covers this
- Stripe ACH: 0.8%, capped at $5/invoice. ~$900 invoice = $5. Across 5 stylists × 52 weeks ≈ $1,300/yr
- Failed ACH: $4/failed transaction (rare)

## Troubleshooting

- **"Payment method not verified"** — stylist hasn't connected their bank yet, or microdeposits still pending. Resend setup link.
- **Invoice stuck on "processing"** — normal. ACH takes 3–5 business days. Webhook will flip to `paid` or `failed`.
- **Webhook 400 signature error** — `STRIPE_WEBHOOK_SECRET` is missing or stale. Copy fresh from Stripe webhook settings.
- **Login fails** — check `ADMIN_PASSWORD` env var in Vercel matches what you're typing.

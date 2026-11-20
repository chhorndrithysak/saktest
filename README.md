# Premium App Sale

A full-stack marketplace for **legally authorized** premium application accounts and license keys,
with RaksmeyPay (KHQR / Bakong) payments, automatic encrypted delivery, and a full admin dashboard.
Khmer is the primary UI language; English is optional.

> **Legal reminder.** Only sell accounts and license keys that you are legally authorized to resell
> (for example, under a written reseller/distribution agreement with the vendor). Reselling consumer
> accounts in violation of a vendor's terms of service may be unlawful and can get accounts revoked.
> The seeded products (StreamMax, TuneWave, DesignForge, …) are **fictional samples** with fake demo
> credentials on `example.test`. Delete them and add your own authorized products before launch.

---

## 1. Architecture

| Layer | Technology |
| --- | --- |
| Web | Next.js 15 (App Router, Server Components, Server Actions), React 19, TypeScript strict |
| UI | Tailwind CSS 4, custom accessible components, Noto Sans Khmer, toast + skeleton states |
| i18n | `src/locales/km.json` (default) and `en.json`, cookie-selected |
| Data | PostgreSQL + Prisma 6, SQL migrations with CHECK constraints and a trigger |
| Auth | DB sessions in HttpOnly SameSite cookies (`__Host-` prefix in prod), Argon2id, RBAC |
| Payments | `PaymentProvider` interface → `RaksmeyPayProvider` or `MockPaymentProvider` |
| Crypto | AES-256-GCM for stock (random IV, auth tag, key version), HMAC fingerprints for de-duplication |
| Tests | Vitest (unit + integration on real PostgreSQL), Playwright (e2e) |

```
src/
  app/(store)/…            customer pages (home, products, checkout, orders, auth, legal)
  app/admin/…              admin dashboard (RBAC in layout + every action/API)
  app/api/checkout         create order + atomic stock reservation
  app/api/orders/[n]/…     status polling, credential reveal (POST, no-store), pay redirect
  app/api/webhooks/raksmeypay           webhook endpoint
  app/api/payments/raksmeypay/success/[tid]   success URL endpoint
  app/api/cron/release-reservations     expired reservation release + re-verify sweep
  lib/payments/            RaksmeyPay hashes, provider, webhook validation, mock
  lib/orders/              checkout, idempotent confirmation & fulfillment, payment flow
  lib/inventory/           encryption, CSV import, audited admin operations
  lib/auth/, lib/security/ sessions, guards, rate limiting, origin checks, redaction
prisma/                    schema, migrations, seed
tests/                     unit, integration, e2e
```

### Purchase flow

1. Customer picks a plan → `POST /api/checkout` (same-origin, rate-limited).
2. Inside one DB transaction: the price is read from the DB, `SELECT … FOR UPDATE SKIP LOCKED` locks
   N `AVAILABLE` items, the order and payment are created, and the items become `RESERVED` (default 15 min).
3. The RaksmeyPay QR is created server-side (QR API). The hosted payment page is reached only via a
   server redirect (`/api/orders/{n}/pay`), so the hash never appears in client JavaScript.
4. Confirmation arrives by **webhook**, **success URL**, customer **status polling**, the **cron sweep**,
   or the admin's **retry verification**. Every path calls the same `verifyAndConfirm()`:
   it checks claimed amount and currency, calls **Verify Transaction** on the server, and compares the
   verified amount exactly in minor units. Then one transaction locks the payment row, marks it
   `SUCCEEDED`, marks the order `PAID`, converts reserved stock to `SOLD`, creates `Fulfillment` rows,
   and sets the order to `FULFILLED`.
5. If the reservation expired before payment, other `AVAILABLE` stock is allocated instead. Stock
   reserved by another order is never touched. If no stock is left, the order becomes
   `PAID_AWAITING_STOCK`, an admin alert is logged, and the admin can restock and click
   *Retry fulfillment*.
6. The customer opens **My Orders** → *Reveal credentials*. A `POST` with no-store returns decrypted
   values only for the owner's fulfilled order.

### Guarantees against double-selling

* `Fulfillment.inventoryItemId` is `UNIQUE`, so an item can be delivered at most once.
* A PostgreSQL trigger forbids `SOLD → AVAILABLE/RESERVED`.
* CHECK constraints keep the state machine valid: `RESERVED` must have an order and an expiry, and `SOLD` must have `soldAt`.
* A partial unique index allows only one `SUCCEEDED` payment per order.
* Conditional `updateMany` + count checks inside transactions with row locks.

---

## 2. Installation

Requirements: Node.js 20+ (tested on 24), npm, and PostgreSQL 15+ (Docker or the embedded option below).

```bash
npm install
cp .env.example .env            # then fill in values (see §3)
npm run keys:generate           # prints AUTH_SECRET / INVENTORY_ENCRYPTION_KEY / CRON_SECRET
```

### PostgreSQL

**Option A: Docker Compose**

```bash
docker compose up -d db
# DATABASE_URL=postgresql://premium:change-me-local-only@127.0.0.1:5432/premium_app_sale
```

Change `POSTGRES_PASSWORD` (env var read by `docker-compose.yml`) for anything other than local use.

**Option B: no Docker (embedded PostgreSQL from npm, dev/test only)**

```bash
npm run db:embedded             # keeps running; Ctrl+C to stop
# DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/premium_app_sale
```

### Migrations and seed

```bash
npx prisma migrate deploy       # or: npm run db:migrate   (dev, creates new migrations)
npm run db:seed
```

The seed is idempotent. It creates store settings, an admin from `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD` (never hardcoded), 4 categories, 6 fictional products, and encrypted demo stock.

### Run

```bash
npm run dev                     # http://localhost:3000
npm run build && npm start      # production build
```

### Creating an admin

* Development: set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (≥ 10 chars), then run `npm run db:seed`.
* Production: register normally, then promote the account once in SQL
  (`UPDATE "User" SET role='ADMIN' WHERE email='you@domain';`) or have an existing admin use
  **Admin → Users → Make admin**. Role changes revoke the user's sessions and are audited.

---

## 3. Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `APP_URL` | yes | Public origin, no trailing slash. `https://` is enforced in production. Used to build the success URL and as the only allowed request Origin. |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | ≥ 32 chars. HMAC pepper for session/reset/verification token hashes |
| `INVENTORY_ENCRYPTION_KEY` | yes | Exactly 32 bytes, base64. **Back it up.** Losing it makes all stock unreadable. |
| `CRON_SECRET` | yes (prod) | Bearer token for `/api/cron/release-reservations` |
| `PAYMENT_PROVIDER` | yes | `mock` (dev only, refused in production) or `raksmeypay` |
| `RAKSMEYPAY_BASE_URL` | | Default `https://www.raksmeypay.com` |
| `RAKSMEYPAY_PROFILE_ID` | raksmeypay | From the RaksmeyPay dashboard |
| `RAKSMEYPAY_PROFILE_KEY` | raksmeypay | Secret. Used for all hashes. |
| `RAKSMEYPAY_WEBHOOK_API_KEY` | raksmeypay | The webhook "API Key" from the dashboard (sent as `X-Api-Key`) |
| `RAKSMEYPAY_PAYMENT_OPTION` | | Optional hosted-page preselection: `bakong`, `aba`, `binance`, `paypal` |
| `RAKSMEYPAY_QR_TEMPLATE` | | `1` KHQR card (default) / `2` plain QR |
| `RAKSMEYPAY_WEBHOOK_TOLERANCE_SECONDS` | | Replay window for webhook `timestamp` (default 900) |
| `RAKSMEYPAY_SUCCESS_MAX_AGE_SECONDS` | | Success-URL validity (default 180, per the official sample) |
| `EMAIL_TRANSPORT`, `EMAIL_FROM` | | `console` logs links (dev only; throws in production) |
| `REQUIRE_EMAIL_VERIFICATION` | | `true` blocks checkout until the email is verified |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | seed | Development admin |

---

## 4. Connecting your RaksmeyPay merchant account

All formulas below come from the official documentation: <https://www.raksmeypay.com/api-documentation>.

1. In the RaksmeyPay dashboard, copy your **Profile ID** and **Profile Key** into
   `RAKSMEYPAY_PROFILE_ID` and `RAKSMEYPAY_PROFILE_KEY`.
2. Set **Webhook URL** to `https://YOUR_DOMAIN/api/webhooks/raksmeypay` and copy the webhook
   **API Key** into `RAKSMEYPAY_WEBHOOK_API_KEY`. Admin → Settings shows the exact URL.
3. Set `PAYMENT_PROVIDER=raksmeypay` and restart. Startup validation fails if any of the three values is missing.
4. Schedule the cron (every 1–5 minutes):
   `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://YOUR_DOMAIN/api/cron/release-reservations`
   (or `npm run cron:release`). Webhooks are dispatched **once with no retries**, so this sweep also
   re-verifies recent pending payments.
5. Make a small real payment (minimum 0.01 USD / 100 KHR) and check **Admin → Payments → event history**.

| API | Implementation |
| --- | --- |
| Hosted payment page `GET /payment/request/{PROFILE_ID}` | `sha1(profile_key . transaction_id . amount . urlencode(success_url) . remark)`. `success_url` is PHP-`urlencode`d, hashed in that form, and then sent through `http_build_query`, exactly like the official PHP sample/SDK. |
| QR API `POST /api/payment/qr-api/{PROFILE_ID}` | `sha1(profile_key . transaction_id . amount . remark)` using the exact amount string, e.g. `"5.00"`. Transaction IDs are numeric with ≤ 15 digits. |
| Verify `POST /api/payment/verify/{PROFILE_ID}` | `sha1(profile_key . transaction_id)`. Success requires `status=1` and `payment_status=SUCCESS`, and the amount must equal the order exactly. |
| Success URL | `sha1(profile_key . success_time . success_amount . bakong_hash . transaction_id)`, with a 180 s expiry and Verify Transaction before fulfilling. The transaction ID is carried in the URL path because the redirect does not include it. |
| Webhook | Timing-safe `X-Api-Key`, Zod schema, `sha1(profile_key . timestamp . amount . bakong_hash . transaction_id)` (timing-safe), `profile_id`, timestamp window, `status=success`, then amount and currency against the order, then Verify Transaction. |

Not documented by RaksmeyPay, and therefore **not implemented or assumed**: refunds, a webhook
timeout or success status code, and error formats for the payment-request and verify APIs. Refunds
are recorded manually by an admin (*Record manual refund*) and the app never claims an automatic refund.

KHR amounts are sent as whole riel (e.g. `"12000"`). Confirm with RaksmeyPay that this matches your
profile before selling KHR-priced items.

---

## 5. Testing

```bash
npm test               # unit + integration (Vitest). Starts embedded PostgreSQL automatically,
                       # or uses TEST_DATABASE_URL if set (e.g. Docker/CI).
npm run test:e2e       # Playwright; starts `npm run dev` in mock mode. Uses Microsoft Edge by default
                       # (PW_CHANNEL=chrome | chromium after `npx playwright install chromium`).
npm run check          # lint + typecheck + tests + production build
```

The suites cover:
* RaksmeyPay hash generation and PHP `urlencode` parity
* Exact decimal handling
* Success URL validation: valid, bad hash, expired, future-dated
* Webhook API key and signature checks, and tampering
* Wrong-amount rejection (claimed and verified)
* Duplicate and concurrent webhook idempotency
* 8 concurrent checkouts racing for the last item
* Reservation expiry
* Late payment re-allocation
* Paid order with no stock (`PAID_AWAITING_STOCK`), then restock and retry
* Sold stock reuse blocked by the DB trigger and unique index
* Customers cannot read other customers' credentials, and CSRF is refused
* Non-admin 401/403 on admin APIs, and audited reveals
* A full browser purchase

External RaksmeyPay HTTP calls are always mocked in tests (`tests/helpers.ts → mockedRaksmeyPay`).

### Mock Payment Mode

With `PAYMENT_PROVIDER=mock` an orange banner appears on every page. The *Mock payment* button opens
`/mock-pay/{transaction_id}`. *Simulate successful payment* marks the mock provider as paid and runs
the **same** server-side verification and fulfillment path as a real webhook. Env validation refuses
mock mode in production.

---

## 6. Production deployment checklist

- [ ] `NODE_ENV=production`, `APP_URL=https://…`, `PAYMENT_PROVIDER=raksmeypay`
- [ ] Fresh `AUTH_SECRET`, `INVENTORY_ENCRYPTION_KEY`, `CRON_SECRET` from a secret manager (not committed)
- [ ] Managed PostgreSQL with TLS, automated backups, and point-in-time recovery; `npx prisma migrate deploy` in CI/CD
- [ ] Webhook URL and API key configured in RaksmeyPay; cron scheduled
- [ ] A real email transport implemented in `src/lib/email/mailer.ts` (`setMailTransport`); console transport refuses production
- [ ] Reverse proxy terminates TLS and sets `X-Forwarded-For` (used for rate limiting and audit IPs). Strip client-supplied values at the edge.
- [ ] Remove the seeded sample products and demo stock; set store name, logo, and support contacts in Admin → Settings
- [ ] Review the Terms, Privacy, and Refund texts in `src/locales/*.json` with a lawyer
- [ ] Confirm you hold resale authorization for every product listed
- [ ] Monitor logs for `[admin-alert]` and check the Admin dashboard alerts panel

## 7. Backup and encryption-key management

* Stock is encrypted with `INVENTORY_ENCRYPTION_KEY` (AES-256-GCM). DB backups alone are useless
  without this key, and the key alone is useless without the DB. **Store them separately.** Keep the
  key in a secret manager plus an offline, access-controlled copy.
* Each record has a `keyVersion`. To rotate, add support for a second key version in
  `src/lib/inventory/secret.ts`, re-encrypt in a migration script, then retire the old key.
* If the key leaks, rotate it and treat all unsold stock as compromised. Replace it with the vendors.
* Back up PostgreSQL daily, test restores regularly, and keep backups encrypted.

## 8. Security notes

* RBAC: `/admin` layout, every admin Server Action (`requireAdmin`), and every admin API re-check
  the role server-side. Suspended users lose all sessions immediately.
* Sessions: 256-bit random tokens stored as HMAC hashes. Cookies are HttpOnly, SameSite=Lax, Secure,
  and `__Host-` prefixed in production. Passwords use Argon2id (m=19 MiB, t=2, p=1).
* CSRF: Server Actions use Next.js origin checks. Cookie-authenticated JSON APIs require
  `Origin` == `APP_URL`. Credential reveals use POST.
* Input: Zod everywhere. Prisma parameterizes all queries, including the raw `FOR UPDATE` SQL.
  `safeRedirectPath` blocks open redirects. Success redirects only go to internal order pages.
* Rate limits are stored in PostgreSQL (they work across instances): login, register, forgot password,
  checkout, payment initiation, status polling, reveal, webhook, and success URL.
* Headers: nonce-based CSP (`frame-ancestors 'none'`, `object-src 'none'`), HSTS (prod), nosniff,
  DENY framing, a strict Referrer-Policy, and a Permissions-Policy.
* Secrets: the Profile Key, Webhook API Key, encryption key, decrypted stock, and server hashes never reach the browser. The hosted
  payment URL is only issued as a server redirect. Admin Settings shows only *configured / not configured*.
  Payment events store redacted payloads, and logs contain no secrets or decrypted stock.
* Credentials are not in page HTML. They are fetched only on explicit Reveal and served with
  `Cache-Control: no-store`. Admin reveals require a click, are logged in `InventoryRevealAudit` and
  `AdminAuditLog`, and are rate-limited.
* No card or bank data is ever collected. Payment entry stays on RaksmeyPay.
* Times are stored in UTC (`timestamptz`) and displayed in `Asia/Phnom_Penh`.

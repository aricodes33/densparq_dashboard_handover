# Deployment guide (backend engineer)

The goal: replace the in-browser mock with a real API and Postgres database, then point the live front end at it. The front end already works and is deployed. You build the backend to a contract that already exists.

**Read in this order:**
1. This file: how to run, build and deploy.
2. [`BACKEND-HANDOFF.md`](BACKEND-HANDOFF.md): what is **not** specified yet, and the product decisions you need answered.
3. [`openapi.yaml`](openapi.yaml), [`schema.sql`](schema.sql) and [`business-rules.md`](business-rules.md): the contract.

---

## 0. What exists today

```
Browser ──► Netlify (static React app, hash router)
              └── src/api/client.ts ──► VITE_API_MODE=mock  → src/mock/handlers.ts (in-browser fake API)   ◄── today
                                     └► VITE_API_MODE=http  → ${VITE_API_BASE}/...  → your API → Postgres   ◄── target
```

- **Front end:** React 18, Vite and TypeScript. Netlify site `densparq-tournaments` serves https://densparq-tournaments.netlify.app
- **Every network call** goes through one file, `src/api/client.ts`. Changing one environment variable switches it from the mock to your API.
- **The mock is the reference implementation.** Each OpenAPI operation has a handler in `src/mock/handlers.ts`, `venueHandlers.ts` or `academyHandlers.ts`. The handler shows the exact side effects: audit rows, notifications, waitlist promotion. Read it whenever the spec is unclear.

---

## 1. Run the front end locally (5 minutes)

Needs Node 22 (the version Netlify uses).

```bash
npm ci
```

```bash
npm run dev
```

Open http://localhost:5173. The **Viewing as** switch at the bottom of the sidebar changes the role, so you can see what each role is allowed to call.

Checks that run on every Netlify deploy (all passing in this repo):

```bash
npm test
```

```bash
npm run build
```

`npm test` runs 18 unit tests on the domain logic. `npm run build` runs a strict typecheck and produces the production bundle in `dist/`.

---

## 2. Create the database

`docs/schema.sql` is plain PostgreSQL DDL with no migration tool. It has been **verified to load cleanly on PostgreSQL 16**: 65 tables, plus the court-overlap exclusion constraints.

**Requirements:**
- PostgreSQL **15 or newer**.
- Extensions **`pgcrypto`** (for `gen_random_uuid`) and **`btree_gist`** (for the no-double-booking constraints). Both are available on Supabase, Neon, AWS RDS/Aurora, Google Cloud SQL and Azure. The schema runs `create extension` itself, so the user running it needs permission to create extensions.

**Local, with Docker:**

```bash
docker run -d --name densparq-db -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16
```

```bash
psql "postgres://postgres:dev@localhost:5432/postgres" -v ON_ERROR_STOP=1 -f docs/schema.sql
```

**Managed database:** run the same `psql ... -f docs/schema.sql` command against its connection string.

**Before production:**
- Turn `schema.sql` into migration #1 in your migration tool (Prisma, Drizzle, Flyway, sqitch, Alembic and so on), and make every later change a new migration. Never edit `schema.sql` in place after go-live.
- Row-level security is only defined on `tournaments` (bottom of the file). It expects `set local app.user_id = '<uuid>'` per request. Either extend it to every org-scoped table, or enforce tenancy in the API. See BACKEND-HANDOFF §5.

**Conventions baked into the schema** (the front end relies on them too):

| Thing | Convention |
|---|---|
| Money | Integer **paise** (`*_paise int`). Never use floats. |
| Time | `timestamptz`, stored in UTC; the UI displays it in `Asia/Kolkata`. |
| IDs | UUID (`gen_random_uuid()`). |
| Score events | Append-only. Undo sets a `voided` flag and never deletes. |
| Court bookings and matches | The database rejects overlaps (`exclude using gist`). Map that error to a `409` conflict. |

---

## 3. Build the API

**Stack recommendation:** Node with TypeScript. `src/domain/*.ts` (fixtures, scoring, standings, registration, venue and academy rules) is dependency-free TypeScript, so you can import it on the server unchanged. The device's optimistic live score and the server's authoritative score then come from the same code. Any other stack works, but you would have to port about 1,000 lines of rules and keep them in sync.

**The contract is in `docs/openapi.yaml`:** 155 operations, generated from the mock router. `x-roles` on each operation lists who may call it, and **the server must enforce this**, because the UI only hides buttons. To regenerate the spec after changing the mock:

```bash
python3 scripts/gen-openapi.py
```

**What the front end expects from every endpoint:**

| | |
|---|---|
| Base path | `/api/v1` |
| Auth | `Authorization: Bearer <JWT>`. The JWT is issued after phone OTP. `GET /me` returns the user and their org memberships and roles. |
| Errors | HTTP status plus a body of `{ "error": { "code": "format_locked", "message": "Human text", "details": {...} } }`. The UI shows `message` and branches on `code`, so keep the codes from the spec. |
| Idempotency | Every non-GET request sends an `Idempotency-Key: <uuid>` header. Store the key and its response for about 24 hours and replay the response on a repeat, which matters for payments and score events. GET requests send an empty value; ignore it. |
| `204` | Allowed. The client handles an empty body. |
| JSON | camelCase fields, matching `src/domain/types.ts`. Map them to snake_case columns in your data layer. |

**Integrations** (details in the README, "Backend team: how to replace the mock"):

| Integration | Secret or config you need | Notes |
|---|---|---|
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | The flow is: create order, then the `payment.captured` webhook confirms the entry. Verify the webhook signature. |
| WhatsApp BSP | Provider API key and approved template IDs | The provider is not chosen yet. Delivery webhooks write `delivery_attempts`. |
| SMS OTP | Provider key | Needed for login. |
| File storage | S3-compatible bucket and credentials | Use presigned uploads: rulebooks up to 10 MB, documents up to 5 MB. |
| Jobs | A queue or scheduler | Match reminders at T−60 min, waitlist expiry, notification retries. |

---

## 4. Connect the live front end to your API

**Recommended: proxy through Netlify (no CORS, no CSP change).** The site's Content-Security-Policy in `netlify.toml` allows API calls **only to its own origin** (`connect-src 'self'`). A browser will therefore **block** calls to `https://api.densparq.in` unless one of two things changes. The simplest is to keep the API on the same origin with a proxy rule. Add this to `netlify.toml`:

```toml
[[redirects]]
  from = "/api/*"
  to = "https://YOUR-API-HOST/api/:splat"
  status = 200
  force = true
```

Then, in Netlify → Site configuration → **Environment variables**, set:

| Key | Value |
|---|---|
| `VITE_API_MODE` | `http` |
| `VITE_API_BASE` | `/api/v1` (the default, so it can be omitted) |

**Alternative: call the API host directly.** Set `VITE_API_BASE=https://api.densparq.in/api/v1`, add that origin to `connect-src` in `netlify.toml`, and enable CORS on the API for the site's origin, including the `Authorization` and `Idempotency-Key` headers.

Either way:
- `VITE_*` variables are **baked in at build time**. After changing one, trigger a new deploy (Deploys → Trigger deploy).
- **Front-end work is still needed for real login.** The client reads the token from `localStorage['dsq-token']`, but there is no OTP login screen yet, and the role comes from the demo **Viewing as** picker. A login page has to be built, and the persona picker hidden, before real users can sign in. See BACKEND-HANDOFF §1.
- Do it in stages. Point a **deploy preview or branch deploy** at the staging API first. Production keeps running on the mock until you're ready.

---

## 5. Go-live checklist

- [ ] Product has answered BACKEND-HANDOFF decisions 1–3 (payment gateway, WhatsApp provider, data retention).
- [ ] Schema applied through a migration tool. Daily backups and point-in-time recovery turned on.
- [ ] Tenancy enforced (RLS or API layer). Tested: a user in org A can't read org B by changing IDs in the URL.
- [ ] `x-roles` enforced on every operation. Tested with each role.
- [ ] Razorpay webhook signature verified, with idempotent processing. Tested with the Razorpay test-mode dashboard.
- [ ] OTP endpoint is rate-limited, and so are the `/public/*` endpoints.
- [ ] Errors use the `{ error: { code, message, details } }` shape, with codes matching the spec.
- [ ] Front-end login screen built, persona picker hidden in production.
- [ ] Netlify proxy or CORS configured, `VITE_API_MODE=http` set, site redeployed.
- [ ] Smoke test of the five end-to-end flows listed in the README under "Verified in this build", run against the real API.

## 6. Rollback

- **Front end:** Netlify → Deploys → pick the previous deploy → **Publish deploy**. That takes seconds. Setting `VITE_API_MODE=mock` and redeploying returns the site to the demo.
- **Database:** use your migration tool's down migration, or restore from point-in-time recovery. Take a snapshot before every production migration.

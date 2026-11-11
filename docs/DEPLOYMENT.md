# Deployment guide (backend engineer)

The goal: replace the in-browser mock with a real API and Postgres database, then host the front end with it. The front end is finished; you build the backend to a contract that already exists. **No particular hosting provider is required.** The front end builds to plain static files that any web server can serve.

**Read in this order:**
1. This file: how to run, build and deploy.
2. [`BACKEND-HANDOFF.md`](BACKEND-HANDOFF.md): what is **not** specified yet, and the product decisions you need answered.
3. [`openapi.yaml`](openapi.yaml), [`schema.sql`](schema.sql) and [`business-rules.md`](business-rules.md): the contract.

---

## 0. What exists today

```
Browser ──► any static host (React app built to dist/, hash router)
              └── src/api/client.ts ──► VITE_API_MODE=mock  → src/mock/handlers.ts (in-browser fake API)   ◄── today
                                     └► VITE_API_MODE=http  → ${VITE_API_BASE}/...  → your API → Postgres   ◄── target
```

- **Front end:** React 18, Vite and TypeScript. `npm run build` outputs static files to `dist/`. The app uses hash URLs (`/#/o/...`), so the server needs **no rewrite rules**: it only serves `index.html` and `assets/`.
- `netlify.toml` belongs to the current demo hosting. It isn't required; its security headers are reproduced in §4.
- **Every network call** goes through one file, `src/api/client.ts`. Changing one environment variable switches it from the mock to your API.
- **The mock is the reference implementation.** Each OpenAPI operation has a handler in `src/mock/handlers.ts`, `venueHandlers.ts` or `academyHandlers.ts`. The handler shows the exact side effects: audit rows, notifications, waitlist promotion. Read it whenever the spec is unclear.

---

## 1. Run the front end locally (5 minutes)

Needs Node 22.

```bash
npm ci
```

```bash
npm run dev
```

Open http://localhost:5173. The **Viewing as** switch at the bottom of the sidebar changes the role, so you can see what each role is allowed to call.

Checks to run before every deploy (all passing in this repo):

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

## 4. Host the front end with your API

`VITE_*` settings are **baked in at build time**, so set them when you run the build:

```bash
VITE_API_MODE=http npm run build
```

This produces `dist/`, which calls `/api/v1/...` on **the same domain the page is served from**. `VITE_API_BASE` defaults to `/api/v1`.

**Recommended: serve `dist/` from the same domain as the API.** Then no CORS setup is needed. Pick whichever matches your stack:
- **From the API itself:** for example, Express `app.use(express.static('dist'))` mounted after the `/api/v1` routes, or the equivalent in your framework.
- **Behind nginx or another reverse proxy:**

```nginx
server {
  listen 443 ssl;
  server_name app.densparq.in;
  root /srv/densparq/dist;

  location /api/ { proxy_pass http://127.0.0.1:3000; }   # your API
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
  location = /index.html { add_header Cache-Control "no-cache"; }
}
```

This setup was **tested**: the `http` build served by a plain Node server called `/api/v1/me/notifications` and `/api/v1/orgs/densparq/tournaments` on the same domain, sent the `Authorization` header, and threw no browser errors.

**Alternative: front end and API on different domains.** Build with `VITE_API_BASE=https://api.densparq.in/api/v1`, and enable CORS on the API for the front-end origin, allowing the `Authorization`, `Content-Type` and `Idempotency-Key` headers.

**Security headers to send with the front end.** These are copied from `netlify.toml`; set them in nginx or your server. Add the API origin to `connect-src` only if you used the different-domains option.

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

**Also note:**
- **Front-end work is still needed for real login.** The client reads the token from `localStorage['dsq-token']`, but there's no OTP login screen yet, and the role comes from the demo **Viewing as** picker. See BACKEND-HANDOFF §1.
- Stage it first: deploy the `http` build against a staging API before production.

## 5. Go-live checklist

- [ ] Product has answered BACKEND-HANDOFF decisions 1–3 (payment gateway, WhatsApp provider, data retention).
- [ ] Schema applied through a migration tool. Daily backups and point-in-time recovery turned on.
- [ ] Tenancy enforced (RLS or API layer). Tested: a user in org A can't read org B by changing IDs in the URL.
- [ ] `x-roles` enforced on every operation. Tested with each role.
- [ ] Razorpay webhook signature verified, with idempotent processing. Tested with the Razorpay test-mode dashboard.
- [ ] OTP endpoint is rate-limited, and so are the `/public/*` endpoints.
- [ ] Errors use the `{ error: { code, message, details } }` shape, with codes matching the spec.
- [ ] Front-end login screen built, persona picker hidden in production.
- [ ] Front end built with `VITE_API_MODE=http`, served on the API's domain (or CORS set up), security headers set.
- [ ] Smoke test of the five end-to-end flows listed in the README under "Verified in this build", run against the real API.

## 6. Rollback

- **Front end:** keep the previous `dist/` build (for example, versioned folders with a symlink) and switch back to it. Building without `VITE_API_MODE` gives the self-contained demo again.
- **Database:** use your migration tool's down migration, or restore from point-in-time recovery. Take a snapshot before every production migration.

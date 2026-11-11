# Backend handoff: gaps and open decisions

Read the [README](../README.md) first. It explains how to replace the in-browser mock with a real API. This note lists what the handoff does **not** yet specify, so you can plan for it or push back before building.

## What is ready

- **Database:** `docs/schema.sql` (PostgreSQL). Every collection in the mock (`src/mock/db.ts`) has a table.
- **API contract:** `docs/openapi.yaml`, 155 operations. It is generated from the mock router by `scripts/gen-openapi.py`. A rerun on this snapshot gives an identical file.
- **Behaviour:** `src/mock/*Handlers.ts` holds one handler per operation, with side effects, audit and permissions. `src/domain/*.ts` is pure business logic, meant to be ported unchanged.
- **Rules and flows:** `docs/business-rules.md`, `docs/flows.md`, `docs/spec.md`, `docs/data-model.md`.

## Gaps to fill

### 1. Authentication endpoints
The README says to use "phone OTP, then a JWT", and `GET /me` returns the user's memberships. No endpoints exist for:
- requesting an OTP
- verifying an OTP and issuing a token
- refreshing a token and logging out
- accepting a staff invite (`POST /orgs/{org}/members` "sends OTP login link")

**Needed:** endpoint design, token lifetime, refresh strategy, and OTP rate limits.

**Front-end work too:** there is no login screen. `src/api/client.ts` reads the token from `localStorage['dsq-token']`, which nothing writes yet, and the active role comes from the demo **Viewing as** persona picker. Both need replacing before real users can sign in.

### 2. File uploads
Rulebooks (up to 10 MB) and registration documents (up to 5 MB) are said to use presigned URLs. `POST /rule-versions/{id}/attachments` expects the upload to have happened already, but no endpoint issues the presigned URL.

**Needed:** an upload-URL endpoint, a storage choice, allowed MIME types, and a virus-scan decision.

### 3. Webhooks
`openapi.yaml` lists two webhooks, each described in a single line:
- **Razorpay:** `payment.captured`, `payment.failed`, `refund.processed`
- **WhatsApp:** delivery receipts that update `delivery_attempts`

**Needed:** payload schemas, signature verification, idempotency (gateways retry), and the exact state transitions each event triggers. Cross-check against `src/domain/registration.ts`.

### 4. Background jobs
These are described in prose only:
- match reminders at T−60 min
- waitlist offer expiry and promotion
- notification retries

Other time-based behaviour is implied by the domain code. Check `academy.ts` and `venue.ts` for things like invoice generation and reminders, membership expiry and renewal, and follow-up generation.

**Needed:** a job list with schedules, a queue or scheduler choice, and retry and backoff rules.

### 5. Row-level security (who can read which org's data)
`schema.sql` enables RLS only on `tournaments`, with two policies. The README says to set `app.user_id` per request.

**Needed:** policies for every org-scoped table (bookings, customers, athletes, invoices and so on), or an explicit decision to enforce tenancy in the API layer instead. Minors' data (athletes, guardians, documents) needs particular care.

### 6. Pagination and filtering
No list endpoint is paginated. Some will grow without bound: audit log, bookings, customers, invoices, notifications, score events, leads.

**Needed:** a pagination convention (cursor recommended) applied across list endpoints, plus the indexes to support it.

### 7. Non-functional items not covered
- Rate limiting, especially on public endpoints (`/public/*`) and OTP.
- Real-time updates for live scoring and standings. The front end uses polling or refetches through TanStack Query; decide whether WebSockets or SSE are wanted.
- Environments, migrations tooling, backups, and observability.

## Open product decisions (owner: product)

These come from `docs/spec.md`. Some block backend work.

| # | Decision | Current build default | Blocks |
|---|---|---|---|
| 1 | Payment gateway, refund SLA, who approves exceptions | Razorpay assumed | Payments, webhooks |
| 2 | WhatsApp provider (Gupshup, Interakt, …) and Meta template approval | None chosen | Notifications |
| 3 | **Data retention period** for personal data, documents and minors | Placeholder `[YOUR RETENTION PERIOD]` | Privacy, deletion jobs |
| 4 | Membership revenue recognition | Cash basis (research recommends spreading over validity) | Venue analytics |
| 5 | Official DSL Lagori scoring rules | Configurable actions and points | Scoring defaults |
| 6 | Captain verification enough in competitive events? | Opponent captain *or* organizer can verify | Match verification |
| 7 | Player stats visibility for minors (coach and guardian rules) | Public for adults, private for minors | Stats endpoints |
| 8 | Can Playo repeat a block weekly? | Not decided | Venue holds |
| 9 | Who validates academy measurements? | Head-coach sign-off not enforced | Assessments |
| 10 | Academy refunds and pro-rating | Manual refunds, no pro-rating | Invoices |
| 11 | Owner SaaS only, or also a player marketplace? | Owner-facing | Scope |
| 12 | Weekly owner KPI email | Not built | Jobs |

## Suggested first steps

1. Product answers decisions 1–3. They affect the schema and integrations.
2. Backend reviews `schema.sql` and `openapi.yaml` and proposes designs for gaps 1–6.
3. Build in this order: auth → org and tenancy → tournaments core → payments → venue → academy, switching the front end to `VITE_API_MODE=http` module by module.

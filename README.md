# Densparq Tournaments: front-end and backend handoff

Densparq's venue, academy and tournament platform. The **home page** (`#/`) lets players book courts, request trials and join tournaments, and takes staff to their workspace. **Venue** covers bookings, pricing, CRM, memberships and analytics. **Academy** covers batches, athletes, attendance, fees, admissions and player stats. **Tournaments** cover setup, rules, registration, fixtures, live scoring, standings and reporting.

This repo is the **complete front end**, running against an **in-browser mock API**. The mock implements the real business rules, so the backend team can build the API and database straight from it.

| Read this | For |
|---|---|
| [`docs/spec.md`](docs/spec.md) | Product spec: modules, requirement coverage, acceptance-criteria demos, UX principles, design tokens, open decisions |
| [`docs/flows.md`](docs/flows.md) | Every screen: states, actions, and the exact API call behind each action |
| [`docs/openapi.yaml`](docs/openapi.yaml) | 155 operations with request/response schemas, error codes and allowed roles (`x-roles`). Generated from the mock router. |
| [`docs/schema.sql`](docs/schema.sql) + [`docs/data-model.md`](docs/data-model.md) | PostgreSQL DDL with constraints (court-overlap exclusion, four-eyes check, one published rules version) and the ERD |
| [`docs/research/venue-kpi-definitions.md`](docs/research/venue-kpi-definitions.md) | Researched KPI formulas and benchmarks (sources listed; benchmarks weak) |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | **Start here (backend):** run, create the DB, build the API, connect the live site, go-live checklist, rollback |
| [`docs/BACKEND-HANDOFF.md`](docs/BACKEND-HANDOFF.md) | Gaps not yet specified and open product decisions |
| [`docs/business-rules.md`](docs/business-rules.md) | Fixture generation, scheduling, clashes, scoring reducers for all 6 sports, standings and tie-breakers, registration and refund state machines, notifications, privacy |

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. Use **Viewing as** at the bottom of the sidebar to switch between Organizer, Registration manager, Referee and Captain, and see the role-based UI and 403 handling. **Reset demo data** reseeds everything.

```bash
npm run build:preview
```

This builds `dist-preview/index.html`, a single shareable file.

**Demo data** (generated relative to today):
- **DSL Lagori Open:** live today. Groups plus knockout, one match live, one result disputed, one waiting for verification, Playo block tasks.
- **Kannuru Smash Open:** badminton, registration open, 3 categories including an under-15 with guardians and documents, rules v2 draft with a material change.
- **Weekend 7s League:** football, a league in progress.
- **Corporate Box Cricket Cup:** knockout, tomorrow.
- **Pickleball Doubles Night:** round robin, today.
- **RVCE Ultimate Hat:** frisbee, a second organization at an external venue.
- **Kannuru Juniors Football Fest:** a draft.

## Architecture

```
src/
  domain/        Pure business logic. PORT THIS TO THE BACKEND (or run it on Node).
    types.ts       The contract: every entity, mirrored in schema.sql and openapi.yaml
    fixtures.ts    round robin, snake groups, seeded brackets with byes, greedy scheduler, clash detection
    standings.ts   verified-only tables, ordered tie-breakers, head-to-head mini-league, overrides
    scoring.ts     event-sourced reducers: rally, football, cricket, frisbee, lagori (+ defaults per sport)
    registration.ts state machines, eligibility, capacity/waitlist, refund policy
    academy.ts     academy: sessions, clash checks, attendance, fees, assessments/progress/cohort rank, admissions funnel, retention (+ academy.test.ts)
    venue.ts       venue: availability/conflicts, pricing quote, recurrence, refunds, memberships, KPIs, segments, price suggestions (+ venue.test.ts)
  mock/
    db.ts          seed data (mirrors the tables)
    core.ts        shared mock plumbing (errors, roles, audit)
    academyHandlers.ts / academySeed.ts  academy API + seed (batches are seeded before tournaments so fixtures avoid them)
    venueHandlers.ts / venueSeed.ts  venue API + 60 days of seeded bookings
    handlers.ts    the mock API: one handler per OpenAPI operation, with permissions, side effects, audit and rollback on error
  api/
    client.ts      the only network layer. VITE_API_MODE=mock|http, VITE_API_BASE=/api/v1
    hooks.ts       TanStack Query hooks (one per read) + useAct (mutation + toast + invalidate)
  ui/              kit.tsx (buttons, fields, chips, modal, drawer, confirm-with-reason, toasts, states), RichText (Tiptap), Page header
  pages/
    org/           tournaments list, venues, staff, templates, audit
    t/             Overview, Wizard, Rules, Registrations, Fixtures, Matches, Standings, Stats, Reports, Messages
    score/         referee pad (offline queue)
    public/        public tournament page, registration, entry status
    home/          Home (choose a journey), BookCourt, Trial, MyAthlete (parent view)
    academy/       Overview, Batches, Athletes, Stats, Payments, Admissions
    venue/         Calendar, BookingForm, Customers, Memberships, Pricing, Analytics, Setup
scripts/gen-openapi.py   regenerates docs/openapi.yaml from the mock router
```

**Stack:**
- React 18 + TypeScript (strict)
- Vite
- React Router (hash router for the static preview; switch to the browser router in production)
- TanStack Query
- react-hook-form + zod (wizard)
- Tiptap (rules editor)

Styling is plain CSS with design tokens as CSS variables (`src/styles/app.css`), light and dark. Tailwind was dropped to keep the handoff small, and the tokens map one-to-one onto it if you prefer it.

## Backend team: how to replace the mock

1. **Build the endpoints** in `docs/openapi.yaml`. Each one corresponds to a handler in `src/mock/handlers.ts`, so read that handler for the exact side effects: notifications, audit, waitlist promotion, venue-hold sync.
2. **Port `src/domain/*`** unchanged; it's dependency-free TypeScript. Run the same scoring reducers on the server, so the device's optimistic score and the server's authoritative score always agree.
3. **Create the tables** from `docs/schema.sql`. Turn on row-level security: set `app.user_id` per request.
4. **Integrations:**
   - **Razorpay:** order creation, then the `payment.captured` webhook confirms the entry. Refunds go through the Refunds API.
   - **WhatsApp:** a BSP with approved templates; delivery webhooks update `delivery_attempts`.
   - **Uploads:** presigned URLs for files (rulebooks up to 10 MB, documents up to 5 MB).
   - **Background jobs:** match reminders at T−60 min, waitlist expiry, notification retries.
5. **Switch the front end** with `VITE_API_MODE=http` and `VITE_API_BASE=https://api.densparq.in/api/v1`. The UI expects errors as `{ error: { code, message, details } }` and sends an `Idempotency-Key` on mutations.
6. **Auth:** phone OTP, then a JWT. `GET /me` returns the memberships, and the UI hides navigation by role. The server must still enforce `x-roles`.

## Verified in this build

- `tsc --noEmit` passes with strict mode on.
- A headless smoke test renders all 31 routes with zero console errors.
- End-to-end checks of the main flows:
  - create a tournament through the wizard (validation, then save)
  - publish a material rules change (31 entries flagged for re-accept)
  - public registration through payment ("You're in!")
  - generate and publish fixtures (15 matches, no clashes, 4 venue holds)
  - live-score a pickleball match, then submit, then verify (the four-eyes check correctly blocks self-verification)

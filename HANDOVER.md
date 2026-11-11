# Densparq backend handover

**Repo:** https://github.com/aricodes33/densparq_dashboard_handover (branch `main`)

## Read first
- **`docs/DEPLOYMENT.md`:** run the app, create the database, build the API, host it, go-live checklist, rollback.
- **`docs/BACKEND-HANDOFF.md`:** what isn't specified yet, and the open product decisions.

## What's already built
- A complete React and TypeScript front end covering the Venue, Academy and Tournaments modules. It currently runs on a fake API inside the browser.
- **API contract:** `docs/openapi.yaml`, with 155 operations and the roles allowed to call each one (`x-roles`).
- **Database:** `docs/schema.sql`, PostgreSQL 15+ with 65 tables. Verified to load cleanly on Postgres 16. Needs the `pgcrypto` and `btree_gist` extensions.
- **Reference implementation:** `src/mock/*Handlers.ts`, one handler per endpoint, showing the exact side effects (audit, notifications, waitlist).
- **Business rules:** `src/domain/*.ts`, pure TypeScript (scoring, fixtures, standings, refunds, pricing). Reusable unchanged on a Node/TypeScript backend.
- **Checks:** 18 unit tests and a strict typecheck, both passing: `npm test`, then `npm run build`.

## What the front end expects from the API
- Base path `/api/v1`, and `Authorization: Bearer <JWT>` (issued after phone OTP login).
- Errors as `{ "error": { "code", "message", "details" } }`, with the codes from the spec.
- An `Idempotency-Key` header on every non-GET request. Store it and replay the stored response on repeats.
- Money as integer paise and times in UTC. JSON fields are camelCase.

## Hosting (no specific provider required)
- The front end builds to static files: `VITE_API_MODE=http npm run build`, which outputs `dist/`.
- Serve `dist/` from the **same domain as the API**: from the API server itself, or behind nginx. That needs no CORS and no rewrite rules, because the app uses `#` URLs.
- This was tested: the built site served by a plain Node server called `/api/v1/...` on the same domain with the auth header, and threw no browser errors.
- There's an nginx example and the security headers to set in `docs/DEPLOYMENT.md` §4.
- Stage it against a staging API first.

## Not done yet (to be designed)
- Login: OTP endpoints, plus a login screen on the front end. There isn't one yet; a demo persona picker stands in for it.
- A file-upload endpoint (presigned URLs).
- Razorpay and WhatsApp webhook payloads and signature checks.
- Background jobs: match reminders, waitlist expiry, notification retries.
- Per-organization data access rules: only the tournaments table has them today.
- Pagination on list endpoints.

## Waiting on product decisions
- Payment gateway: Razorpay is assumed.
- WhatsApp provider.
- Data retention period.
- The rest are listed in `docs/BACKEND-HANDOFF.md`.

## Access you'll need
- GitHub: public
- Razorpay test keys, the SMS/OTP provider and file-storage credentials
- Hosting and database accounts

## Next step
Review `schema.sql`, `openapi.yaml` and the gaps list, then send back your proposed approach and a rough timeline.

Contact: [your name, email/phone]

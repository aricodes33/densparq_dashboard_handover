# Business rules

The backend must reproduce these rules exactly. Each one has a reference implementation in `src/domain/*`: pure TypeScript with no I/O, which you can port line by line or run on Node. `src/mock/handlers.ts` shows where each rule applies.

## 1. Tenancy, roles and audit

- Every tournament belongs to one **organization**. Users hold **memberships** with a role per organization.
- Referees act only on matches where they are in `match_officials`. Organizers can do anything in their organization.
- Captains act only on their own registrations and matches.
- The full permission matrix is on the Staff & roles screen (`src/pages/org/OrgPages.tsx`) and in `x-roles` in `openapi.yaml`.
- **Every write is audited**: `audit_log(entity, entity_id, action, by, at, reason, diff)`.
- These actions **require a reason**: reject, withdraw, refund, fee waiver and other exceptions, postpone, abandon, walkover, result correction, standings override, manual stat, unpublish.
- Mutations are **transactional**. A failed rule leaves no partial write (the mock snapshots and rolls back).

## 2. Tournament lifecycle

- Statuses: `draft → published ⇄ unpublished → archived`. `archived` is read-only.
- **Phase** is derived, never stored: `setup` (draft), then `registration`, then `scheduled` once fixtures are published, then `live` once a match is live or play has started, then `completed` once every match is completed, walkover or abandoned.
- **Publish checklist**: `GET /tournaments/:id/checklist`. Publishing is refused with `422 not_ready` while any item fails.
  - basics are filled in
  - registration closes on or before the first day of play
  - at least one category, each with capacity of 2 or more
  - group + knockout formats have at least 2 groups
  - at least one tie-breaker
  - courts are set (or a venue is typed in)
  - rules have content
- **Formats lock** once any fixture in the tournament is published. `PUT` returns `409 format_locked`.
- **Duplicate** deep-copies settings, categories and the latest rules into a new **draft**. Rules are never shared by reference (acceptance criterion #1).

## 2a. Organizer journey (`src/domain/journey.ts`, tests in `journey.test.ts`)

The tournament Overview opens on a 7-stage tracker. Nothing is stored; each stage is derived from state, and the first unfinished stage is "now".

| Stage | Done when |
|---|---|
| 1. Setup | Every publish-checklist item except rules passes |
| 2. Rules | A published rules version exists |
| 3. Publish | The tournament is published |
| 4. Entries | Published, and either fixtures exist or registration has closed with no entries pending payment |
| 5. Fixtures | Every non-custom category has published fixtures |
| 6. Play | Every non-bye match is completed, walkover or abandoned, and every result is verified |
| 7. Finish | `POST /tournaments/:id/finish` has run |

**Finish**:
- Organizer only. Refused with `409 not_ready` while any match is open or unverified.
- Winners per category: the verified final for knockouts, otherwise rank 1 in the table.
- Sets `finished_at`, messages confirmed entrants (`result_published`) and writes to the audit log.
- Archive is offered afterwards.

**Roles**: front desk sees the tracker but not the organizer actions.

## 3. Rules and regulations

- Rules are versioned per tournament: `rule_versions(version 1..n)`. A tournament has at most one `draft` and one `published` version.
- Published versions are **immutable**. Editing means creating a new draft from the latest version, from another tournament, or from a template.
- **Publishing** marks the old published version `superseded` and stores `published_at`, the author, `change_summary` and `material`.
  - `material = true` and version > 1: set `needs_reack = true` on every active registration (confirmed, pending_payment or waitlisted) and send `rules_ack_required` to all of them.
  - `material = false`: send an informational notice. Earlier acceptances stay valid.
- **Unpublish** restores the last superseded version as `published`.
- **Registration** requires `ackVersion == current published version`. Otherwise it returns `422 ack_required`. Store a `rule_acknowledgements` row with the version id, time, user and (backend only) IP and user agent.
- `POST /registrations/:id/ack` with an old version returns `409 stale_version`.
- Written rules (HTML) are **never** read by the engine. Automated logic comes only from `tournaments.scoring`.

## 4. Registration and payments

**Eligibility** (`checkEntry`):
- **Age** is taken on `startDate`. Blocking outside `minAge`/`maxAge`.
- **Roster size**: singles 1, doubles 2, team `rosterMin..rosterMax`.
- **Guardian consent** is required (blocking) for anyone under `guardianConsentUnder` (default 18).
- **Gender mismatch** is a non-blocking warning for organizer review.
- **Duplicates**: with `duplicateCheck = 'phone'`, one active entry per captain phone per category. Enforced by a unique partial index.

**Initial status** (`initialStatus`):
- Capacity counts `confirmed + pending_payment`.
- If full: `waitlisted` when the waitlist is on, otherwise `409 full`.
- Otherwise: `pending_payment` if the fee is above 0, else `confirmed`.

**Registration window**: outside open/close the API returns `409 window_closed`, unless `allowLate` is on or the caller is an organizer.

**Status machine** (`REG_TRANSITIONS`): any other move returns `409 bad_transition`.

| From | Allowed |
|---|---|
| draft | pending_payment, confirmed, waitlisted, withdrawn |
| pending_payment | confirmed, waitlisted, rejected, withdrawn |
| waitlisted | pending_payment, confirmed, rejected, withdrawn |
| confirmed | withdrawn, rejected |
| rejected | pending_payment |
| withdrawn | — |

**Waitlist promotion**: when a confirmed or pending entry leaves, the lowest `waitlist_pos` in that category moves to `pending_payment` (or `confirmed` if free). It gets a `waitlist_promoted` notification.

**Payments (Razorpay)**:
- `POST /registrations/:id/payments` creates an order and returns `razorpayOrderId`.
- Checkout runs on the client.
- The **webhook** `payment.captured` sets `payments.status = captured`, `registration.status = confirmed`, `pay_status = paid` and issues a receipt number. Then it sends `payment_receipt`.
- Never confirm from the client callback alone.

**Refunds**:
- The amount must be at most `paid_paise`.
- The policy amount comes from `refundDue()`: `full_until_close`, `percent_until_close` (× `refundPercent`), or `none`, and is 0 after close.
- Any other amount is an exception and needs a reason.
- `pay_status` becomes `refunded` or `partially_refunded`.

**Fee waiver**: organizer only, with a reason. It confirms the entry and records a zero-value `waiver` payment. Reports show it as waived, not revenue.

**Roster edits**: allowed until `rosterCutoffAt`. After that only organizers can edit (`409 cutoff`).

## 5. Fixtures and scheduling (`src/domain/fixtures.ts`)

### 5.1 Generation

- **Round robin / league**: circle method. Odd counts get a bye. `legs = 2` mirrors the rounds with home and away swapped.
- **Groups**: snake draw by seed (A B C C B A …) so top seeds are in different groups.
- **Knockout**: bracket size is the next power of 2. Seeds are placed in standard order (1 v 8, 4 v 5, 2 v 7, 3 v 6 …). Byes go to the top seeds and are auto-resolved as walkovers with result detail `Bye`.
- **Group + knockout**: qualifiers are ordered rank-major and alternate direction (A1, B1, then B2, A2 …). The bracket draw therefore crosses groups (A1 v B2, B1 v A2).
- **Optional third-place match**: losers of the two semi-finals.
- **Custom format**: nothing is generated. Matches are added by hand and results entered manually.
- **Seeding**: `seeded` uses `registrations.seed`; `random` shuffles. The backend should record the RNG seed in the audit log.

### 5.2 Scheduling

Greedy, in round order:
- Each match gets the **earliest 15-minute slot** on any tournament court where:
  - the slot falls inside `dayStart`–`dayEnd` (IST)
  - the court is free for `duration + buffer`
  - both entries have had at least `minRestMinutes` since their last match
  - the court has no venue **busy block** (Densparq bookings, academy or other holds)
- A knockout round starts only after every earlier-round match has ended.
- Matches that can't be placed stay unscheduled and are reported.

### 5.3 Clashes (`detectClashes`)

| Kind | Blocks publish? |
|---|---|
| court_overlap | **yes** |
| team_overlap | **yes** |
| venue_busy | **yes** |
| rest_gap | warning |
| outside_window | warning |
| unscheduled | warning |

The DB also enforces court overlap with a gist exclusion constraint.

### 5.4 Publish and revise

- `PATCH /matches/:id` on a published match increments `fixtures_version`.
- Publishing again notifies **only the affected entries** (`schedule_changed`). The first publish notifies everyone (`fixtures_published`).
- Postponing requires a reason.
- Completed matches and walkovers can't be moved.

### 5.5 Venue holds (Densparq venues only)

- On fixture publish: one `event` hold per court per day, from the first match start minus 30 min setup to the last match end.
- A new hold gets `playo_status = block_todo`. A released hold that was `blocked` becomes `unblock_todo`.
- These hold rows are the same records the venue operator dashboard shows in "Needs you now", because Playo has no API.

### 5.6 Advancing

After each verified result (and on demand), knockout slots resolve:
- `group` slots fill only when every match in that group is verified.
- `winner`/`loser` slots fill from verified results only.

## 6. Live scoring (`src/domain/scoring.ts`)

**Event sourcing**:
- `score_events` is append-only. `seq` increases per match and `client_id` is unique (the idempotency key from the offline queue).
- Undo is `type = void`, which voids the latest non-voided event. Events are never deleted.
- State = the sport reducer over non-voided events, ordered by `seq`. The same reducers run on the device (optimistic) and on the server (authoritative).

**Match status machine**:

| From | Allowed |
|---|---|
| scheduled | live, postponed, walkover, abandoned |
| postponed | scheduled, abandoned, walkover |
| live | paused, completed, abandoned |
| paused | live, abandoned, completed |
| abandoned | scheduled |

- Events are accepted only when the match is `live` or `paused` (`409 not_live`).
- A referee must be assigned to the match (`403 not_assigned`).

| Sport | Reducer rules |
|---|---|
| Badminton / Pickleball | Rally scoring. A game is won at `pointsToWin` with a 2-point lead, or at `cap`. Match is best of `bestOf`. Server = last rally winner. Defaults: 21/30/3 (badminton), 11/15/3 (pickleball). |
| Football | `period` events `H1, HT, H2, FT, ET1, ET2, PEN, END`. The clock runs in H1/H2/ET1/ET2 and can be stopped or restarted with `clock`. Events: `goal` (side, minute, player?), `card` (yellow/red), `pen` (scored). Finished at `END`. The winner is decided by goals, then penalties. |
| Box cricket | `toss` (batting side), then `ball` (runs, extra wd/nb/b/lb, wicket). Wd and nb add 1 run and are not legal balls. An innings ends on overs, all out (`playersPerSide − 1` wickets) or `innings_end`. Target = first-innings runs + 1. A chase ends when the target is reached. Equal runs = tie. |
| Ultimate frisbee | `point` (side). Half-time at `halftimeAt` (timeouts reset). A game is won at `pointsToWin` with a 2-point lead, or at `cap`. `cap` (time cap): the leader wins. `timeout` is limited per half. `spirit` records 0–20 each way. |
| DSL Lagori | Configurable. `round_start` / `round_end` for `rounds` rounds of `roundSeconds`. `action` (side, key) adds the configured points to the team that did it (`self`) or to the opponent. Finished after the last round. Highest total wins; equal is a draw. **The organizer defines the action labels and points**, because the official Lagori rules aren't encoded yet. |

**Submitting** (`POST /matches/:id/submit`):
- The result is computed from events. If the reducer says the match isn't finished, the API returns `409 not_finished` unless `force` is sent with a reason (ending early).
- **Manual mode** (`scoring.autoScoring = false`, or `manual: true`) takes the scores directly.
- Knockout draws are rejected (`422 draw_in_knockout`).
- Result `verification = submitted`.

**Verifying**:
- Done by an organizer or the opposing captain. **The verifier must not be the submitter** (`409 four_eyes`; DB check constraint).
- Verification triggers: standings recompute, stats marked verified, knockout advance, and a `result_published` notification to both entries.

**Dispute**: any party, with a reason. Sets `verification = disputed` and puts the match in the organizer's "Needs you now".

**Correction**: organizer only, with a reason. The before/after diff goes to the audit log, then the result is re-verified.

**Offline**:
- The device queues events in localStorage and flushes them in order every 3 s and on `online`.
- When a flush returns, only the flushed client IDs are removed from the queue, so taps made during the request survive.
- The referee can't submit until the queue is empty.
- A server `409` or `403` drops the queue and shows the error.

## 7. Standings (`src/domain/standings.ts`)

- Only **verified** results count. If a group has submitted or disputed results, its table is marked `provisional`.
- **Points**: `scoring.points` gives win, draw and loss values, plus separate walkover win and loss values.
- **"Score"** per sport: badminton/pickleball = games, football = goals, cricket = runs, frisbee = points, Lagori = points.
- **Ordering**: `points` first, then the configured tie-breakers in order:
  - `head_to_head`: a mini-league among *exactly the tied entries* (3 for a win, 1 for a draw)
  - `score_diff`
  - `score_for`
  - `wins`
  - `fair_play`: fewest cards. Backend TODO; it needs the card events.
  - `draw_lots`: seeded RNG, recorded in the audit log
- **Qualification**: rank ≤ `qualifiersPerGroup` and played > 0.
- **Overrides**:
  - An organizer requests one with a reason (pending).
  - A *different* organizer approves it (`409 four_eyes`).
  - Once approved, the entry is pinned to that rank and the others shift around it. The row is flagged `overridden`.

## 8. Statistics

- **Auto stats** come from events: football goals by player, and the per-sport team score when the reducer can't attribute to a player.
- **Manual stats** need a reason. A referee's entry is unverified until an organizer confirms it.
- Leaderboards label unverified figures.
- **Visibility**:
  - `players.stats_visibility`: minors default to `private`.
  - The public API (`?public=true`) hides names that aren't `public`.
  - The guardian can change it. Coaches see `coaches`.
- The profile (`GET /players/:id`) is shared with the academy module. Camera and video analytics are a later source; they are **not a launch dependency**.

## 9. Analytics

- **Collected (actual)** = captured payments − processed refunds.
- **Projected** = fees of `pending_payment` entries, always shown with a "not yet collected" label.
- **Conversion** = (paid + waived + confirmed) ÷ started.
- **Average delay** = mean of `max(0, started_at − start_at)` over completed matches.
- **Court use** = scheduled minutes ÷ (play window × days).
- Any figure that includes unverified results says so.

## 10. Notifications

| Event | Kind | Audience |
|---|---|---|
| Entry confirmed / waitlist promoted | `registration_confirmed` / `waitlist_promoted` | that entry |
| Payment captured | `payment_receipt` | that entry |
| Rules material change | `rules_ack_required` | all active entries |
| Fixtures first publish | `fixtures_published` | all active entries |
| Fixtures revision | `schedule_changed` | affected entries only |
| Result verified | `result_published` | both entries |
| Match reminder (backend job: T−60 min) | `match_reminder` | both entries |
| Organizer announcement | `custom` | all / unpaid / re-ack pending |

- **Channels**: in-app always. WhatsApp only if `users.whatsapp_opt_in`, through BSP templates.
- Every attempt is stored in `delivery_attempts`, with provider webhooks updating `sent → delivered → read | failed`.
- Failed WhatsApp sends retry 3× with backoff, then show as failed on the Messages screen.

## 11. Privacy (DPDP Act)

- Under-18s need guardian consent before an entry can be submitted.
- Phones are masked on public endpoints: `98•••••210`.
- Minors' stats are private by default.
- Retention period: [OPEN DECISION, see README].
- Documents are stored privately (S3 or similar with presigned URLs) and are visible only to organizers and registration managers.

---

# Venue management rules (`src/domain/venue.ts`, tests in `venue.test.ts`)

## V1. Roles and scope
| Role | Can |
|---|---|
| Owner (`org_admin`) | everything, all branches; plans; branches |
| Branch manager | bookings, blocks, pricing, offers, agreed rates, campaigns, analytics, membership adjust/cancel. **Only branches in `memberships.venue_ids`** |
| Front desk | bookings, customers, feedback, follow-ups, enrol/renew. No pricing, analytics, campaigns, overrides |
| Customer | own bookings (customer app; out of scope here) |

## V2. Availability: one function, every channel
`conflicts(slot)` is the only availability check. It is used by desk bookings, recurring and group bookings, fixed slots, reschedules, the Playo import and tournament scheduling (`busyOf` includes venue bookings).
- **Blocking clashes**:
  - another booking in `confirmed`, `pending_payment` or `completed` on the same court
  - a block on that court, including tournament event holds
  - a slot outside opening hours
- **Buffer**: the changeover buffer is a warning only.
- **Database**: the `no_double_booking` gist exclusion is the backstop against races.

## V3. Booking types
- **Single.**
- **Group**: several courts, one `group_id`.
- **Weekly recurring**: one `recurrence_id`, up to 52 weeks. Clashing dates are **skipped and returned** in `skipped[]`, never silently dropped.
- **Fixed member slot**: books 4 weeks ahead at the agreed rate. A nightly job keeps the window rolling.

## V4. Pricing (`quote`)
Steps run in this order:
1. **Base price**:
   - The slot is split into 30-minute segments.
   - Each segment is priced by the rate rule for its sport, day type and time. Day type is holiday, then weekend, then weekday.
   - The booking's band is the highest band it touches.
2. **Agreed rate**: a fixed ₹/h or a % off. It applies only if lower, and it **protects** the booking.
3. **Membership**:
   - Covered hours come off first. They are not used at peak unless the plan allows peak.
   - The plan's % discount then applies to the remainder.
   - Membership pricing also **protects** the booking.
4. **Offers**:
   - Eligibility: active, valid that date, band, sport, new customer, minimum hours, maximum uses, and the code if the offer has one.
   - Stacking: the single best non-stackable offer, plus every stackable one.
   - A protected booking only gets stackable offers.
5. **Manager override**: manager role and a reason are required, and both go in the audit log.

**Lock**: the quote is stored on the booking. Rescheduling and later rule changes never reprice it.

**Rule validation**:
- No overlaps for the same sport and day type.
- `min ≤ price ≤ max`.
- Every change is audited with before and after values. That is the price history.

## V5. Cancellation and refunds
- **Policy (per venue)**: full refund at `fullBeforeHours` (24 h) or more before the start; `partialPct`% (50%) at `partialBeforeHours` (6 h) or more; nothing after that.
- **Different amounts**: need the manager role and a reason (audited).
- **Member hours** are returned if the cancellation is at least `plan.cancelNoticeHours` before the start.
- **Payment status flow**: `pending_payment` becomes `confirmed` when payment is collected. After the slot, the booking becomes `completed` or `no_show`.

## V6. Memberships
- **Status** (derived): `active` through the end date, then `grace` for `graceDays`, then `expired`. `cancelled` is sticky.
- **Renewal**:
  - The new period starts the day after the old end, or today if the membership has lapsed.
  - `rolled = floor(hoursLeft × rolloverPct, 0.5 h)`.
  - New hours = plan hours + rolled. Wallet credit is added.
  - The lapsed remainder is logged as `expired`.
- **Ledger**: append-only. Entry types are enrol, hours_used, hours_returned, rollover, expired, adjust and topup. Adjustments need a reason.
- **Plan edits** never change existing members. Terms are snapshotted until renewal.
- **One active membership per customer.** A family plan covers up to `maxMembers` people.

## V7. CRM
- **Segments** (derived, never stored):

| Segment | Rule |
|---|---|
| `new` | created ≤ 30 days ago |
| `regular` | ≥ 4 bookings in the last 30 days |
| `repeat` | ≥ 2 bookings in total |
| `inactive` | ≥ 2 bookings, the last one (past only) > 30 days ago |
| `high_value` | top 10% by net spend |
| `member` | has an active membership |

- **Follow-ups**: generated for inactive customers and memberships ending within 7 days, plus each complaint (due next day). Idempotent through the one-open-per-customer-and-reason index.
- **Campaigns** go **only** to customers with `consent_marketing` and `consent_whatsapp`. Skipped customers are counted and audited. Consent changes are audited with before and after values.

## V8. Analytics
Definitions and sources: `docs/research/venue-kpi-definitions.md`.

| KPI | Formula |
|---|---|
| Sellable court-hours | open hours × active courts × days − blocked court-hours |
| Occupancy | booked hours ÷ sellable hours. Booked includes confirmed, completed and **no-show**; excludes cancelled and tournament bookings. |
| RevPACH | net revenue (paid − refunds) ÷ sellable hours |
| ARR (average realised rate) | net revenue ÷ paid booked hours |
| Cancellation rate | cancelled ÷ all bookings starting in the range |
| Lead time | **median** of (start − created) |
| Repeat rate | customers with ≥ 2 bookings in the range ÷ active customers |
| Retention | previous period's customers who booked again ÷ previous period's customers |
| Membership revenue | enrolments in the range, cash basis. The research suggests spreading it over the validity period; open decision. |

**Comparison**: the same-length period immediately before.

**Alerts**:
- weekly slots under 20% full (only for ranges of 28 days or more)
- memberships expiring within 7 days
- previous-period regulars with 4+ bookings who haven't booked this period
- cancellation rate up 30% or more

## V9. Dynamic pricing (recommendations only)
- **Inputs**: per rate rule, the last 28 days of occupancy (blocks excluded) and the median lead time.
- **Suggestion bands**:

| Occupancy and lead time | Suggestion |
|---|---|
| ≥ 85% and lead ≥ 48 h | +10% |
| ≥ 75% | +5% |
| < 40% | −10% |
| < 25% | −15% |

- Results are rounded to ₹50 and clamped to the rule's min and max.
- **Never applied automatically.** The owner clicks Apply, which is audited as "Applied suggestion: …".
- Agreed rates, member pricing and confirmed bookings are never affected.

---

# Academy rules (`src/domain/academy.ts`, tests `academy.test.ts`)

Research behind the metrics and KPIs: `docs/research/academy-assessment-and-kpis.md`. It found federation-backed age bands; the metric sets are proposals and the benchmarks are gym-only.

## A1. Roles
| Role | Can |
|---|---|
| Owner / branch manager | everything in the academy; batches, fee plans, discounts, refunds, metric templates |
| Front desk | athletes, enrolments, attendance, payments, admissions, reminders |
| Coach | **only their batches** (`batch.coach_user_id`): rosters, attendance, assessments, matches, assessment corrections |
| Guardian | **only their child**: profile, attendance, invoices (and paying them), messages, stats. Read-only otherwise. |
| Public | trial enquiry, court booking, home data |

## A2. Batches and sessions
- **Schedule**: a batch has weekly slots (day, start, minutes, court). Sessions are expanded on read.
- **Holidays**: venue holidays turn a session into `holiday`.
- **Changes**: `session_changes` cancel or reschedule a single date; reschedules are clash-checked.
- **Courts**: every scheduled or rescheduled session is a **venue block** (reason `academy`). Desk bookings, public bookings and tournament scheduling all route around it. Cancelled and holiday sessions free the court.
- **Create/edit clash check**: the next 8 weeks of sessions are checked against live venue bookings and other batches. Any clash returns `409 clashes` with dates.
- **Capacity**: enforced on enrolment; capacity can't be lowered below the number enrolled. Age outside the band is a warning, not a block.

## A3. Attendance
- **Statuses**: present, late, absent, excused.
- **Rate** = (present + late) ÷ (all − excused).
- **Edits**: corrections overwrite the row and add a line to the athlete's history.
- **Alert**: 2 absences in a row in a batch sends an attendance notice to the guardian (in-app, plus WhatsApp with consent).

## A4. Fees
- **Net due** = (amount − discount) × (1 − scholarship%). Discounts and scholarships need a manager and a reason (audited).
- **Status**: void; refunded; paid (paid ≥ net); overdue (past due date); partial; due.
- **Monthly invoices**: one per active enrolment per month, **idempotent** through a unique index. The admission invoice is raised on the first enrolment only.
- **Reminders**: due or overdue within 3 days, counted per invoice. Receipts and reminders go to the athlete's notices.
- **Refunds** are capped at the amount paid. Void is only allowed with no payments.

## A5. Assessments and player stats
- **Templates**: one per sport, versioned. Each metric has key, label, unit (`%`, `count`, `sec`, `m`, `kmh`, or `score` 1–5), test method, higher- or lower-is-better, and validator. Editing creates v+1; old assessments keep their version.
- **Recording**:
  - The first assessment per sport is the `baseline`; later ones are `periodic`.
  - Each value is flagged **measured** or **estimated**; rubric scores are always estimated.
  - Values are range-checked (% ≤ 100, score 1–5, no negatives). Future dates are refused.
- **Corrections**: need a reason; before and after values are kept.
- **Progress**: first vs latest value per metric. "Improved" respects the metric's direction; no change is neutral.
- **Cohort comparison**:
  - The cohort is the same sport, same level, with age inside the athlete's batch band.
  - A rank is shown **only if the cohort has 5 or more assessed athletes**.
  - Score = mean percentile across **measured** values only.
  - **No cross-sport rankings.**
  - Batch rankings are optional and show their rule text.
- **Tournament link**: when `athletes.player_id` is set, verified tournament matches and stats appear on the athlete's profile with a verified or unverified label.
- **Privacy**: minors default to `private`; only the guardian or staff can change it.

## A6. Admissions
- **Stage machine**:

| From | Allowed |
|---|---|
| new | contacted, trial_scheduled, lost |
| contacted | trial_scheduled, lost |
| trial_scheduled | trial_attended, contacted, lost |
| trial_attended | lost (enrolment only via `POST /leads/:id/enrol`) |
| lost | contacted |

- **Required fields**: `lost` needs a reason. `trial_scheduled` needs a batch and a date that has a real session.
- **Enrol**: creates the athlete (guardian consent required for under-18s), the enrolment and the admission invoice in one transaction.
- **Duplicate public enquiries** (same phone and athlete while open) return `409`.

## A7. KPIs

| KPI | Formula |
|---|---|
| Active athletes | athletes with ≥ 1 active enrolment |
| Retention | athletes active at the period start who are still active at the period end. Paused counts as not active. |
| Attendance | as in A3, over the range |
| Collected | payments dated in the range (cash basis) |
| Outstanding | balance of due, partial and overdue invoices |
| Assessment completion | active athletes with an assessment in the last 60 days ÷ active athletes |
| Enquiry → trial | leads that ever reached `trial_scheduled` ÷ leads |
| Trial → enrol | enrolled ÷ leads that ever reached `trial_attended` |
| Show rate | attended ÷ scheduled |

**Alerts**: overdue invoices, athletes without a 60-day assessment, batches under 75% attendance, admissions follow-ups due.

## A8. Notifications
These are integrated, not a separate module:

| Notice | Comes from |
|---|---|
| attendance | Athletes |
| fee | Payments |
| schedule | Batches |
| report | Player stats |

In-app always; WhatsApp only with consent.

## A9. Tournaments for venue staff (added)
- Branch managers have organizer rights in tournaments: create, publish, fixtures, verify results, overrides. Server `ADMIN` = org_admin + branch_manager.
- Front desk has registration-manager rights in tournaments: entries, payments, refunds, messages. Server `DESK`.
- Workspace switcher: Venue | Academy | Tournaments for both roles. One source of truth for roles: `ORGANIZER` / `TDESK` in `src/ui/Page.tsx`, which mirrors `ADMIN` / `DESK` in `src/mock/handlers.ts`.

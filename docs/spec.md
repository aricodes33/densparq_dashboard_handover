# Densparq Tournaments: product spec (v1.0, 7 Nov 2026)

**Source:** *Densparq Tournament Management Requirements v1.0.*
**Design language:** the Densparq venue operator dashboard canvas.
**Decisions confirmed with the product owner:**
- **Tenancy:** multi-organizer.
- **Live scoring at launch:** badminton, pickleball, football (5/7/9-a-side), box cricket, ultimate frisbee and DSL Lagori (configurable rounds pad).
- **Venue link:** Densparq venues write event holds to the venue calendar.
- **Theme:** light and dark.
- **Integrations:** Razorpay; WhatsApp through a BSP.
- **Privacy:** guardian consent for minors.
- **Front-end stack:** React + TypeScript.

## 1. Users and surfaces

| Surface | Who | Device | Purpose |
|---|---|---|---|
| Organizer console | Organizer/admin, registration manager (and a referee read-only view) | Laptop first, works on phone | Set up, run and report on tournaments |
| Referee scoring | Referee/scorekeeper | Phone, dark, works offline | Score assigned matches live |
| Public page + registration | Captains, players, guardians, spectators | Phone first | Register, accept rules, pay; follow fixtures, live scores, standings |

## 2. Modules → requirement coverage

| Requirement (doc §) | Priority | Where | Status in this build |
|---|---|---|---|
| 3.1 Creation & configuration | Essential | Wizard (8 steps), Tournaments list (duplicate/archive), publish/unpublish | Built |
| 3.2 Rules & regulations | Essential | Rules screen: 12 sections, rich text, PDF/Word upload, copy from tournament/template, draft/preview/compare/publish/unpublish, material vs minor, ack tracking, re-ack | Built |
| 3.3 Registration | Essential | Public register flow; Registrations table + drawer; waitlist; duplicates; capacity; documents; consent; payments, receipts, refunds, exceptions; roster cutoff | Built (Razorpay mocked) |
| 3.4 Fixtures & scheduling | Essential | Generate RR/groups/KO/league; auto-schedule with buffers, rest, hours, venue busy; drag calendar; clashes; postpone; revised publish; knockout advance; venue holds | Built |
| 3.5 Live scoring | Highest | Scoring pad for 6 sports, offline queue, undo, pause, statuses, submit → verify → dispute/correct with history; manual entry | Built |
| 3.6 Standings | Essential | Auto tables, configurable points/tie-breakers/qualifiers, brackets, provisional flag, overrides with approval | Built |
| 3.7 Statistics | Highest | Leaderboards, team summary, manual stats with attribution, privacy for minors, shared player profile endpoint | Built (camera analytics is a later source) |
| 3.8 Analytics & reporting | Highest | Overview dashboard + Reports: actual vs projected, refunds, funnel, by category, completion, delays, court use, CSV/print | Built |
| 3.9 Communication | Integrated | Auto notifications on every trigger, announcement composer, delivery stats, bell feed | Built (BSP mocked) |
| 3.10 Sponsors & branding | Phase 2 | Not built. Schema hook: add `sponsors`, `placements` later | Phase 2 |
| 3.11 Media & streaming | Phase 2 | Not built | Phase 2 |

## 3. Acceptance criteria (doc §8) → how to demo

1. **Two tournaments with different rules, no cross-event changes.** Duplicate *Kannuru Smash Open*. Edit the copy's rules draft. The source rules are unchanged, because duplication deep-copies the rules (`POST /tournaments/:id/duplicate`).
2. **Read and acknowledge a specific published version before confirming.** On the public page: Register → Rules step. The accept box is enabled only after scrolling to the end, and the version is stored in `rule_acknowledgements`.
3. **Material update keeps history and notifies participants.** Smash Open → Rules → Publish v2 as *Material*. The version history shows v1 superseded, the Registrations "Rules" column shows "Re-accept", Messages shows `rules_ack_required`, and the entry status page shows the re-accept card.
4. **Fixture generation prevents clashes and supports manual corrections.** Generate fixtures and see "no clashes". Drag two matches onto the same court and time: the red clash banner appears and Publish is blocked. Fix the clash and publish.
5. **Verified results update standings and stats consistently.** Lagori → Matches → To verify → Verify. The standings and the stats provisional flags update and the bracket advances. Both sides use the same verified-only rule.
6. **One dashboard for registrations, revenue and match progress.** The tournament Overview.

## 4. Information architecture

**Sidebar:**
- **Tournament level:** Overview · Setup · Rules · Registrations · Fixtures · Matches · Standings · Player stats · Reports · Messages · Settings · Public page ↗
- **Organization level:** Venues & courts · Rule templates · Staff & roles · Audit log · Referee scoring

Items are hidden by role. For example, a referee sees no Setup, Registrations, Reports or Messages.

## 5. UX principles applied

- **One primary action per screen.** The Overview's primary button changes with the phase (finish setup, generate fixtures, verify results, download reports).
- **"Needs you now"** is one ranked queue covering unpaid entries, documents, re-acks, disputes, results to verify, late starts and Playo block tasks. Each item deep-links to the fix.
- **Safe by default.** Destructive and audited actions need confirmation and a reason. Four-eyes checks apply to results and overrides. Publishing is gated by a checklist and by clash detection. Published rules are immutable.
- **Honest numbers.** Actual vs projected money is labelled. Unverified results are flagged as provisional everywhere.
- **Forgiving forms.** The wizard autosaves, validates per step, focuses the first error and tolerates going back. Registration validates inline before calling the server.
- **Field-ready scoring.** Big tap targets (≥ 72 px), haptic tick, optimistic updates, an offline queue with a visible sync state, undo, and a "can't submit until synced" guard.
- **Accessible.**
  - Real buttons, links and labels; `aria-live` for scores and toasts.
  - Focus trap, ESC and focus restore in dialogs.
  - Keyboard alternative to drag (the Edit button).
  - Colour plus text for every status; contrast checked in both themes.
  - Touch targets ≥ 40–44 px.
- **Responsive.** The sidebar becomes a drawer below 900 px, tables scroll inside their box, and the wizard steps collapse to numbers.

## 6. Design tokens (from the canvas)

| Token | Light | Dark |
|---|---|---|
| Ink | `#0A0A0A` | `#FFFFFF` (text) |
| Lime accent | `#C8F031` | same |
| Soft lime | `#EEF8C4` | `#26301A` |
| Ground / surface / card | `#E9EAE6` / `#FBFBFA` / `#FFFFFF` | `#050505` / `#0A0A0A` / `#141414` |
| Line | `#DCDDD8` | `#262626` |
| Muted text | `#666963` | `#A3A3A3` |
| Money / warning | `#A4470F` on `#FDEEE4` | `#F08A3C` on `#2A1E12` |
| Danger | `#B4232A` on `#FDECEC` | `#FF6B6B` on `#2A1414` |

- **Type:** Space Grotesk for headings and numbers, Inter for body text.
- **Radii:** 28 / 20 / 14 / 10 px.
- **Venue-busy blocks:** the dotted academy texture from the canvas.

## 7. Open decisions (doc §7)

These need product-owner answers before backend launch.

1. **DSL Lagori scoring.** Currently configurable actions and points. Provide the official rules to lock defaults.
2. **Payment gateway.** Assumed Razorpay. Confirm, along with the refund SLA and who can approve exceptions.
3. **WhatsApp BSP.** Gupshup, Interakt or another? Templates need Meta approval: confirmation, receipt, rules re-ack, fixtures, schedule change, reminder, result.
4. **Data retention period** for personal data and documents.
5. **Player stats visibility.** Default is public for adults and private for minors. Confirm the coach and guardian rules.
6. **Can Playo repeat a block every week?** This affects how many hold tasks the desk gets (carried over from the operator dashboard).
7. **Captain verification.** Currently the opponent captain *or* an organizer can verify. Confirm whether captain verification is enough in competitive events.

---

# Venue management (spec v1.0, 7 Nov 2026)

**Source:** *Densparq Venue Management Requirements v1.0.*
**Decisions:**
- Built into the same app.
- Delivery phases 1 + 2.
- Dynamic pricing as **recommendations only**.
- KPI definitions researched (`docs/research/venue-kpi-definitions.md`).

| Module (priority) | Built | Notes |
|---|---|---|
| Bookings & reservations (Essential) | Calendar (day/week), one form for walk-in, phone and online bookings, group, weekly recurring, reschedule, cancel/refund with policy, blocks, audit | WhatsApp confirmations use the same notification pipeline (BSP to be decided) |
| Venue & court configuration (Essential) | Branches, courts, surfaces, sports, hours, slots, buffers, holidays, refund policy, facility profile | Photo upload = URL list in the mock; presigned upload in production |
| Pricing & offers (Essential) | Rates by sport, day type and time band, with guardrails. Offers (code or automatic, eligibility, expiry, max uses, stacking). Agreed rates. Price preview. Manager override. Change history. | Packages and passes are memberships |
| CRM (Essential) | Profiles, consent, history, segments, notes, feedback and complaints, follow-up queue, opt-in campaigns, export | |
| Memberships & packages (Essential) | Monthly/quarterly/annual plans and packs, hours, wallet, discount, tiers, family size, fixed slots at agreed rate, ledger, renewals with rollover and grace | |
| Analytics (Highest) | Owner overview, 8 KPIs vs previous period, alerts, heatmap with drill-down, revenue trend, breakdowns, lead time, customers, memberships, offers, sources, CSV | |
| Dynamic pricing (Decision pending) | Recommendations only, inside guardrails, owner applies | Automation not built |
| Phase 3 | Not built | Forecasting, automated retention, advanced segmentation |

**Open decisions** (doc §12):
1. Owner SaaS only, or also a player marketplace? Built as owner-facing.
2. Payment gateway, WhatsApp provider, which third-party channels first? Playo is assumed through import.
3. Refund and rollover rules are configurable: per venue (refund) and per plan (rollover, grace, notice).
4. **Membership revenue recognition**: cash (built) or spread over the validity period (recommended by the research).
5. KPI cadence: dashboards are live, and a scheduled weekly owner email is not built.

---

# Coaching & academy (spec v1.0, 7 Nov 2026)

**Source:** *Densparq Coaching & Academy Management Requirements v1.0.*
**Decisions:**
- Same app.
- Home page with a public door and a staff door.
- Editable, versioned metric templates seeded from research.
- Read-only parent/athlete page.
- Research on assessment methods and academy KPIs (`docs/research/academy-assessment-and-kpis.md`).

| Module (priority) | Built |
|---|---|
| Academy & batch management (Essential) | Batches by sport, age, level and capacity; coach name and contact; weekly courts with clash checks against venue bookings and other batches; rosters, seats, attendance summaries; cancel/reschedule; venue holidays |
| Athlete management (Essential) | Profiles, guardian and consent, enrolments, transfers, pause/leave, attendance with change history, stats visibility for minors |
| Fees & payments (Essential) | Admission, monthly, term and package plans; invoices, payments (UPI/card/cash), receipts, balances, monthly generation, reminders, discounts, scholarships, refunds, void; collections and outstanding by batch |
| Performance analytics + player stats (Highest) | Template-based assessments (measured vs estimated), progress charts, cohort comparison (same sport, level and age band; 5+ only), match history (manual + linked tournament results), optional batch rankings with rule text, academy-level progression, retention, attendance and assessment completion |
| Trials & admissions CRM (Essential) | Online and desk enquiries, trial scheduling on real sessions, stage pipeline, follow-ups, lost reasons, conversion by source |
| Notifications (Integrated) | Attendance, fee, schedule and report notices per athlete; WhatsApp with consent |
| Competitions & development (Phase 2) | Not built. The tournament link on athlete profiles is the hook. |
| Excluded by the doc | Coach management, curriculum, standalone parent communication |

**Open decisions** (doc §15; the build's defaults are noted):
1. Who validates each measurement? Each metric has a `validator`. Head-coach sign-off is not enforced.
2. Can athletes and parents see leaderboards? Parents see their own child only; there is no public leaderboard.
3. Refunds and academy pricing rules: refunds are manual; there is no pro-rating.
4. Can an athlete belong to several academies? Allowed by the data model (enrolments are per batch); cross-academy portability needs consent (Phase 2).
5. Data retention for minors: [YOUR RETENTION PERIOD].
6. Thresholds for "good" per age band: set from the academy's own data (the research found none published).

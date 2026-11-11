"""Generates docs/openapi.yaml from the route table in src/mock/handlers.ts + the metadata below.
Run: python3 scripts/gen-openapi.py   (keeps the spec in lockstep with the mock API)."""
import re, json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = (root / 'src/mock/handlers.ts').read_text() + (root / 'src/mock/venueHandlers.ts').read_text() + (root / 'src/mock/academyHandlers.ts').read_text()
routes = re.findall(r"\['(GET|POST|PUT|PATCH|DELETE)', '([^']+)'", src)

A, D, R, ANY, PUB = ['org_admin'], ['org_admin', 'registration_manager'], ['org_admin', 'referee'], ['any signed-in'], ['public']
# (summary, tag, roles, request schema, response schema, extra error codes)
M = {
 'GET /me': ('Current user, role and memberships', 'Session', ANY, None, 'Me', []),
 'GET /orgs/{org}/tournaments': ('List tournaments (query: status, include=archived)', 'Tournaments', ANY, None, '[TournamentSummary]', []),
 'POST /orgs/{org}/tournaments': ('Create a draft tournament', 'Tournaments', A, 'TournamentInput', 'Tournament', ['422 validation']),
 'GET /orgs/{org}/venues': ('Venues and their courts', 'Organization', ANY, None, '[VenueWithCourts]', []),
 'GET /orgs/{org}/members': ('Staff and roles', 'Organization', A, None, '[Membership]', []),
 'POST /orgs/{org}/members': ('Invite staff (sends OTP login link)', 'Organization', A, 'InviteInput', 'Membership', ['422 validation']),
 'DELETE /memberships/{id}': ('Remove access', 'Organization', A, None, 'Ok', []),
 'GET /orgs/{org}/audit': ('Audit log (query: tournamentId)', 'Organization', A, None, '[AuditEntry]', []),
 'GET /orgs/{org}/templates': ('Rule templates', 'Rules', ANY, None, '[RuleTemplate]', []),
 'GET /tournaments/{id}': ('Tournament with computed phase', 'Tournaments', ANY, None, 'Tournament', ['404 not_found']),
 'PUT /tournaments/{id}': ('Save setup (wizard autosave). Formats lock after fixtures are published.', 'Tournaments', A, 'TournamentInput', 'Tournament', ['409 archived', '409 format_locked', '422 validation']),
 'POST /tournaments/{id}/duplicate': ('Duplicate as draft; rules are deep-copied, never shared', 'Tournaments', A, None, 'Tournament', []),
 'POST /tournaments/{id}/publish': ('Publish (runs checklist)', 'Tournaments', A, None, 'Tournament', ['422 not_ready (details: ChecklistItem[])']),
 'GET /tournaments/{id}/checklist': ('Publish readiness checklist', 'Tournaments', A, None, '[ChecklistItem]', []),
 'POST /tournaments/{id}/unpublish': ('Hide from public', 'Tournaments', A, 'ReasonInput', 'Tournament', []),
 'POST /tournaments/{id}/archive': ('Archive (read-only)', 'Tournaments', A, None, 'Tournament', []),
 'GET /tournaments/{id}/dashboard': ('Organizer dashboard: entries, actual vs projected money, match progress, needs-attention', 'Analytics', D, None, 'Dashboard', []),
 'GET /tournaments/{id}/journey': ('Organizer journey: 7 stages (setup, rules, publish, entries, fixtures, play, finish) derived from state, first unfinished = now', 'Tournaments', ANY, None, '[JourneyStage]', []),
 'POST /tournaments/{id}/finish': ('Finish: requires every match played and verified; records winners, publishes results, messages confirmed entrants', 'Tournaments', A, None, 'Tournament', ['409 not_ready (details: {open, unverified})', '409 already_finished']),
 'GET /tournaments/{id}/rules': ('All rule versions + acknowledgement stats', 'Rules', ANY, None, 'RulesOverview', []),
 'POST /tournaments/{id}/rules': ('New draft (from latest, another tournament or a template)', 'Rules', A, 'NewDraftInput', 'RuleVersion', ['409 draft_exists']),
 'PATCH /rule-versions/{id}': ('Edit draft sections/attachments', 'Rules', A, 'RuleDraftPatch', 'RuleVersion', ['409 immutable']),
 'POST /rule-versions/{id}/publish': ('Publish; material change -> needs_reack + notify all active entries', 'Rules', A, 'PublishRulesInput', 'RuleVersion', ['409 immutable', '422 validation']),
 'POST /rule-versions/{id}/unpublish': ('Unpublish; previous version becomes live', 'Rules', A, None, 'RuleVersion', []),
 'POST /rule-versions/{id}/attachments': ('Attach PDF/Word rulebook (upload via presigned URL first)', 'Rules', A, 'AttachmentInput', 'Attachment', ['413 too_large', '422 validation']),
 'GET /tournaments/{id}/registrations': ('List entries (query: status, categoryId, q)', 'Registrations', D, None, '[RegistrationWithPlayers]', []),
 'GET /registrations/{id}': ('Entry detail with payments, refunds, acknowledgements, history', 'Registrations', D, None, 'RegistrationDetail', []),
 'POST /tournaments/{id}/registrations/validate': ('Dry-run eligibility (age, gender, guardian, duplicates)', 'Registrations', PUB, 'RegistrationInput', '[EligibilityIssue]', []),
 'POST /tournaments/{id}/registrations': ('Register (requires ackVersion = current published version)', 'Registrations', PUB, 'RegistrationInput', 'Registration', ['409 closed', '409 window_closed', '409 full', '422 ack_required', '422 ineligible']),
 'POST /registrations/{id}/payments': ('Create Razorpay order (real) / capture (mock). Webhook payment.captured confirms.', 'Payments', PUB, 'PaymentInput', 'Payment', ['402 payment_failed', '409 bad_state']),
 'POST /registrations/{id}/ack': ('Accept the current rules version', 'Registrations', ['captain'], 'AckInput', 'Registration', ['409 stale_version']),
 'POST /registrations/{id}/status': ('Move status (state machine); frees place -> promotes waitlist', 'Registrations', D, 'StatusInput', 'Registration', ['409 bad_transition', '422 validation']),
 'POST /registrations/{id}/exceptions': ('Organizer exception (fee waiver, late entry...)', 'Registrations', A, 'ExceptionInput', 'Registration', ['422 validation']),
 'POST /registrations/{id}/refunds': ('Refund via gateway', 'Payments', D, 'RefundInput', 'Refund', ['409 no_payment', '422 validation']),
 'PATCH /registrations/{id}/documents/{docId}': ('Approve/reject a document', 'Registrations', D, 'DocStatusInput', 'RegDocument', []),
 'PATCH /registrations/{id}/roster': ('Edit roster until cutoff', 'Registrations', ['captain', 'org_admin'], 'RosterInput', 'Registration', ['409 cutoff']),
 'GET /tournaments/{id}/matches': ('Matches (query: categoryId, published)', 'Fixtures', ANY, None, '[MatchView]', []),
 'POST /tournaments/{id}/fixtures/generate': ('Generate + auto-schedule a category (replaces unpublished draft)', 'Fixtures', A, 'CategoryRef', 'GenerateResult', ['409 locked', '422 too_few']),
 'GET /tournaments/{id}/clashes': ('Court/team/rest/window/venue clashes', 'Fixtures', A, None, '[Clash]', []),
 'PATCH /matches/{id}': ('Move / assign referee / postpone. Returns clashes for this match.', 'Fixtures', A, 'MatchPatch', 'MatchPatchResult', ['409 finished', '422 validation']),
 'POST /tournaments/{id}/fixtures/publish': ('Publish fixtures (blocked by hard clashes); notify; sync venue holds', 'Fixtures', A, 'PublishFixturesInput', 'PublishFixturesResult', ['422 clashes (details: Clash[])']),
 'POST /tournaments/{id}/fixtures/advance': ('Fill knockout slots from verified standings/results', 'Fixtures', A, 'CategoryRef', '[MatchView]', []),
 'GET /tournaments/{id}/availability': ('Busy blocks on the tournament courts (venue bookings + holds)', 'Fixtures', A, None, '[BusyBlock]', []),
 'GET /tournaments/{id}/venue-holds': ('Event holds written to the Densparq venue calendar', 'Fixtures', A, None, '[VenueHold]', []),
 'GET /matches/{id}': ('Match with score events', 'Scoring', ANY, None, 'MatchDetail', []),
 'POST /matches/{id}/events': ('Append score events (batch, idempotent on clientId). type=void undoes the last event.', 'Scoring', R, 'EventsInput', 'EventsResult', ['403 not_assigned', '409 not_live']),
 'POST /matches/{id}/status': ('live | paused | abandoned | walkover | postponed', 'Scoring', R, 'MatchStatusInput', 'MatchView', ['409 bad_transition', '422 validation']),
 'POST /matches/{id}/submit': ('Submit result (from events, or manual)', 'Scoring', R, 'SubmitInput', 'MatchView', ['409 not_finished', '422 draw_in_knockout']),
 'POST /matches/{id}/verify': ('Verify (not by the submitter) -> standings, stats, bracket, notify', 'Scoring', ['org_admin', 'captain'], None, 'MatchView', ['409 four_eyes', '409 bad_state']),
 'POST /matches/{id}/dispute': ('Dispute a submitted result', 'Scoring', ['org_admin', 'captain', 'referee'], 'ReasonInput', 'MatchView', []),
 'POST /matches/{id}/correct': ('Correct a result (audited, re-verifies)', 'Scoring', A, 'CorrectInput', 'MatchView', ['422 validation']),
 'GET /me/matches': ('Referee: my assigned upcoming/live matches', 'Scoring', R, None, '[MatchView]', []),
 'GET /tournaments/{id}/standings': ('Group/league tables + brackets + overrides', 'Standings', ANY, None, '[CategoryStandings]', []),
 'POST /tournaments/{id}/standings/overrides': ('Request a manual rank override', 'Standings', A, 'OverrideInput', 'StandingOverride', ['422 validation']),
 'POST /standings-overrides/{id}/decide': ('Approve/reject (second organizer)', 'Standings', A, 'DecisionInput', 'StandingOverride', ['409 four_eyes']),
 'GET /tournaments/{id}/stats': ('Leaderboards (query: key, public=true hides minors/private)', 'Stats', ANY, None, 'StatsResult', []),
 'POST /tournaments/{id}/stats': ('Manual stat with attribution', 'Stats', R, 'StatInput', 'PlayerStat', ['422 validation']),
 'GET /players/{id}': ('Player profile across tournaments (permission + consent aware)', 'Stats', ANY, None, 'PlayerProfile', []),
 'GET /tournaments/{id}/reports': ('Funnel, by-category, completion & delays, court use', 'Analytics', D, None, 'Reports', []),
 'GET /tournaments/{id}/notifications': ('Sent messages with delivery stats', 'Communication', D, None, '[Notification]', []),
 'POST /tournaments/{id}/notifications': ('Send announcement (in-app + WhatsApp template)', 'Communication', D, 'AnnouncementInput', 'Notification', ['422 validation']),
 'GET /me/notifications': ('My notification feed', 'Communication', ANY, None, '[Notification]', []),
 'GET /public/t/{slug}': ('Public tournament page data', 'Public', PUB, None, 'PublicTournament', ['404 not_found']),
 'GET /public/t/{slug}/matches': ('Published fixtures, live scores and results', 'Public', PUB, None, '[MatchView]', []),
 'GET /public/registrations/{id}': ('Entry status for the entrant (masked phone, receipt)', 'Public', PUB, None, 'PublicRegistration', []),
}

# Venue management routes, one per line: METHOD path | summary | tag | roles | request | response | errors (comma-sep)
VENUE = """
GET /orgs/{org}/venue-setup|Branches with profile + courts (branch-scoped)|Venue setup|DESK|-|[VenueFull]|
POST /orgs/{org}/venues|Add a branch|Venue setup|OWNER|BranchInput|Venue|422 validation
PUT /venues/{id}/profile|Hours, slots, buffer, refund policy, holidays, facility profile|Venue setup|MGR|VenueProfile|VenueProfile|422 validation
POST /venues/{id}/courts|Add a court|Venue setup|MGR|CourtInput|Court|422 validation
PATCH /courts/{id}|Edit court / toggle bookable|Venue setup|MGR|CourtInput|Court|
GET /venues/{id}/calendar|Bookings + blocks (incl. tournament holds) in a date window (query: from, to)|Bookings|DESK|-|Calendar|
POST /venues/{id}/quote|Price + clash preview (no write)|Bookings|DESK|BookingInput|QuoteResult|
POST /venues/{id}/bookings|Create single / group (several courts) / weekly recurring booking; clashing dates are skipped and returned|Bookings|DESK|BookingInput|BookingCreateResult|409 unavailable,422 validation
GET /bookings/{id}|Booking with customer, refund policy preview, history|Bookings|DESK|-|BookingDetail|
PATCH /bookings/{id}|Reschedule (price stays locked)|Bookings|DESK|RescheduleInput|Booking|409 unavailable,409 bad_state
POST /bookings/{id}/cancel|Cancel with policy refund (override = manager + reason); returns member hours if in time|Bookings|DESK|CancelInput|Booking|409 bad_state,422 validation
POST /bookings/{id}/status|confirmed (payment collected) / completed / no_show|Bookings|DESK|StatusInput|Booking|409 bad_transition
POST /venues/{id}/blocks|Block courts (maintenance, private event, tournament, academy)|Bookings|MGR|BlockInput|Block|409 has_bookings,422 validation
DELETE /blocks/{id}|Remove a block|Bookings|MGR|-|Ok|
GET /orgs/{org}/pricing|Rate rules, offers, agreed rates, holidays, price history (query: venueId)|Pricing|MGR|-|PricingView|
POST /venues/{id}/rate-rules|Add rate rule (no overlaps; price within min/max)|Pricing|MGR|RateRule|RateRule|422 validation
PUT /rate-rules/{id}|Change a rate (audited before/after = price history)|Pricing|MGR|RateRuleChange|RateRule|422 validation
DELETE /rate-rules/{id}|Remove a rate rule|Pricing|MGR|-|Ok|
POST /orgs/{org}/offers|Create offer / coupon|Pricing|MGR|Offer|Offer|422 validation
PATCH /offers/{id}|Edit / pause offer|Pricing|MGR|Offer|Offer|422 validation
POST /customer-rates|Agreed rate for a customer (corporate / regular)|Pricing|MGR|CustomerRate|CustomerRate|422 validation
DELETE /customer-rates/{id}|Remove agreed rate|Pricing|MGR|-|Ok|
GET /venues/{id}/recommendations|Dynamic-pricing suggestions (recommendations only, inside guardrails)|Pricing|MGR|-|[Recommendation]|
GET /orgs/{org}/customers|Directory with stats + segments (query: segment, q, sport)|CRM|DESK|-|[CustomerRow]|
POST /orgs/{org}/customers|Add customer (dedupe by phone)|CRM|DESK|CustomerInput|Customer|409 duplicate,422 validation
GET /customers/{id}|Profile, bookings, memberships, feedback, follow-ups, agreed rate|CRM|DESK|-|CustomerDetail|
PATCH /customers/{id}|Edit profile / consent (consent changes audited)|CRM|DESK|CustomerInput|Customer|422 validation
POST /customers/{id}/notes|Add desk note|CRM|DESK|NoteInput|Customer|
GET /orgs/{org}/feedback|Feedback & complaints log|CRM|DESK|-|[Feedback]|
POST /customers/{id}/feedback|Log feedback; complaint auto-creates a follow-up|CRM|DESK|FeedbackInput|Feedback|422 validation
PATCH /feedback/{id}|Update status / resolution|CRM|DESK|FeedbackPatch|Feedback|422 validation
GET /orgs/{org}/followups|Follow-up queue|CRM|DESK|-|[FollowUp]|
POST /orgs/{org}/followups/generate|Create follow-ups for inactive customers + expiring memberships (idempotent)|CRM|DESK|-|GenerateFollowUps|
PATCH /followups/{id}|Done / reschedule|CRM|DESK|FollowUpPatch|FollowUp|
POST /orgs/{org}/campaigns|Message a segment; only customers with marketing + WhatsApp consent receive it|CRM|MGR|CampaignInput|CampaignResult|422 validation
GET /orgs/{org}/plans|Membership plans with active counts|Memberships|DESK|-|[Plan]|
POST /orgs/{org}/plans|Create plan|Memberships|OWNER|Plan|Plan|422 validation
PATCH /plans/{id}|Edit plan (existing members keep terms until renewal)|Memberships|OWNER|Plan|Plan|422 validation
GET /orgs/{org}/memberships|Memberships (query: status)|Memberships|DESK|-|[MembershipRow]|
POST /orgs/{org}/memberships|Enrol|Memberships|DESK|EnrolInput|VMembership|409 already_member,422 validation
GET /vmemberships/{id}|Membership with ledger + bookings|Memberships|DESK|-|MembershipDetail|
POST /vmemberships/{id}/renew|Renew; rollover per plan; ledger entries|Memberships|DESK|-|VMembership|409 bad_state
POST /vmemberships/{id}/cancel|Cancel (no renewal)|Memberships|MGR|ReasonInput|VMembership|422 validation
POST /vmemberships/{id}/adjust|Adjust hours / wallet top-up (audited)|Memberships|MGR|AdjustInput|VMembership|422 validation
PUT /vmemberships/{id}/fixed-slots|Save fixed weekly slots at agreed rate; books the next 4 weeks|Memberships|MGR|FixedSlotsInput|FixedSlotsResult|
GET /orgs/{org}/analytics|KPIs vs previous period, heatmap, trends, breakdowns, alerts (query: venueId, from, to)|Analytics|MGR|-|VenueAnalytics|
GET /orgs/{org}/analytics/bookings|Drill-down to bookings (query: venueId, from, to, weekday, hour, sport, source, status)|Analytics|MGR|-|[Booking]|
"""
ACADEMY = """
GET /orgs/{org}/academies|Academies (one per branch venue)|Academy|STAFF|-|[Academy]|
GET /orgs/{org}/academy/overview|KPIs, alerts, trial funnel, most improved, per-batch report (query: academyId, from, to)|Academy|DESK|-|AcademyOverview|
GET /academies/{id}/batches|Batches with seats, 30-day attendance, next session (coach: own batches)|Batches|STAFF|-|[BatchView]|
POST /academies/{id}/batches|Create batch; rejects court clashes with bookings/batches over 8 weeks|Batches|MGR|BatchInput|Batch|409 clashes,422 validation
PATCH /batches/{id}|Edit batch (schedule re-checked for clashes; families notified)|Batches|MGR|BatchInput|Batch|409 clashes,422 validation
GET /batches/{id}|Roster with marks for a date, sessions −14..+28 days, changes (query: date)|Batches|STAFF|-|BatchDetail|
POST /batches/{id}/sessions/change|Cancel or reschedule one session (reschedule clash-checked)|Batches|MGR|SessionChangeInput|SessionChange|409 unavailable,422 validation
PUT /batches/{id}/attendance|Mark attendance for a date; 2 absences in a row alerts the guardian|Batches|STAFF|AttendanceInput|AttendanceResult|422 validation
GET /orgs/{org}/athletes|Directory (query: q, batchId, status)|Athletes|STAFF|-|[AthleteRow]|
POST /orgs/{org}/athletes|Create athlete (under-18 requires guardian + consent); optional batch|Athletes|DESK|AthleteInput|Athlete|409 full,422 validation
GET /athletes/{id}|Profile, enrolments, attendance, invoices, family messages, change history (guardian: own child)|Athletes|READ|-|AthleteDetail|
PATCH /athletes/{id}|Edit profile / stats visibility (history kept)|Athletes|DESK|AthleteInput|Athlete|422 validation
POST /athletes/{id}/enrol|Enrol in batch (capacity; admission invoice on first batch)|Athletes|DESK|EnrolBatchInput|Enrollment|409 full,409 duplicate
POST /enrollments/{id}/transfer|Transfer to another batch|Athletes|DESK|TransferInput|Enrollment|409 full,422 validation
POST /enrollments/{id}/end|Leave or pause|Athletes|DESK|EndInput|Enrollment|422 validation
GET /orgs/{org}/fees|Fee plans, invoices with status, totals (query: status, period)|Fees|DESK|-|FeesView|
POST /academies/{id}/fee-plans|Create fee plan|Fees|MGR|FeePlan|FeePlan|422 validation
POST /orgs/{org}/invoices/generate|Monthly invoices for active enrolments (idempotent)|Fees|MGR|PeriodInput|GenerateInvoices|422 validation
POST /invoices/{id}/payments|Record payment (staff) or pay online (guardian)|Fees|PAY|PaymentInput|InvoiceView|422 validation
POST /invoices/{id}/adjust|Discount / scholarship with reason (audited)|Fees|MGR|AdjustInvoiceInput|InvoiceView|422 validation
POST /invoices/{id}/refund|Refund with reason|Fees|MGR|RefundInput|InvoiceView|422 validation
POST /invoices/{id}/void|Void unpaid invoice|Fees|MGR|ReasonInput|InvoiceView|409 has_payments
POST /orgs/{org}/invoices/remind|Fee reminders for due/overdue (in-app + WhatsApp w/ consent)|Fees|DESK|-|RemindResult|
GET /orgs/{org}/metric-templates|Sport metric templates (unit, test method, direction, validator)|Player stats|STAFF|-|[MetricTemplate]|
PUT /metric-templates/{id}|New template version (old assessments keep theirs)|Player stats|MGR|MetricTemplate|MetricTemplate|422 validation
GET /athletes/{id}/stats|Progress per metric, cohort rank (same sport/level/age band, ≥5), matches, linked tournament stats|Player stats|READ|-|StatsView|
POST /athletes/{id}/assessments|Record assessment (measured vs estimated per value)|Player stats|STAFF|AssessmentInput|Assessment|403 forbidden,422 validation
PATCH /assessments/{id}|Correct values with reason (history kept)|Player stats|COACH|AssessmentPatch|Assessment|422 validation
POST /athletes/{id}/matches|Add a manual match result|Player stats|STAFF|MatchInput|AthleteMatch|422 validation
GET /batches/{id}/rankings|Optional batch ranking with its rule text|Player stats|STAFF|-|Rankings|
GET /orgs/{org}/leads|Leads + funnel, by source, lost reasons (query: from, to)|Admissions|DESK|-|LeadsView|
POST /orgs/{org}/leads|Add enquiry (desk)|Admissions|DESK|LeadInput|Lead|422 validation
POST /public/academies/{id}/trial|Public trial enquiry|Public|PUB|LeadInput|Ok|409 duplicate,422 validation
POST /leads/{id}/stage|Move stage (state machine; lost needs reason; trial needs a real session)|Admissions|DESK|LeadStageInput|Lead|409 bad_transition,422 validation
PATCH /leads/{id}|Follow-up date / notes|Admissions|DESK|LeadPatch|Lead|
POST /leads/{id}/enrol|Enrol after attended trial: creates athlete + enrolment + admission invoice|Admissions|DESK|LeadEnrolInput|LeadEnrolResult|409 bad_state,409 full,422 validation
GET /me/athletes|Guardian: my children|Athletes|GUARD|-|[AthleteRef]|
GET /public/home|Landing data: open tournaments, academy batches with seats, venues|Public|PUB|-|PublicHome|
GET /public/venues/{id}/slots|Free 1-hour slots per court with price (query: date, sport)|Public|PUB|-|[PublicSlot]|
POST /public/venues/{id}/bookings|Public booking (same availability + pricing as desk) → pending payment|Public|PUB|PublicBookingInput|PublicBookingResult|409 unavailable,422 validation
POST /public/bookings/{id}/pay|Pay a public booking (Razorpay in production)|Public|PUB|-|PayResult|409 bad_state
"""
ROLESET = {'OWNER': ['org_admin'], 'MGR': ['org_admin', 'branch_manager'], 'DESK': ['org_admin', 'branch_manager', 'front_desk'], 'STAFF': ['org_admin', 'branch_manager', 'front_desk', 'coach'], 'COACH': ['org_admin', 'branch_manager', 'coach'], 'READ': ['org_admin', 'branch_manager', 'front_desk', 'coach (own batches)', 'guardian (own child)'], 'PAY': ['org_admin', 'branch_manager', 'front_desk', 'guardian (own child)'], 'GUARD': ['guardian'], 'PUB': ['public']}
for line in filter(None, (VENUE + ACADEMY).strip().splitlines()):
    k, s_, tag, roles, req, res, errs = line.split('|')
    M[k] = (s_ + ' (branch-scoped)' * (roles in ('MGR', 'DESK')), tag, ROLESET[roles], None if req == '-' else req, res, [e for e in errs.split(',') if e])

O = lambda **p: {'type': 'object', 'properties': p}
S, I, B, N = {'type': 'string'}, {'type': 'integer'}, {'type': 'boolean'}, {'type': 'number'}
DT, DATE = {'type': 'string', 'format': 'date-time'}, {'type': 'string', 'format': 'date'}
E = lambda *v: {'type': 'string', 'enum': list(v)}
ref = lambda n: {'$ref': f'#/components/schemas/{n}'}
arr = lambda x: {'type': 'array', 'items': x}
SPORT = E('badminton', 'pickleball', 'football', 'box_cricket', 'frisbee', 'lagori')

VENUE_SCHEMAS = {n: {'type': 'object', 'description': f'See src/domain/venue.ts or academy.ts ({n})', 'additionalProperties': True} for n in
  ['VenueFull', 'BranchInput', 'Venue', 'VenueProfile', 'CourtInput', 'Calendar', 'BookingDetail', 'PricingView', 'RateRule', 'RateRuleChange', 'Offer', 'CustomerRate', 'Recommendation',
   'CustomerRow', 'CustomerInput', 'Customer', 'CustomerDetail', 'NoteInput', 'Feedback', 'FeedbackInput', 'FeedbackPatch', 'FollowUp', 'FollowUpPatch', 'GenerateFollowUps', 'CampaignInput', 'CampaignResult',
   'Plan', 'MembershipRow', 'EnrolInput', 'VMembership', 'MembershipDetail', 'AdjustInput', 'FixedSlotsInput', 'FixedSlotsResult', 'VenueAnalytics', 'Block', 'BlockInput', 'RescheduleInput', 'CancelInput',
   'Academy', 'AcademyOverview', 'BatchView', 'BatchInput', 'BatchDetail', 'SessionChangeInput', 'SessionChange', 'AttendanceInput', 'AttendanceResult', 'AthleteRow', 'AthleteInput', 'Athlete', 'AthleteDetail', 'EnrolBatchInput', 'Enrollment', 'TransferInput', 'EndInput',
   'FeesView', 'FeePlan', 'PeriodInput', 'GenerateInvoices', 'InvoiceView', 'AdjustInvoiceInput', 'RemindResult', 'MetricTemplate', 'StatsView', 'AssessmentInput', 'Assessment', 'AssessmentPatch', 'MatchInput', 'AthleteMatch', 'Rankings',
   'LeadsView', 'LeadInput', 'Lead', 'LeadStageInput', 'LeadPatch', 'LeadEnrolInput', 'LeadEnrolResult', 'AthleteRef', 'PublicHome', 'PublicSlot', 'PublicBookingInput', 'PublicBookingResult', 'PayResult']}

schemas = {
 'Error': O(error=O(code=S, message=S, details={})),
 'Ok': O(ok=B),
 'Me': O(user=ref('User'), role=S, memberships=arr(ref('Membership'))),
 'User': O(id=S, name=S, phone=S, email=S),
 'Membership': O(id=S, userId=S, orgId=S, role=E('org_admin', 'registration_manager', 'referee', 'captain', 'player', 'spectator'), user=ref('User')),
 'InviteInput': {**O(name=S, phone={'type': 'string', 'pattern': r'^\d{10}$'}, role=S), 'required': ['name', 'phone', 'role']},
 'Court': O(id=S, venueId=S, name=S, sports=arr(SPORT), densparqSpaceId=S),
 'VenueWithCourts': O(id=S, orgId=S, name=S, address=S, isDensparq=B, courts=arr(ref('Court'))),
 'FormatConfig': O(type=E('league', 'round_robin', 'group_knockout', 'knockout', 'custom'), groups=I, qualifiersPerGroup=I, legs=E('1', '2'), seeding=E('random', 'seeded'), thirdPlace=B),
 'Category': O(id=S, name=S, eventType=E('singles', 'doubles', 'team'), gender=E('open', 'men', 'women', 'mixed'), minAge=I, maxAge=I, skill=S, capacity=I, feePaise=I, rosterMin=I, rosterMax=I, format=ref('FormatConfig')),
 'ScheduleConfig': O(matchMinutes=I, bufferMinutes=I, minRestMinutes=I, dayStart=S, dayEnd=S, createVenueHolds=B),
 'RegistrationConfig': O(requiredDocs=arr(E('id_proof', 'age_proof', 'institution_id')), guardianConsentUnder=I, waitlist=B, allowLate=B, refundPolicy=E('full_until_close', 'percent_until_close', 'none'), refundPercent=I, duplicateCheck=E('phone', 'player_id', 'none')),
 'ScoringConfig': {**O(sport=SPORT, autoScoring=B, points=O(win=I, draw=I, loss=I, walkoverWin=I, walkoverLoss=I), tieBreakers=arr(E('points', 'head_to_head', 'score_diff', 'score_for', 'wins', 'fair_play', 'draw_lots')),
   rally=O(pointsToWin=I, cap=I, bestOf=I), football=O(halfMinutes=I, extraTimeMinutes=I, penalties=B, squadOnPitch=I), cricket=O(overs=I, ballsPerOver=I, playersPerSide=I),
   frisbee=O(pointsToWin=I, cap=I, halftimeAt=I, timeoutsPerHalf=I, spiritScoring=B), lagori=O(rounds=I, roundSeconds=I, actions=arr(O(key=S, label=S, points=I, side=E('self', 'opponent'))))), 'description': 'Machine-readable scoring/standings config. Separate from written rules.'},
 'TournamentInput': O(name=S, sport=SPORT, organizerName=S, venueId=S, venueText=S, startDate=DATE, endDate=DATE, regOpensAt=DT, regClosesAt=DT, rosterCutoffAt=DT, contact=O(name=S, phone=S, email=S), description=S,
   prizes=arr(O(place=S, description=S, amountPaise=I)), courtIds=arr(S), categories=arr(ref('Category')), schedule=ref('ScheduleConfig'), registration=ref('RegistrationConfig'), scoring=ref('ScoringConfig'), staff=arr(O(userId=S, role=S))),
 'Tournament': {'allOf': [ref('TournamentInput'), O(id=S, orgId=S, slug=S, status=E('draft', 'published', 'unpublished', 'archived'), phase=E('setup', 'registration', 'scheduled', 'live', 'completed'), createdAt=DT, updatedAt=DT, publishedAt=DT)]},
 'TournamentSummary': {'allOf': [ref('Tournament'), O(counts=O(entries=I, capacity=I, matches=I, done=I, live=I))]},
 'ChecklistItem': O(id=S, label=S, ok=B, step=I),
 'JourneyStage': O(key=E('setup', 'rules', 'publish', 'entries', 'fixtures', 'play', 'finish'), label=S, status=E('done', 'now', 'later'), detail=S, cta=O(label=S, to=S)),
 'ReasonInput': O(reason=S),
 'RuleSection': O(key=S, title=S, html={'type': 'string', 'description': 'Sanitised HTML'}),
 'Attachment': O(id=S, name=S, sizeBytes=I, mime=S, url=S),
 'AttachmentInput': O(name=S, sizeBytes=I, mime=S, storageKey=S),
 'RuleVersion': O(id=S, tournamentId=S, version=I, status=E('draft', 'published', 'unpublished', 'superseded'), sections=arr(ref('RuleSection')), attachments=arr(ref('Attachment')), material=B, changeSummary=S, authorName=S, createdAt=DT, publishedAt=DT),
 'RuleTemplate': O(id=S, name=S, sections=arr(ref('RuleSection'))),
 'RulesOverview': O(versions=arr(ref('RuleVersion')), published=ref('RuleVersion'), ackStats=O(total=I, onLatest=I, needsReack=I)),
 'NewDraftInput': O(fromTournamentId=S, templateId=S),
 'RuleDraftPatch': O(sections=arr(ref('RuleSection')), changeSummary=S),
 'PublishRulesInput': O(material=B, changeSummary=S),
 'Player': O(id=S, name=S, phone=S, dob=DATE, gender=E('m', 'f', 'x'), guardian=O(name=S, phone=S, relation=S, consentAt=DT), statsVisibility=E('public', 'coaches', 'private')),
 'RegDocument': O(id=S, type=S, name=S, status=E('pending', 'approved', 'rejected'), playerId=S),
 'Registration': O(id=S, tournamentId=S, categoryId=S, entryName=S, captainId=S, captainPhone=S, playerIds=arr(S), status=E('draft', 'pending_payment', 'confirmed', 'waitlisted', 'rejected', 'withdrawn'),
   payStatus=E('unpaid', 'pending', 'paid', 'refunded', 'partially_refunded', 'waived'), amountPaise=I, paidPaise=I, ackVersion=I, needsReack=B, documents=arr(ref('RegDocument')), exceptions=arr(O(type=S, reason=S, approvedBy=S, at=DT)), seed=I, waitlistPos=I, createdAt=DT, confirmedAt=DT),
 'RegistrationWithPlayers': {'allOf': [ref('Registration'), O(players=arr(ref('Player')))]},
 'RegistrationDetail': {'allOf': [ref('RegistrationWithPlayers'), O(payments=arr(ref('Payment')), refunds=arr(ref('Refund')), acks=arr(O(version=I, acceptedAt=DT)), audit=arr(ref('AuditEntry')))]},
 'RegistrationInput': {**O(categoryId=S, entryName=S, captainPhone=S, ackVersion=I, players=arr(ref('Player')), documents=arr(O(type=S, name=S, storageKey=S))), 'required': ['categoryId', 'captainPhone', 'ackVersion', 'players']},
 'EligibilityIssue': O(playerId=S, field=S, message=S, blocking=B),
 'PaymentInput': O(method=E('upi', 'card', 'netbanking')),
 'Payment': O(id=S, amountPaise=I, method=S, status=E('created', 'captured', 'failed', 'refunded'), gatewayRef=S, receiptNo=S, createdAt=DT, razorpayOrderId=S),
 'Refund': O(id=S, paymentId=S, amountPaise=I, reason=S, status=S, createdAt=DT),
 'AckInput': O(version=I), 'StatusInput': O(status=S, reason=S), 'ExceptionInput': O(type=E('fee_waiver', 'late_entry', 'roster_exception', 'eligibility_exception'), reason=S),
 'RefundInput': O(amountPaise=I, reason=S), 'DocStatusInput': O(status=E('approved', 'rejected')), 'RosterInput': O(players=arr(ref('Player'))), 'CategoryRef': O(categoryId=S),
 'Slot': O(kind=E('entry', 'group', 'winner', 'loser', 'bye'), regId=S, group=S, rank=I, matchId=S),
 'MatchResult': O(homeScore=I, awayScore=I, detail=S, winnerId=S, isDraw=B, walkover=E('home', 'away'), verification=E('submitted', 'verified', 'disputed'), submittedBy=S, submittedAt=DT, verifiedBy=S, verifiedAt=DT, disputeReason=S, source=E('live', 'manual')),
 'MatchView': O(id=S, code=S, categoryId=S, categoryName=S, stage=E('league', 'group', 'knockout'), round=I, roundName=S, group=S, home=ref('Slot'), away=ref('Slot'), homeId=S, awayId=S, homeName=S, awayName=S, courtId=S, courtName=S, startAt=DT, durationMin=I,
   status=E('scheduled', 'live', 'paused', 'completed', 'abandoned', 'walkover', 'postponed'), result=ref('MatchResult'), refereeIds=arr(S), referees=arr(S), fixturesVersion=I, published=B, sport=SPORT, live=ref('LiveSummary')),
 'LiveSummary': O(home=I, away=I, detail=S, winner=S, isDraw=B, finished=B, headline=S),
 'ScoreEvent': O(id=S, seq=I, clientId=S, type={'type': 'string', 'description': 'point | goal | card | period | clock | pen | toss | ball | innings_end | timeout | cap | spirit | round_start | round_end | action | void'}, payload={'type': 'object'}, by=S, at=DT, voided=B),
 'MatchDetail': {'allOf': [ref('MatchView'), O(tournament=O(id=S, name=S, sport=SPORT, scoring=ref('ScoringConfig')), events=arr(ref('ScoreEvent')))]},
 'EventsInput': O(events=arr(O(clientId=S, type=S, payload={'type': 'object'}, at=DT))), 'EventsResult': O(accepted=I, events=arr(ref('ScoreEvent'))),
 'MatchStatusInput': O(status=S, reason=S, winner=E('home', 'away')), 'SubmitInput': O(manual=B, homeScore=I, awayScore=I, detail=S, winner=E('home', 'away'), force=B, reason=S, verify=B),
 'CorrectInput': O(homeScore=I, awayScore=I, detail=S, reason=S),
 'MatchPatch': O(courtId=S, startAt=DT, refereeIds=arr(S), status=E('postponed', 'scheduled'), reason=S),
 'Clash': O(matchId=S, otherId=S, kind=E('court_overlap', 'team_overlap', 'rest_gap', 'outside_window', 'venue_busy', 'unscheduled'), message=S),
 'MatchPatchResult': O(match=ref('MatchView'), clashes=arr(ref('Clash'))), 'GenerateResult': O(matches=arr(ref('MatchView')), clashes=arr(ref('Clash'))),
 'PublishFixturesInput': O(categoryId=S, notify=B), 'PublishFixturesResult': O(published=I, notified=I),
 'BusyBlock': O(courtId=S, startAt=DT, endAt=DT, label=S),
 'VenueHold': O(id=S, courtId=S, startAt=DT, endAt=DT, type=S, playoStatus=E('block_todo', 'blocked', 'unblock_todo', 'unblocked'), note=S),
 'StandingRow': O(regId=S, name=S, group=S, played=I, won=I, drawn=I, lost=I, scoreFor=I, scoreAgainst=I, diff=I, points=I, rank=I, qualified=B, overridden=B, provisional=B),
 'StandingOverride': O(id=S, categoryId=S, group=S, regId=S, rank=I, reason=S, requestedBy=S, approvedBy=S, status=E('pending', 'approved', 'rejected'), at=DT),
 'CategoryStandings': O(categoryId=S, name=S, format=S, rows=arr(ref('StandingRow')), bracket=arr(ref('MatchView')), overrides=arr(ref('StandingOverride'))),
 'OverrideInput': O(categoryId=S, group=S, regId=S, rank=I, reason=S), 'DecisionInput': O(decision=E('approved', 'rejected')),
 'PlayerStat': O(id=S, matchId=S, playerId=S, regId=S, key=S, value=N, verified=B, source=E('auto', 'manual'), by=S, at=DT),
 'StatInput': O(matchId=S, playerId=S, regId=S, key=S, value=N, reason=S),
 'StatsResult': O(keys=arr(S), leaderboard=arr(O(playerId=S, name=S, entry=S, value=N, matches=I, verified=B, hidden=B)), teams=arr(O(regId=S, name=S, played=I, won=I, scored=I, conceded=I, unverified=I))),
 'PlayerProfile': O(player=ref('Player'), entries=arr(ref('Registration')), stats=arr(ref('PlayerStat')), matches=arr(ref('MatchView'))),
 'Dashboard': O(phase=S, entries=O(confirmed=I, pending=I, waitlisted=I, rejected=I, withdrawn=I, capacity=I), money=O(collectedPaise=I, refundedPaise=I, projectedPaise=I),
   matches=O(total=I, completed=I, live=arr(ref('MatchView')), toVerify=arr(ref('MatchView')), late=arr(ref('MatchView')), next=arr(ref('MatchView'))), categories=arr(O(id=S, name=S, capacity=I, confirmed=I, pending=I, waitlisted=I)), attention=arr(O(kind=E('danger', 'money', 'neutral'), text=S, to=S))),
 'Reports': O(funnel=O(started=I, submitted=I, paid=I, confirmed=I, conversion=N), byCategory=arr(O(name=S, confirmed=I, capacity=I, withdrawn=I, revenuePaise=I)), completion=O(scheduled=I, completed=I, abandoned=I, avgDelayMin=N, verified=I, unverified=I), courts=arr(O(court=S, minutes=I, utilisation=N))),
 'Notification': O(id=S, kind=S, title=S, body=S, recipientRegIds=arr(S), channels=arr(E('in_app', 'whatsapp')), createdAt=DT, stats=O(queued=I, delivered=I, read=I, failed=I)),
 'AnnouncementInput': O(audience=E('all', 'unpaid', 'reack'), title={'type': 'string', 'maxLength': 60}, body={'type': 'string', 'maxLength': 500}),
 'AuditEntry': O(id=S, entity=S, entityId=S, action=S, byName=S, at=DT, reason=S, diff={'type': 'object'}),
 'PublicTournament': {'allOf': [ref('Tournament'), O(venue=ref('VenueWithCourts'), rules=ref('RuleVersion'), categories=arr({'allOf': [ref('Category'), O(taken=I, waitlisted=I)]}))]},
 'PublicRegistration': O(id=S, entryName=S, status=S, captainPhone={'type': 'string', 'description': 'masked'}, players=arr(O(name=S)), ackVersion=I, needsReack=B, amountPaise=I, receipt=S, waitlistPos=I, createdAt=DT),
}
def resp(n): return arr(ref(n[1:-1])) if n.startswith('[') else ref(n)
schemas.update(VENUE_SCHEMAS)
schemas['Quote'] = O(lines=arr(O(label=S, amountPaise=I, kind=E('base', 'contract', 'member', 'offer', 'override'))), basePaise=I, totalPaise=I, band=E('off_peak', 'standard', 'peak'), memberHours=N, offerIds=arr(S), locked=B)
schemas['Booking'] = O(id=S, venueId=S, courtId=S, customerId=S, customerName=S, startAt=DT, endAt=DT, sport=SPORT, source=E('walk_in', 'phone', 'app', 'playo', 'tournament'), status=E('confirmed', 'pending_payment', 'completed', 'cancelled', 'no_show'), quote=ref('Quote'), paidPaise=I, refundPaise=I, recurrenceId=S, groupId=S, membershipId=S, notes=S, createdAt=DT, cancelReason=S)
schemas['BookingInput'] = {**O(courtIds=arr(S), sport=SPORT, date=DATE, start={'type': 'string', 'pattern': '^\\d{2}:\\d{2}$'}, minutes=I, source=S, customerId=S, customer=O(name=S, phone=S, whatsapp=B), repeatUntil=DATE, code=S, useMembership=B, paid=B, override=O(totalPaise=I, reason=S), notes=S), 'required': ['courtIds', 'sport', 'date', 'start', 'minutes']}
schemas['QuoteResult'] = O(quote=ref('Quote'), conflicts=arr(O(courtId=S, kind=E('booking', 'block', 'closed', 'buffer'), message=S)), membership=ref('VMembership'))
schemas['BookingCreateResult'] = O(created=arr(ref('Booking')), skipped=arr(O(date=DATE, courtId=S, reason=S)))
paths = {}
for method, path in routes:
    p = re.sub(r':(\w+)', r'{\1}', path); key = f'{method} {p}'
    s, tag, roles, req, res, errs = M[key]
    op = {'operationId': re.sub(r'[^a-zA-Z]', '_', f'{method.lower()}{p}').strip('_'), 'tags': [tag], 'summary': s, 'x-roles': roles,
          'parameters': [{'name': n, 'in': 'path', 'required': True, 'schema': S} for n in re.findall(r'{(\w+)}', p)],
          'responses': {'200': {'description': 'OK', 'content': {'application/json': {'schema': resp(res)}}}}}
    if 'public' in roles: op['security'] = []
    if req: op['requestBody'] = {'required': True, 'content': {'application/json': {'schema': ref(req)}}}
    for e in ['401 unauthenticated', '403 forbidden'] * ('public' not in roles) + errs:
        code, name = e.split(' ', 1)
        op['responses'].setdefault(code, {'description': name, 'content': {'application/json': {'schema': ref('Error')}}})
        if name not in op['responses'][code]['description']: op['responses'][code]['description'] += f' | {name}'
    if not op['parameters']: del op['parameters']
    paths.setdefault(p, {})[method.lower()] = op
spec = {'openapi': '3.1.0', 'info': {'title': 'Densparq Tournaments API', 'version': '1.0.0', 'description': 'Generated from src/mock/handlers.ts + venueHandlers.ts by scripts/gen-openapi.py. Business rules: docs/business-rules.md. x-roles = roles allowed (enforce server-side + RLS). All errors: {error:{code,message,details}}. Money in paise. Mutations accept an Idempotency-Key header.'},
  'servers': [{'url': '/api/v1'}], 'security': [{'bearer': []}],
  'components': {'securitySchemes': {'bearer': {'type': 'http', 'scheme': 'bearer', 'bearerFormat': 'JWT (phone OTP login)'}}, 'schemas': schemas},
  'paths': paths,
  'webhooks': {'razorpay': {'post': {'summary': 'payment.captured / payment.failed / refund.processed -> update payments, registration status, send receipt', 'responses': {'200': {'description': 'ack'}}}},
               'whatsapp': {'post': {'summary': 'Provider delivery receipts -> delivery_attempts (sent/delivered/read/failed)', 'responses': {'200': {'description': 'ack'}}}}}}
missing = [k for k in M if k not in {f'{m} {re.sub(r":(\w+)", r"{\1}", p)}' for m, p in routes}]
assert not missing, missing
try:
    import yaml  # pip install pyyaml
    class NoAlias(yaml.SafeDumper):
        def ignore_aliases(self, data): return True
    out = yaml.dump(spec, Dumper=NoAlias, sort_keys=False, width=140, allow_unicode=True)
except ImportError:
    out = json.dumps(spec, indent=1)  # JSON is valid YAML 1.2
(root / 'docs/openapi.yaml').write_text('# Generated: python3 scripts/gen-openapi.py\n' + out)
print(f'{len(routes)} operations, {len(schemas)} schemas')

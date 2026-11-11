-- Densparq Tournaments — PostgreSQL 15+ schema (v1.0)
-- Mirrors src/domain/types.ts. Money = integer paise. Times = timestamptz (UTC); venue-local display is Asia/Kolkata.
-- Multi-tenant: every tournament-scoped row carries org_id for row-level security (see bottom).
create extension if not exists pgcrypto;
create extension if not exists btree_gist;
-- timestamptz + interval is only STABLE (day math depends on time zone); minute-only math is not, so this is safe as IMMUTABLE for generated columns.
create function add_minutes(ts timestamptz, mins int) returns timestamptz language sql immutable as $$ select ts + mins * interval '1 minute' $$;

-- ---------- enums ----------
create type org_kind          as enum ('venue','organizer','academy','college','corporate');
create type role_t            as enum ('org_admin','registration_manager','referee','captain','player','spectator');
create type sport_t           as enum ('badminton','pickleball','football','box_cricket','frisbee','lagori');
create type event_type_t      as enum ('singles','doubles','team');
create type format_t          as enum ('league','round_robin','group_knockout','knockout','custom');
create type tournament_status as enum ('draft','published','unpublished','archived');
create type rule_status       as enum ('draft','published','unpublished','superseded');
create type reg_status        as enum ('draft','pending_payment','confirmed','waitlisted','rejected','withdrawn');
create type pay_status        as enum ('unpaid','pending','paid','refunded','partially_refunded','waived');
create type payment_status    as enum ('created','captured','failed','refunded');
create type match_status      as enum ('scheduled','live','paused','completed','abandoned','walkover','postponed');
create type match_stage       as enum ('league','group','knockout');
create type verification_t    as enum ('submitted','verified','disputed');
create type playo_status      as enum ('block_todo','blocked','unblock_todo','unblocked');

-- ---------- identity & tenancy ----------
create table organizations (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique, kind org_kind not null,
  created_at timestamptz not null default now()
);
create table users (
  id uuid primary key default gen_random_uuid(), name text not null, phone text not null unique check (phone ~ '^\d{10}$'),
  email text, whatsapp_opt_in boolean not null default false, created_at timestamptz not null default now()
);
create table memberships (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references users on delete cascade,
  org_id uuid not null references organizations on delete cascade, role role_t not null, unique (user_id, org_id, role)
);
create table venues (
  id uuid primary key default gen_random_uuid(), org_id uuid references organizations, name text not null, address text not null,
  is_densparq boolean not null default false
);
create table courts (
  id uuid primary key default gen_random_uuid(), venue_id uuid not null references venues on delete cascade, name text not null,
  sports sport_t[] not null default '{}', densparq_space_id text -- link to the venue operator dashboard's space id (t1..p2)
);

-- ---------- tournaments ----------
create table tournaments (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations,
  slug text not null unique, name text not null check (length(name) >= 3), sport sport_t not null,
  status tournament_status not null default 'draft', organizer_name text not null,
  venue_id uuid references venues, venue_text text,
  start_date date, end_date date, reg_opens_at timestamptz, reg_closes_at timestamptz, roster_cutoff_at timestamptz,
  contact jsonb not null default '{}',            -- {name, phone, email}
  description text not null default '',
  prizes jsonb not null default '[]',             -- [{place, description, amountPaise}]
  schedule jsonb not null,                        -- ScheduleConfig
  registration jsonb not null,                    -- RegistrationConfig
  scoring jsonb not null,                         -- ScoringConfig (machine-readable rules; separate from rule_versions)
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  published_at timestamptz, archived_at timestamptz,
  check (end_date >= start_date), check (reg_closes_at > reg_opens_at)
);
create table tournament_courts (tournament_id uuid references tournaments on delete cascade, court_id uuid references courts, primary key (tournament_id, court_id));
create table tournament_staff (tournament_id uuid references tournaments on delete cascade, user_id uuid references users, role role_t not null, primary key (tournament_id, user_id, role));
create table categories (
  id uuid primary key default gen_random_uuid(), tournament_id uuid not null references tournaments on delete cascade,
  name text not null, event_type event_type_t not null, gender text not null default 'open' check (gender in ('open','men','women','mixed')),
  min_age int, max_age int, skill text not null default 'any', capacity int not null check (capacity >= 2), fee_paise int not null default 0 check (fee_paise >= 0),
  roster_min int not null default 1, roster_max int not null default 1, format jsonb not null, sort int not null default 0,
  check (roster_max >= roster_min), check (max_age is null or min_age is null or max_age >= min_age)
);

-- ---------- rules (per tournament, versioned, immutable once published) ----------
create table rule_versions (
  id uuid primary key default gen_random_uuid(), tournament_id uuid not null references tournaments on delete cascade,
  version int not null, status rule_status not null default 'draft',
  sections jsonb not null,               -- [{key,title,html}] HTML sanitised server-side
  material boolean not null default false, change_summary text not null default '',
  author_id uuid not null references users, created_at timestamptz not null default now(), published_at timestamptz,
  unique (tournament_id, version)
);
create unique index one_published_rules on rule_versions (tournament_id) where status = 'published';
create unique index one_draft_rules on rule_versions (tournament_id) where status = 'draft';
create table rule_attachments (
  id uuid primary key default gen_random_uuid(), rule_version_id uuid not null references rule_versions on delete cascade,
  name text not null, size_bytes int not null check (size_bytes <= 10485760), mime text not null, storage_key text not null
);
create table rule_templates (id uuid primary key default gen_random_uuid(), org_id uuid references organizations, name text not null, sport sport_t, sections jsonb not null);

-- ---------- people & registration ----------
create table players (
  id uuid primary key default gen_random_uuid(), user_id uuid references users, -- shared profile across academy + tournaments
  name text not null, phone text not null, dob date not null, gender char(1) not null check (gender in ('m','f','x')),
  guardian jsonb,                         -- {name, phone, relation, consentAt} required when minor
  stats_visibility text not null default 'public' check (stats_visibility in ('public','coaches','private'))
);
create table registrations (
  id uuid primary key default gen_random_uuid(), tournament_id uuid not null references tournaments, category_id uuid not null references categories,
  entry_name text not null, captain_id uuid not null references players, captain_phone text not null,
  status reg_status not null default 'draft', pay_status pay_status not null default 'unpaid',
  amount_paise int not null, paid_paise int not null default 0, ack_version int, needs_reack boolean not null default false,
  seed int, waitlist_pos int, reject_reason text, created_at timestamptz not null default now(), confirmed_at timestamptz
);
-- Duplicate-entry guard (RegistrationConfig.duplicateCheck = 'phone')
create unique index uniq_active_entry_phone on registrations (category_id, captain_phone) where status not in ('withdrawn','rejected');
create index on registrations (tournament_id, status);
create table roster_entries (registration_id uuid references registrations on delete cascade, player_id uuid references players, position int not null default 0, primary key (registration_id, player_id));
create table registration_documents (
  id uuid primary key default gen_random_uuid(), registration_id uuid not null references registrations on delete cascade, player_id uuid references players,
  type text not null, name text not null, storage_key text not null, status text not null default 'pending' check (status in ('pending','approved','rejected'))
);
create table registration_exceptions (
  id uuid primary key default gen_random_uuid(), registration_id uuid not null references registrations on delete cascade,
  type text not null check (type in ('fee_waiver','late_entry','roster_exception','eligibility_exception')), reason text not null, approved_by uuid not null references users, at timestamptz not null default now()
);
create table rule_acknowledgements (
  id uuid primary key default gen_random_uuid(), registration_id uuid not null references registrations on delete cascade,
  rule_version_id uuid not null references rule_versions, version int not null, user_id uuid references users, accepted_at timestamptz not null default now(),
  ip inet, user_agent text, unique (registration_id, rule_version_id)
);
create table payments (
  id uuid primary key default gen_random_uuid(), registration_id uuid not null references registrations, amount_paise int not null,
  method text not null, status payment_status not null, gateway_order_id text, gateway_payment_id text unique, receipt_no text unique,
  raw jsonb, created_at timestamptz not null default now()
);
create table refunds (
  id uuid primary key default gen_random_uuid(), payment_id uuid not null references payments, amount_paise int not null check (amount_paise > 0),
  reason text not null, status text not null default 'pending' check (status in ('pending','processed','failed')), gateway_refund_id text,
  by_user uuid not null references users, created_at timestamptz not null default now()
);

-- ---------- fixtures & matches ----------
create table matches (
  id uuid primary key default gen_random_uuid(), tournament_id uuid not null references tournaments, category_id uuid not null references categories,
  code text not null, stage match_stage not null, round int not null, round_name text not null, grp text,
  home_slot jsonb not null, away_slot jsonb not null,   -- Slot: {kind:'entry',regId} | {kind:'group',group,rank} | {kind:'winner'|'loser',matchId} | {kind:'bye'}
  home_id uuid references registrations, away_id uuid references registrations,
  court_id uuid references courts, start_at timestamptz, duration_min int not null, buffer_min int not null default 0,
  status match_status not null default 'scheduled', fixtures_version int not null default 0, published boolean not null default false,
  postponed_reason text, started_at timestamptz, ended_at timestamptz,
  slot tstzrange generated always as (case when start_at is null then null else tstzrange(start_at, add_minutes(start_at, duration_min + buffer_min)) end) stored,
  unique (category_id, code)
);
-- Hard guard: no two live/scheduled matches on one court at once (business-rules §4.4). Team clashes are checked in the service.
alter table matches add constraint no_court_overlap exclude using gist (court_id with =, slot with &&) where (status in ('scheduled','live','paused'));
create index on matches (tournament_id, published); create index on matches (home_id); create index on matches (away_id);
create table match_officials (match_id uuid references matches on delete cascade, user_id uuid references users, role text not null default 'referee', primary key (match_id, user_id));
create table score_events (   -- append-only; undo = voided flag (never delete)
  id uuid primary key default gen_random_uuid(), match_id uuid not null references matches on delete cascade, seq int not null,
  client_id text not null unique,  -- idempotency key from the device (offline queue)
  type text not null, payload jsonb not null default '{}', by_user uuid not null references users, at timestamptz not null, voided boolean not null default false,
  received_at timestamptz not null default now(), unique (match_id, seq)
);
create table match_results (
  match_id uuid primary key references matches on delete cascade, home_score int not null, away_score int not null, detail text not null,
  winner_id uuid references registrations, is_draw boolean not null, walkover text check (walkover in ('home','away')),
  verification verification_t not null, source text not null check (source in ('live','manual')),
  submitted_by uuid not null references users, submitted_at timestamptz not null, verified_by uuid references users, verified_at timestamptz,
  dispute_reason text, check (verified_by is null or verified_by <> submitted_by)   -- four-eyes
);
create table standings_overrides (
  id uuid primary key default gen_random_uuid(), tournament_id uuid not null references tournaments, category_id uuid not null references categories,
  grp text not null, registration_id uuid not null references registrations, rank int not null, reason text not null,
  requested_by uuid not null references users, approved_by uuid references users, status text not null default 'pending' check (status in ('pending','approved','rejected')),
  at timestamptz not null default now()
);
-- Standings are computed (business-rules §6). Optionally materialise: create materialized view standings_mv ... refresh on result verification.
create table player_stats (
  id uuid primary key default gen_random_uuid(), tournament_id uuid not null references tournaments, match_id uuid not null references matches,
  player_id uuid not null references players, registration_id uuid not null references registrations, key text not null, value numeric not null,
  verified boolean not null default false, source text not null check (source in ('auto','manual')), by_user uuid references users, at timestamptz not null default now(), reason text
);
create index on player_stats (tournament_id, key);

-- ---------- venue integration (Densparq operator dashboard) ----------
create table venue_holds (  -- shared with the operator dashboard's Holds; type 'event'
  id uuid primary key default gen_random_uuid(), tournament_id uuid references tournaments, court_id uuid not null references courts,
  start_at timestamptz not null, end_at timestamptz not null, type text not null default 'event', playo_status playo_status not null default 'block_todo', note text
);

-- ---------- communication ----------
create table notifications (
  id uuid primary key default gen_random_uuid(), tournament_id uuid not null references tournaments, kind text not null,
  title text not null, body text not null, channels text[] not null, created_by uuid references users, created_at timestamptz not null default now()
);
create table notification_recipients (notification_id uuid references notifications on delete cascade, registration_id uuid references registrations, user_id uuid references users, primary key (notification_id, registration_id));
create table delivery_attempts (
  id uuid primary key default gen_random_uuid(), notification_id uuid not null references notifications on delete cascade, user_id uuid references users,
  channel text not null check (channel in ('in_app','whatsapp')), status text not null check (status in ('queued','sent','delivered','read','failed')),
  provider_message_id text, error text, at timestamptz not null default now()
);

-- ---------- audit ----------
create table audit_log (
  id bigserial primary key, org_id uuid not null references organizations, tournament_id uuid references tournaments,
  entity text not null, entity_id text not null, action text not null, by_user uuid references users, at timestamptz not null default now(),
  reason text, diff jsonb
);
create index on audit_log (org_id, at desc); create index on audit_log (entity, entity_id);

-- ---------- row-level security sketch ----------
-- set app.user_id per request; policies join memberships for org_admin/registration_manager, match_officials for referees.
alter table tournaments enable row level security;
create policy org_members on tournaments using (exists (select 1 from memberships m where m.org_id = tournaments.org_id and m.user_id = current_setting('app.user_id')::uuid));
create policy public_read on tournaments for select using (status = 'published');

-- =====================================================================
-- VENUE MANAGEMENT (src/domain/venue.ts). Shares organizations, users, venues, courts with tournaments.
-- =====================================================================
alter type role_t add value if not exists 'branch_manager';
alter type role_t add value if not exists 'front_desk';
alter table memberships add column venue_ids uuid[];            -- branch scope; null = all branches
create type booking_source as enum ('walk_in','phone','app','playo','tournament');
create type booking_status as enum ('confirmed','pending_payment','completed','cancelled','no_show');
create type band_t as enum ('off_peak','standard','peak');
create type day_type as enum ('weekday','weekend','holiday');

create table venue_profiles (
  venue_id uuid primary key references venues on delete cascade, open time not null, close time not null check (close > open),
  slot_minutes int not null default 60, buffer_minutes int not null default 0, description text not null default '', amenities text[] not null default '{}', photos text[] not null default '{}',
  refund jsonb not null default '{"fullBeforeHours":24,"partialBeforeHours":6,"partialPct":50}'
);
create table venue_holidays (venue_id uuid references venues on delete cascade, date date not null, name text not null, primary key (venue_id, date));
alter table courts add column surface text, add column indoor boolean not null default false, add column active boolean not null default true;

create table customers (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations, user_id uuid references users,
  name text not null, phone text not null check (phone ~ '^\d{10}$'), email text, sports sport_t[] not null default '{}', tags text[] not null default '{}', corporate text,
  consent_whatsapp boolean not null default false, consent_marketing boolean not null default false, consent_at timestamptz, created_at timestamptz not null default now(),
  unique (org_id, phone)
);
create table customer_notes (id bigserial primary key, customer_id uuid not null references customers on delete cascade, by_user uuid references users, text text not null, at timestamptz not null default now());

create table bookings (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations, venue_id uuid not null references venues, court_id uuid not null references courts,
  customer_id uuid references customers, customer_name text not null, sport sport_t not null, start_at timestamptz not null, end_at timestamptz not null check (end_at > start_at),
  source booking_source not null, status booking_status not null, quote jsonb not null,            -- price lines locked at booking time
  total_paise int not null, paid_paise int not null default 0, refund_paise int not null default 0,
  recurrence_id uuid, group_id uuid, membership_id uuid, notes text not null default '', cancel_reason text, created_by uuid references users, created_at timestamptz not null default now(),
  slot tstzrange generated always as (tstzrange(start_at, end_at)) stored
);
-- One sale per court-slot across every channel. Cancelled/no-show free the slot (no_show is past anyway).
alter table bookings add constraint no_double_booking exclude using gist (court_id with =, slot with &&) where (status in ('confirmed','pending_payment','completed'));
create index on bookings (venue_id, start_at); create index on bookings (customer_id, start_at);
create table blocks (
  id uuid primary key default gen_random_uuid(), venue_id uuid not null references venues, court_ids uuid[] not null, start_at timestamptz not null, end_at timestamptz not null check (end_at > start_at),
  reason text not null check (reason in ('maintenance','private_event','tournament','academy')), note text not null default '', created_by uuid references users
);  -- service checks bookings ∩ blocks on write (array of courts can't use the gist exclusion directly; or explode to block_courts)

create table rate_rules (
  id uuid primary key default gen_random_uuid(), venue_id uuid not null references venues, sport sport_t not null, day_type day_type not null,
  from_time time not null, to_time time not null check (to_time > from_time), band band_t not null,
  price_paise int not null, min_paise int not null, max_paise int not null, check (min_paise <= price_paise and price_paise <= max_paise)
);
create table offers (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations, name text not null, code text, kind text not null check (kind in ('percent','flat')), value int not null check (value > 0),
  stackable boolean not null default false, valid_from date not null, valid_to date not null check (valid_to >= valid_from), bands band_t[], sports sport_t[],
  new_customers_only boolean not null default false, min_hours numeric not null default 0, max_uses int, uses int not null default 0, active boolean not null default true, unique (org_id, code)
);
create table customer_rates (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references customers, venue_id uuid references venues, kind text not null check (kind in ('fixed','percent')), value int not null, note text not null, valid_to date,
  unique (customer_id, venue_id)
);

create table plans (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations, name text not null, tier text not null, period text not null check (period in ('monthly','quarterly','annual','pack')),
  price_paise int not null, hours numeric not null default 0, wallet_paise int not null default 0, discount_pct int not null default 0, sports sport_t[] not null, peak_allowed boolean not null default false,
  rollover_pct int not null default 0, grace_days int not null default 0, cancel_notice_hours int not null default 0, max_members int not null default 1, active boolean not null default true
);
create table venue_memberships (
  id uuid primary key default gen_random_uuid(), plan_id uuid not null references plans, customer_id uuid not null references customers, member_ids uuid[] not null default '{}',
  start_date date not null, end_date date not null, cancelled_at timestamptz, hours_left numeric not null, wallet_paise int not null default 0, auto_renew boolean not null default false,
  plan_snapshot jsonb not null      -- terms locked for the period; plan edits apply from next renewal
);
create table fixed_slots (membership_id uuid references venue_memberships on delete cascade, court_id uuid references courts, weekday int check (weekday between 0 and 6), start_time time, minutes int, rate_paise int, primary key (membership_id, court_id, weekday, start_time));
create table membership_ledger (
  id bigserial primary key, membership_id uuid not null references venue_memberships, at timestamptz not null default now(),
  kind text not null check (kind in ('enrol','hours_used','hours_returned','wallet_used','topup','rollover','expired','adjust')), hours numeric not null default 0, paise int not null default 0,
  booking_id uuid references bookings, note text not null, by_user uuid references users
);  -- append-only: hours_left = sum(hours) per membership (keep the column as a cache)
create table feedback (id uuid primary key default gen_random_uuid(), customer_id uuid not null references customers, booking_id uuid references bookings, kind text not null check (kind in ('feedback','complaint')), rating int check (rating between 1 and 5), text text not null, status text not null default 'open', resolution text, at timestamptz not null default now());
create table follow_ups (id uuid primary key default gen_random_uuid(), customer_id uuid not null references customers, reason text not null, due date not null, status text not null default 'open', note text not null default '');
create unique index one_open_followup on follow_ups (customer_id, reason) where status = 'open';   -- makes generate idempotent

-- =====================================================================
-- COACHING & ACADEMY (src/domain/academy.ts). Courts shared with venue bookings; athletes optionally linked to tournament players.
-- =====================================================================
alter type role_t add value if not exists 'coach';
alter type role_t add value if not exists 'guardian';
create table academies (id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations, venue_id uuid not null references venues, name text not null, sports sport_t[] not null, programs text[] not null default '{}');
create table batches (
  id uuid primary key default gen_random_uuid(), academy_id uuid not null references academies, name text not null, sport sport_t not null, program text not null,
  age_min int not null, age_max int not null check (age_max >= age_min), level text not null check (level in ('beginner','intermediate','advanced','elite')), capacity int not null check (capacity > 0),
  coach_name text not null, coach_phone text, coach_user_id uuid references users, start_date date not null, end_date date, active boolean not null default true
);
create table batch_slots (batch_id uuid references batches on delete cascade, weekday int check (weekday between 0 and 6), start_time time, minutes int check (minutes >= 30), court_id uuid references courts, primary key (batch_id, weekday, start_time, court_id));
create table session_changes (id uuid primary key default gen_random_uuid(), batch_id uuid not null references batches, date date not null, kind text not null check (kind in ('cancelled','rescheduled')), new_date date, new_start time, new_court_id uuid references courts, reason text not null, by_user uuid references users, at timestamptz not null default now(), unique (batch_id, date));
-- Sessions are expanded on read (domain.sessions); materialise as venue holds nightly if the venue calendar needs SQL-level exclusion.
create table athletes (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations, name text not null, dob date not null, gender char(1), phone text, sports sport_t[] not null default '{}', level text not null,
  guardian jsonb,                        -- {name, phone, relation, consentAt, userId}; required + consented when age < 18
  stats_visibility text not null default 'private' check (stats_visibility in ('private','academy','public')), player_id uuid references players, created_at timestamptz not null default now()
);
create table athlete_history (id bigserial primary key, athlete_id uuid not null references athletes on delete cascade, at timestamptz not null default now(), by_user uuid references users, change text not null);
create table enrollments (id uuid primary key default gen_random_uuid(), athlete_id uuid not null references athletes, batch_id uuid not null references batches, start date not null, "end" date, status text not null check (status in ('active','paused','transferred','left')), reason text);
create unique index one_active_enrollment on enrollments (athlete_id, batch_id) where status = 'active';
create table attendance (batch_id uuid references batches, athlete_id uuid references athletes, date date, status text not null check (status in ('present','late','absent','excused')), by_user uuid references users, at timestamptz not null default now(), primary key (batch_id, athlete_id, date));
create table fee_plans (id uuid primary key default gen_random_uuid(), academy_id uuid not null references academies, name text not null, kind text not null check (kind in ('admission','monthly','term','package')), amount_paise int not null check (amount_paise > 0), months int not null default 0);
create table fee_plan_batches (plan_id uuid references fee_plans on delete cascade, batch_id uuid references batches, primary key (plan_id, batch_id));
create table invoices (
  id uuid primary key default gen_random_uuid(), athlete_id uuid not null references athletes, academy_id uuid not null references academies, batch_id uuid references batches, plan_id uuid not null references fee_plans,
  period char(7) not null, amount_paise int not null, discount_paise int not null default 0, scholarship_pct int not null default 0 check (scholarship_pct between 0 and 100), discount_reason text,
  due_date date not null, refund_paise int not null default 0, voided boolean not null default false, reminders_sent int not null default 0, created_at timestamptz not null default now()
);
create unique index one_invoice_per_period on invoices (athlete_id, batch_id, period) where not voided and batch_id is not null;   -- generate is idempotent
create table invoice_payments (id uuid primary key default gen_random_uuid(), invoice_id uuid not null references invoices, method text not null, amount_paise int not null check (amount_paise > 0), receipt_no text unique not null, gateway_payment_id text, by_user uuid references users, at timestamptz not null default now());
create table metric_templates (id uuid primary key default gen_random_uuid(), org_id uuid references organizations, sport sport_t not null, version int not null, metrics jsonb not null, updated_at timestamptz not null default now(), unique (org_id, sport, version));
create table assessments (
  id uuid primary key default gen_random_uuid(), athlete_id uuid not null references athletes, sport sport_t not null, template_id uuid not null references metric_templates, template_version int not null,
  date date not null, kind text not null check (kind in ('baseline','periodic')), values jsonb not null,   -- {metricKey: {value, measured}}
  by_user uuid references users, notes text not null default '', created_at timestamptz not null default now()
);
create table assessment_corrections (id bigserial primary key, assessment_id uuid not null references assessments, at timestamptz not null default now(), by_user uuid references users, reason text not null, before jsonb not null, after jsonb not null);
create table athlete_matches (id uuid primary key default gen_random_uuid(), athlete_id uuid not null references athletes, date date not null, event text not null, opponent text, result char(1) check (result in ('W','L','D')), score text, source text not null check (source in ('manual','tournament')), by_user uuid references users, at timestamptz not null default now());
create table leads (
  id uuid primary key default gen_random_uuid(), academy_id uuid not null references academies, name text not null, phone text not null, athlete_name text not null, age int not null, sport sport_t not null,
  source text not null check (source in ('online','walk_in','phone','referral')), stage text not null, trial_batch_id uuid references batches, trial_date date, trial_attended boolean,
  lost_reason text, follow_up date, notes text not null default '', consent_whatsapp boolean not null default false, created_at timestamptz not null default now()
);
create table lead_history (id bigserial primary key, lead_id uuid not null references leads on delete cascade, stage text not null, at timestamptz not null default now(), by_name text);
create table academy_notices (id uuid primary key default gen_random_uuid(), athlete_id uuid not null references athletes, kind text not null check (kind in ('attendance','fee','schedule','report')), text text not null, whatsapp boolean not null, at timestamptz not null default now());
alter table tournaments add column finished_at timestamptz, add column winners jsonb;  -- set by POST /tournaments/:id/finish

// Domain contract. Every type here maps 1:1 to a table in docs/schema.sql and a schema in docs/openapi.yaml.
// Money is always integer paise. Times are ISO-8601 strings in UTC; the UI renders Asia/Kolkata.
export type ID = string;
export type ISO = string;

export type Role = 'org_admin' | 'branch_manager' | 'front_desk' | 'registration_manager' | 'referee' | 'captain' | 'player' | 'spectator' | 'coach' | 'guardian';
export type Sport = 'badminton' | 'pickleball' | 'football' | 'box_cricket' | 'frisbee' | 'lagori';
export type EventType = 'singles' | 'doubles' | 'team';
export type FormatType = 'league' | 'round_robin' | 'group_knockout' | 'knockout' | 'custom';
export type TournamentStatus = 'draft' | 'published' | 'unpublished' | 'archived';
export type Phase = 'setup' | 'registration' | 'scheduled' | 'live' | 'completed';
export type TieBreaker = 'points' | 'head_to_head' | 'score_diff' | 'score_for' | 'wins' | 'fair_play' | 'draw_lots';

export interface Organization { id: ID; name: string; slug: string; kind: 'venue' | 'organizer' | 'academy' | 'college' | 'corporate' }
export interface User { id: ID; name: string; phone: string; email?: string }
export interface Membership { id: ID; userId: ID; orgId: ID; role: Role; tournamentIds?: ID[]; venueIds?: ID[] }
export interface Venue { id: ID; orgId: ID | null; name: string; address: string; isDensparq: boolean }
export interface Court { id: ID; venueId: ID; name: string; sports: Sport[]; densparqSpaceId?: string }

export interface Prize { place: string; description: string; amountPaise?: number }
export interface ScheduleConfig {
  matchMinutes: number; bufferMinutes: number; minRestMinutes: number;
  dayStart: string; dayEnd: string; // "07:00"
  createVenueHolds: boolean; // Densparq venue only: write event holds -> "Block on Playo" tasks
}
export interface RegistrationConfig {
  requiredDocs: ('id_proof' | 'age_proof' | 'institution_id')[];
  guardianConsentUnder: number; // age; 18 by default
  waitlist: boolean; allowLate: boolean;
  refundPolicy: 'full_until_close' | 'percent_until_close' | 'none'; refundPercent?: number;
  duplicateCheck: 'phone' | 'player_id' | 'none';
}
export interface RallyParams { pointsToWin: number; cap: number; bestOf: 1 | 3 | 5 }
export interface FootballParams { halfMinutes: number; extraTimeMinutes: number; penalties: boolean; squadOnPitch: number }
export interface CricketParams { overs: number; ballsPerOver: number; playersPerSide: number }
export interface FrisbeeParams { pointsToWin: number; cap: number; halftimeAt: number; timeoutsPerHalf: number; spiritScoring: boolean }
export interface LagoriAction { key: string; label: string; points: number; side: 'self' | 'opponent' }
export interface LagoriParams { rounds: number; roundSeconds: number; actions: LagoriAction[] }
export interface ScoringConfig {
  sport: Sport;
  autoScoring: boolean; // false => manual result entry only
  points: { win: number; draw: number; loss: number; walkoverWin: number; walkoverLoss: number };
  tieBreakers: TieBreaker[];
  rally?: RallyParams; football?: FootballParams; cricket?: CricketParams; frisbee?: FrisbeeParams; lagori?: LagoriParams;
}
export interface FormatConfig {
  type: FormatType; groups: number; qualifiersPerGroup: number; legs: 1 | 2;
  seeding: 'random' | 'seeded'; thirdPlace: boolean;
}
export interface Category {
  id: ID; tournamentId: ID; name: string; eventType: EventType;
  gender: 'open' | 'men' | 'women' | 'mixed'; minAge?: number; maxAge?: number;
  skill: 'any' | 'beginner' | 'intermediate' | 'advanced';
  capacity: number; feePaise: number; rosterMin: number; rosterMax: number; format: FormatConfig;
}
export interface Tournament {
  id: ID; orgId: ID; slug: string; name: string; sport: Sport; status: TournamentStatus;
  organizerName: string; venueId: ID | null; venueText?: string;
  startDate: string; endDate: string; regOpensAt: ISO; regClosesAt: ISO; rosterCutoffAt: ISO;
  contact: { name: string; phone: string; email: string };
  description: string; prizes: Prize[]; courtIds: ID[];
  categories: Category[]; schedule: ScheduleConfig; registration: RegistrationConfig; scoring: ScoringConfig;
  staff: { userId: ID; role: Role }[];
  createdAt: ISO; updatedAt: ISO; publishedAt?: ISO; archivedAt?: ISO; finishedAt?: ISO; winners?: { categoryId: ID; regId: ID; name: string }[];
}

export type RuleSectionKey = 'eligibility' | 'roster' | 'match_format' | 'scoring' | 'points' | 'tie_breakers'
  | 'fouls' | 'penalties' | 'protests' | 'walkovers' | 'cancellations' | 'refunds';
export interface RuleSection { key: RuleSectionKey; title: string; html: string }
export interface Attachment { id: ID; name: string; sizeBytes: number; mime: string; url: string }
export interface RuleVersion {
  id: ID; tournamentId: ID; version: number; status: 'draft' | 'published' | 'unpublished' | 'superseded';
  sections: RuleSection[]; attachments: Attachment[];
  material: boolean; changeSummary: string; authorId: ID; authorName: string;
  createdAt: ISO; publishedAt?: ISO;
}
export interface RuleAck { id: ID; registrationId: ID; ruleVersionId: ID; version: number; userId: ID; acceptedAt: ISO }

export interface Guardian { name: string; phone: string; relation: string; consentAt?: ISO }
export interface Player {
  id: ID; name: string; phone: string; dob: string; gender: 'm' | 'f' | 'x';
  guardian?: Guardian; statsVisibility: 'public' | 'coaches' | 'private';
}
export type RegStatus = 'draft' | 'pending_payment' | 'confirmed' | 'waitlisted' | 'rejected' | 'withdrawn';
export type PayStatus = 'unpaid' | 'pending' | 'paid' | 'refunded' | 'partially_refunded' | 'waived';
export interface RegDocument { id: ID; type: string; name: string; status: 'pending' | 'approved' | 'rejected'; playerId: ID }
export interface Payment {
  id: ID; registrationId: ID; amountPaise: number; method: 'upi' | 'card' | 'netbanking' | 'cash' | 'waiver';
  status: 'created' | 'captured' | 'failed' | 'refunded'; gatewayRef?: string; receiptNo?: string; createdAt: ISO;
}
export interface Refund { id: ID; paymentId: ID; amountPaise: number; reason: string; status: 'pending' | 'processed' | 'failed'; createdAt: ISO; by: ID }
export interface RegException { type: 'fee_waiver' | 'late_entry' | 'roster_exception' | 'eligibility_exception'; reason: string; approvedBy: ID; at: ISO }
export interface Registration {
  id: ID; tournamentId: ID; categoryId: ID; entryName: string; captainId: ID; captainPhone: string; playerIds: ID[];
  status: RegStatus; payStatus: PayStatus; amountPaise: number; paidPaise: number;
  ackVersion?: number; needsReack: boolean; documents: RegDocument[]; exceptions: RegException[];
  seed?: number; waitlistPos?: number; rejectReason?: string; createdAt: ISO; confirmedAt?: ISO;
}

export type MatchStatus = 'scheduled' | 'live' | 'paused' | 'completed' | 'abandoned' | 'walkover' | 'postponed';
export type Slot = { kind: 'entry'; regId: ID } | { kind: 'group'; group: string; rank: number } | { kind: 'winner' | 'loser'; matchId: ID } | { kind: 'bye' };
export interface MatchResult {
  homeScore: number; awayScore: number; detail: string; winnerId?: ID; isDraw: boolean;
  walkover?: 'home' | 'away'; verification: 'submitted' | 'verified' | 'disputed';
  submittedBy: ID; submittedAt: ISO; verifiedBy?: ID; verifiedAt?: ISO; disputeReason?: string; source: 'live' | 'manual';
}
export interface Match {
  id: ID; tournamentId: ID; categoryId: ID; code: string; // "A-R1-M2", "QF1"
  stage: 'league' | 'group' | 'knockout'; round: number; roundName: string; group?: string;
  home: Slot; away: Slot; homeId?: ID; awayId?: ID;
  courtId?: ID; startAt?: ISO; durationMin: number;
  status: MatchStatus; result?: MatchResult; refereeIds: ID[];
  fixturesVersion: number; published: boolean; postponedReason?: string; startedAt?: ISO; endedAt?: ISO;
}
export interface ScoreEvent { id: ID; matchId: ID; seq: number; clientId: string; type: string; payload: Record<string, unknown>; by: ID; at: ISO; voided?: boolean }

export interface StandingRow {
  regId: ID; name: string; group: string; played: number; won: number; drawn: number; lost: number;
  scoreFor: number; scoreAgainst: number; diff: number; points: number; rank: number;
  qualified: boolean; overridden?: boolean; provisional: boolean;
}
export interface StandingOverride {
  id: ID; tournamentId: ID; categoryId: ID; group: string; regId: ID; rank: number; reason: string;
  requestedBy: ID; approvedBy?: ID; status: 'pending' | 'approved' | 'rejected'; at: ISO;
}
export interface PlayerStat { id: ID; tournamentId: ID; matchId: ID; playerId: ID; regId: ID; key: string; value: number; verified: boolean; source: 'auto' | 'manual'; by: ID; at: ISO }

export type NotificationKind = 'registration_confirmed' | 'payment_receipt' | 'rules_ack_required' | 'fixtures_published'
  | 'schedule_changed' | 'match_reminder' | 'result_published' | 'waitlist_promoted' | 'custom';
export interface DeliveryAttempt { channel: 'in_app' | 'whatsapp'; status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed'; at: ISO; error?: string }
export interface Notification {
  id: ID; tournamentId: ID; kind: NotificationKind; title: string; body: string;
  recipientRegIds: ID[]; channels: ('in_app' | 'whatsapp')[]; createdAt: ISO; by: ID;
  stats: { queued: number; delivered: number; read: number; failed: number };
}
export interface VenueHold {
  id: ID; tournamentId: ID; courtId: ID; startAt: ISO; endAt: ISO; type: 'event';
  playoStatus: 'block_todo' | 'blocked' | 'unblock_todo' | 'unblocked'; note: string;
}
export interface AuditEntry { id: ID; orgId: ID; tournamentId?: ID; entity: string; entityId: ID; action: string; by: ID; byName: string; at: ISO; reason?: string; diff?: Record<string, unknown> }
export interface Clash { matchId: ID; otherId?: ID; kind: 'court_overlap' | 'team_overlap' | 'rest_gap' | 'outside_window' | 'venue_busy' | 'unscheduled'; message: string }

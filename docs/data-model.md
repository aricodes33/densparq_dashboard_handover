# Data model

The full DDL is in [`schema.sql`](./schema.sql). Types mirror [`src/domain/types.ts`](../src/domain/types.ts).

```mermaid
erDiagram
  organizations ||--o{ memberships : has
  users ||--o{ memberships : "has role in"
  organizations ||--o{ venues : owns
  venues ||--o{ courts : has
  organizations ||--o{ tournaments : runs
  tournaments ||--o{ categories : has
  tournaments ||--o{ tournament_courts : uses
  courts ||--o{ tournament_courts : ""
  tournaments ||--o{ rule_versions : "versioned rules"
  rule_versions ||--o{ rule_attachments : files
  tournaments ||--o{ registrations : receives
  categories ||--o{ registrations : "entered in"
  registrations ||--o{ roster_entries : roster
  players ||--o{ roster_entries : ""
  registrations ||--o{ rule_acknowledgements : "accepted"
  rule_versions ||--o{ rule_acknowledgements : ""
  registrations ||--o{ registration_documents : uploads
  registrations ||--o{ registration_exceptions : waivers
  registrations ||--o{ payments : pays
  payments ||--o{ refunds : ""
  categories ||--o{ matches : fixtures
  registrations ||--o{ matches : "home/away"
  courts ||--o{ matches : "played on"
  matches ||--o{ match_officials : referees
  matches ||--o{ score_events : "append-only log"
  matches ||--|| match_results : result
  matches ||--o{ player_stats : produces
  players ||--o{ player_stats : ""
  tournaments ||--o{ standings_overrides : ""
  tournaments ||--o{ venue_holds : "Densparq holds"
  tournaments ||--o{ notifications : sends
  notifications ||--o{ delivery_attempts : ""
  organizations ||--o{ audit_log : ""
```

## Design notes

| Decision | Why |
|---|---|
| `tournaments.scoring` (JSON) is separate from `rule_versions.sections` (HTML) | Requirement 3.2: written rules and machine-readable logic are separate. The engine only reads `scoring`. |
| `rule_versions` are immutable once published; partial unique indexes allow one `published` and one `draft` per tournament | Version history and per-version acknowledgement (acceptance criteria #2 and #3). |
| `rule_acknowledgements` stores the exact `rule_version_id` and time | "Store the accepted rules version and time" (3.2). |
| `score_events` is append-only with `client_id` unique | Offline referee devices retry safely; corrections never destroy history (3.5). |
| `match_results.verified_by <> submitted_by` | Four-eyes verification. Only `verified` results feed standings and stats (3.6, 3.7). |
| Gist exclusion `no_court_overlap` | The database itself refuses double-booking a court (3.4). |
| `players` is separate from `users` and optionally linked | Minors and guests can be entered by a captain; their profile follows them to the academy module (3.7). |
| `venue_holds` share shape with the operator dashboard's Holds | Fixtures at Densparq write event holds, which produce "Block on Playo" tasks. |
| Standings are computed, not stored | One source of truth. Materialise only if reads get slow. |
| Money is integer paise; actual vs projected are separate queries | "Distinguish actual revenue from projected fees" (3.8). |

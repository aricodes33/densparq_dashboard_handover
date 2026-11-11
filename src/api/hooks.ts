// TanStack Query hooks: one per read endpoint, plus a generic mutation that invalidates by tournament.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './client';
import type { Tournament, RuleVersion, Registration, Player, Payment, Refund, RuleAck, AuditEntry, StandingRow, StandingOverride, Notification, Clash, VenueHold, Membership, User, Venue, Court, Organization, ScoreEvent, ScoringConfig, Sport, RuleSection } from '@/domain/types';
import type { MatchView } from '@/mock/handlers';
import { toast } from '@/ui/kit';

export type TView = Tournament & { phase: string; counts?: { entries: number; capacity: number; matches: number; done: number; live: number } };
export type RegView = Registration & { players: Player[] };
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api.get<{ user: User; role: string; memberships: Membership[]; orgs: Organization[] }>('/me') });
export const useTournaments = (org: string, include?: string) => useQuery({ queryKey: ['t', 'list', org, include], queryFn: () => api.get<TView[]>(`/orgs/${org}/tournaments${include ? '?include=' + include : ''}`) });
export const useTournament = (id?: string) => useQuery({ queryKey: ['t', id], enabled: !!id, queryFn: () => api.get<TView>(`/tournaments/${id}`) });
export const useDashboard = (id: string) => useQuery({ queryKey: ['t', id, 'dash'], enabled: !!id, queryFn: () => api.get<any>(`/tournaments/${id}/dashboard`), refetchInterval: 15000 });
export const useChecklist = (id: string) => useQuery({ queryKey: ['t', id, 'checklist'], queryFn: () => api.get<{ id: string; label: string; ok: boolean; step: number }[]>(`/tournaments/${id}/checklist`) });
export const useRules = (id: string) => useQuery({ queryKey: ['t', id, 'rules'], queryFn: () => api.get<{ versions: RuleVersion[]; published?: RuleVersion; ackStats: { total: number; onLatest: number; needsReack: number } }>(`/tournaments/${id}/rules`) });
export const useRegistrations = (id: string, qs = '') => useQuery({ queryKey: ['t', id, 'regs', qs], queryFn: () => api.get<RegView[]>(`/tournaments/${id}/registrations${qs}`) });
export const useRegistration = (rid?: string) => useQuery({ queryKey: ['reg', rid], enabled: !!rid, queryFn: () => api.get<RegView & { payments: Payment[]; refunds: Refund[]; acks: RuleAck[]; audit: AuditEntry[] }>(`/registrations/${rid}`) });
export const useMatches = (id: string, qs = '') => useQuery({ queryKey: ['t', id, 'matches', qs], queryFn: () => api.get<MatchView[]>(`/tournaments/${id}/matches${qs}`), refetchInterval: 10000 });
export const useMatch = (mid?: string) => useQuery({ queryKey: ['match', mid], enabled: !!mid, queryFn: () => api.get<MatchView & { tournament: { id: string; name: string; sport: Sport; scoring: ScoringConfig }; events: ScoreEvent[] }>(`/matches/${mid}`) });
export const useClashes = (id: string) => useQuery({ queryKey: ['t', id, 'clashes'], queryFn: () => api.get<Clash[]>(`/tournaments/${id}/clashes`) });
export const useHolds = (id: string) => useQuery({ queryKey: ['t', id, 'holds'], queryFn: () => api.get<VenueHold[]>(`/tournaments/${id}/venue-holds`) });
export const useStandings = (id: string) => useQuery({ queryKey: ['t', id, 'standings'], queryFn: () => api.get<{ categoryId: string; name: string; format: string; rows: StandingRow[]; bracket: MatchView[]; overrides: StandingOverride[] }[]>(`/tournaments/${id}/standings`) });
export const useStats = (id: string, qs = '') => useQuery({ queryKey: ['t', id, 'stats', qs], queryFn: () => api.get<{ keys: string[]; leaderboard: { playerId: string; name: string; entry: string; value: number; matches: number; verified: boolean; hidden: boolean }[]; teams: { regId: string; name: string; played: number; won: number; scored: number; conceded: number; unverified: number }[] }>(`/tournaments/${id}/stats${qs}`) });
export const useReports = (id: string) => useQuery({ queryKey: ['t', id, 'reports'], queryFn: () => api.get<any>(`/tournaments/${id}/reports`) });
export const useNotifications = (id: string) => useQuery({ queryKey: ['t', id, 'notifs'], queryFn: () => api.get<Notification[]>(`/tournaments/${id}/notifications`) });
export const useMyNotifications = () => useQuery({ queryKey: ['me', 'notifs'], queryFn: () => api.get<Notification[]>(`/me/notifications`), refetchInterval: 30000 });
export const useVenues = (org: string) => useQuery({ queryKey: ['venues', org], queryFn: () => api.get<(Venue & { courts: Court[] })[]>(`/orgs/${org}/venues`) });
export const useMembers = (org: string) => useQuery({ queryKey: ['members', org], queryFn: () => api.get<(Membership & { user: User })[]>(`/orgs/${org}/members`) });
export const useAudit = (org: string, tid?: string) => useQuery({ queryKey: ['audit', org, tid], queryFn: () => api.get<AuditEntry[]>(`/orgs/${org}/audit${tid ? '?tournamentId=' + tid : ''}`) });
export const useTemplates = (org: string) => useQuery({ queryKey: ['templates', org], queryFn: () => api.get<{ id: string; name: string; sections: RuleSection[] }[]>(`/orgs/${org}/templates`) });
export const useMyMatches = () => useQuery({ queryKey: ['me', 'matches'], queryFn: () => api.get<MatchView[]>('/me/matches') });
export const usePublicT = (slug: string) => useQuery({ queryKey: ['pub', slug], queryFn: () => api.get<any>(`/public/t/${slug}`) });
export const usePublicMatches = (slug: string) => useQuery({ queryKey: ['pub', slug, 'matches'], queryFn: () => api.get<MatchView[]>(`/public/t/${slug}/matches`), refetchInterval: 8000 });

/** Generic read for screens with one-off endpoints. null path = disabled. */
export const useGet = <T,>(path: string | null, refetchInterval?: number) => useQuery({ queryKey: [path], enabled: !!path, refetchInterval, queryFn: () => api.get<T>(path!) });

/** Mutation with toast + broad invalidation. `success` may be a string or fn of the result. */
export function useAct<TBody = any, TRes = any>(fn: (b: TBody) => Promise<TRes>, success?: string | ((r: TRes) => string)) {
  const qc = useQueryClient();
  return useMutation<TRes, ApiError, TBody>({
    mutationFn: fn,
    onSuccess: r => { qc.invalidateQueries(); if (success) toast(typeof success === 'string' ? success : success(r)); },
    onError: e => toast(e.message, 'danger'),
  });
}

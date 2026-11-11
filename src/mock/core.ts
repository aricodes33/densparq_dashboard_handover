// Shared mock-API plumbing: context, errors, permissions, audit. Used by handlers.ts and venueHandlers.ts.
import type { DB } from './db';
import type { Role } from '@/domain/types';
import { uid } from '@/domain/fixtures';

export interface Ctx { userId: string; role: Role }
export class ApiError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); } }
export type H = (p: Record<string, string>, body: any, q: URLSearchParams, ctx: Ctx, db: DB) => unknown;
export type Route = [string, string, H];
export const now = () => new Date().toISOString();
export const need = (ctx: Ctx, roles: Role[]) => { if (!roles.includes(ctx.role)) throw new ApiError(403, 'forbidden', `Your role (${ctx.role.replace('_', ' ')}) can't do this`); };
export function notFound(what: string): never { throw new ApiError(404, 'not_found', `No such ${what}`); }
export const invalid = (message: string, field?: string): never => { throw new ApiError(422, 'validation', message, field ? { field } : undefined); };
export const userName = (db: DB, id: string) => db.users.find(u => u.id === id)?.name ?? id;
export const audit = (db: DB, ctx: Ctx, scope: { orgId: string; id?: string } | undefined, entity: string, entityId: string, action: string, reason?: string, diff?: Record<string, unknown>) =>
  db.audit.unshift({ id: uid('a'), orgId: scope?.orgId ?? 'densparq', tournamentId: scope?.id, entity, entityId, action, by: ctx.userId, byName: userName(db, ctx.userId), at: now(), reason, diff });

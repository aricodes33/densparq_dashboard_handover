// Mock API. One handler per OpenAPI operationId (docs/openapi.yaml). Business rules live in src/domain/*
// so the backend can port them; this file only does persistence, permissions and side effects.
import { getDB, saveDB, blankSections, busyOf, type DB } from './db';
import { ApiError, now, need, notFound, userName, audit, type Ctx, type Route } from './core';
import { venueRoutes } from './venueHandlers';
import { academyRoutes } from './academyHandlers';
export { ApiError, type Ctx };
import { generateFixtures, schedule, detectClashes, blockingClash, uid, type Busy } from '@/domain/fixtures';
import { computeStandings } from '@/domain/standings';
import { journey } from '@/domain/journey';
import { summarize, defaultScoring } from '@/domain/scoring';
import { canMove, initialStatus, refundDue, checkEntry, MATCH_TRANSITIONS } from '@/domain/registration';
import type { Match, NotificationKind, Registration, Role, Slot, Tournament, MatchStatus, Player } from '@/domain/types';

// Branch managers organize tournaments; front desk handles entries/payments like a registration manager.
const ADMIN: Role[] = ['org_admin', 'branch_manager'], DESK: Role[] = [...ADMIN, 'registration_manager', 'front_desk'], REF: Role[] = [...ADMIN, 'referee'];
const T = (db: DB, id: string) => db.tournaments.find(t => t.id === id || t.slug === id) ?? notFound('tournament');
const M = (db: DB, id: string) => db.matches.find(m => m.id === id) ?? notFound('match');
const R = (db: DB, id: string) => db.registrations.find(r => r.id === id) ?? notFound('registration');

function notify(db: DB, ctx: Ctx, t: Tournament, kind: NotificationKind, title: string, body: string, regIds: string[]) {
  if (!regIds.length) return;
  const whatsapp = true; // recipients' preferences: in-app always; WhatsApp if opted in (mock: all opted in)
  db.notifications.unshift({ id: uid('n'), tournamentId: t.id, kind, title, body, recipientRegIds: regIds, channels: whatsapp ? ['in_app', 'whatsapp'] : ['in_app'], createdAt: now(), by: ctx.userId,
    stats: { queued: regIds.length, delivered: 0, read: 0, failed: 0 } });
}
const activeRegIds = (db: DB, tid: string) => db.registrations.filter(r => r.tournamentId === tid && ['confirmed', 'pending_payment', 'waitlisted'].includes(r.status)).map(r => r.id);

export function phase(db: DB, t: Tournament): Tournament['status'] | 'registration' | 'scheduled' | 'live' | 'completed' | 'setup' {
  if (t.status !== 'published') return t.status === 'draft' ? 'setup' : t.status;
  const ms = db.matches.filter(m => m.tournamentId === t.id);
  if (ms.some(m => m.status === 'live' || m.status === 'paused')) return 'live';
  if (ms.length && ms.every(m => ['completed', 'walkover', 'abandoned'].includes(m.status))) return 'completed';
  if (ms.some(m => m.published)) return Date.now() > Date.parse(`${t.startDate}T00:00:00+05:30`) ? 'live' : 'scheduled';
  return 'registration';
}
const busyFor = (db: DB, t: Tournament): Busy[] => busyOf(db, t.courtIds, t.id);

/** Fill knockout slots from verified group standings / previous results. */
function advance(db: DB, t: Tournament, categoryId: string) {
  const cat = t.categories.find(c => c.id === categoryId)!;
  const ms = db.matches.filter(m => m.tournamentId === t.id && m.categoryId === categoryId);
  const regs = db.registrations.filter(r => r.categoryId === categoryId);
  const rows = computeStandings(ms, regs, t.scoring, cat.format.qualifiersPerGroup, db.overrides.filter(o => o.categoryId === categoryId));
  const groupDone = (g: string) => ms.filter(m => m.group === g).every(m => m.result?.verification === 'verified' || m.status === 'abandoned');
  const resolve = (s: Slot): string | undefined => {
    if (s.kind === 'entry') return s.regId;
    if (s.kind === 'group') return groupDone(s.group) ? rows.find(r => r.group === s.group && r.rank === s.rank)?.regId : undefined;
    if (s.kind === 'winner' || s.kind === 'loser') {
      const src = ms.find(m => m.id === s.matchId); if (!src?.result || src.result.verification !== 'verified') return undefined;
      const w = src.result.winnerId; return s.kind === 'winner' ? w : (w === src.homeId ? src.awayId : src.homeId);
    }
  };
  for (const m of ms.filter(m => m.stage === 'knockout' && m.status === 'scheduled')) { m.homeId = resolve(m.home) ?? m.homeId; m.awayId = resolve(m.away) ?? m.awayId; }
}

function finalizeResult(db: DB, ctx: Ctx, m: Match, t: Tournament) {
  m.result!.verification = 'verified'; m.result!.verifiedBy = ctx.userId; m.result!.verifiedAt = now();
  db.stats.filter(s => s.matchId === m.id).forEach(s => { s.verified = true; });
  advance(db, t, m.categoryId);
  notify(db, ctx, t, 'result_published', `Result: ${m.code}`, m.result!.detail, [m.homeId!, m.awayId!].filter(Boolean));
}

const routes: Route[] = [
  // ---- session / org ----
  ['GET', '/me', (_p, _b, _q, ctx, db) => ({ user: db.users.find(u => u.id === ctx.userId), role: ctx.role, memberships: db.memberships.filter(m => m.userId === ctx.userId), orgs: db.orgs })],
  ['GET', '/orgs/:org/tournaments', (p, _b, q, _c, db) => db.tournaments.filter(t => t.orgId === p.org && (q.get('status') ? t.status === q.get('status') : t.status !== 'archived' || q.get('include') === 'archived'))
    .map(t => ({ ...t, phase: phase(db, t), counts: counts(db, t) }))],
  ['POST', '/orgs/:org/tournaments', (p, b, _q, ctx, db) => {
    need(ctx, ADMIN);
    const id = uid('t'), sport = b.sport ?? 'badminton';
    const t: Tournament = { id, orgId: p.org, slug: slugify(b.name ?? 'untitled') + '-' + id.slice(-4), name: b.name ?? 'Untitled tournament', sport, status: 'draft', organizerName: db.orgs.find(o => o.id === p.org)?.name ?? '', venueId: null,
      startDate: '', endDate: '', regOpensAt: '', regClosesAt: '', rosterCutoffAt: '', contact: { name: '', phone: '', email: '' }, description: '', prizes: [], courtIds: [], categories: [],
      schedule: { matchMinutes: 30, bufferMinutes: 10, minRestMinutes: 20, dayStart: '07:00', dayEnd: '22:00', createVenueHolds: true },
      registration: { requiredDocs: [], guardianConsentUnder: 18, waitlist: true, allowLate: false, refundPolicy: 'full_until_close', duplicateCheck: 'phone' },
      scoring: defaultScoring(sport), staff: [], createdAt: now(), updatedAt: now(), ...b };
    db.tournaments.push(t);
    db.rules.push({ id: uid('rv'), tournamentId: id, version: 1, status: 'draft', sections: blankSections(), attachments: [], material: true, changeSummary: '', authorId: ctx.userId, authorName: userName(db, ctx.userId), createdAt: now() });
    audit(db, ctx, t, 'tournament', id, 'created'); return t;
  }],
  ['GET', '/orgs/:org/venues', (p, _b, _q, _c, db) => db.venues.filter(v => v.orgId === p.org || v.isDensparq).map(v => ({ ...v, courts: db.courts.filter(c => c.venueId === v.id && db.courtMeta.find(m => m.courtId === c.id)?.active !== false) }))],
  ['GET', '/orgs/:org/members', (p, _b, _q, _c, db) => db.memberships.filter(m => m.orgId === p.org).map(m => ({ ...m, user: db.users.find(u => u.id === m.userId) }))],
  ['POST', '/orgs/:org/members', (p, b, _q, ctx, db) => { need(ctx, ADMIN); const u = { id: uid('u'), name: b.name, phone: b.phone }; db.users.push(u); const m = { id: uid('mem'), userId: u.id, orgId: p.org, role: b.role }; db.memberships.push(m); return m; }],
  ['DELETE', '/memberships/:id', (p, _b, _q, ctx, db) => { need(ctx, ADMIN); db.memberships = db.memberships.filter(m => m.id !== p.id); return { ok: true }; }],
  ['GET', '/orgs/:org/audit', (p, _b, q, _c, db) => db.audit.filter(a => a.orgId === p.org && (!q.get('tournamentId') || a.tournamentId === q.get('tournamentId'))).slice(0, 200)],
  ['GET', '/orgs/:org/templates', (_p, _b, _q, _c, db) => db.templates],

  // ---- tournaments ----
  ['GET', '/tournaments/:id', (p, _b, _q, _c, db) => { const t = T(db, p.id); return { ...t, phase: phase(db, t) }; }],
  ['PUT', '/tournaments/:id', (p, b, _q, ctx, db) => {
    need(ctx, ADMIN); const t = T(db, p.id);
    if (t.status === 'archived') throw new ApiError(409, 'archived', 'Archived tournaments are read-only');
    const locked = db.matches.some(m => m.tournamentId === t.id && m.published);
    if (locked && b.categories && JSON.stringify(b.categories.map((c: any) => c.format)) !== JSON.stringify(t.categories.map(c => c.format)))
      throw new ApiError(409, 'format_locked', 'Formats are locked once fixtures are published. Unpublish fixtures first.');
    Object.assign(t, b, { id: t.id, orgId: t.orgId, status: t.status, updatedAt: now() });
    t.categories = (t.categories ?? []).map(c => ({ ...c, id: c.id || uid('c'), tournamentId: t.id }));
    audit(db, ctx, t, 'tournament', t.id, 'updated'); return t;
  }],
  ['POST', '/tournaments/:id/duplicate', (p, _b, _q, ctx, db) => {
    need(ctx, ADMIN); const src = T(db, p.id), id = uid('t');
    const t: Tournament = JSON.parse(JSON.stringify(src));
    Object.assign(t, { id, name: `${src.name} (copy)`, slug: `${src.slug}-copy-${id.slice(-4)}`, status: 'draft', publishedAt: undefined, archivedAt: undefined, createdAt: now(), updatedAt: now() });
    t.categories = t.categories.map(c => ({ ...c, id: uid('c'), tournamentId: id }));
    db.tournaments.push(t);
    // Rules are COPIED, never shared: editing the copy can't change the source (acceptance criterion #1).
    const latest = db.rules.filter(r => r.tournamentId === src.id).sort((a, b) => b.version - a.version)[0];
    db.rules.push({ id: uid('rv'), tournamentId: id, version: 1, status: 'draft', sections: JSON.parse(JSON.stringify(latest?.sections ?? blankSections())), attachments: [], material: true, changeSummary: `Copied from ${src.name} v${latest?.version ?? 0}`, authorId: ctx.userId, authorName: userName(db, ctx.userId), createdAt: now() });
    audit(db, ctx, t, 'tournament', id, 'duplicated', `from ${src.id}`); return t;
  }],
  ['POST', '/tournaments/:id/publish', (p, _b, _q, ctx, db) => {
    need(ctx, ADMIN); const t = T(db, p.id), issues = publishChecklist(db, t).filter(i => !i.ok);
    if (issues.length) throw new ApiError(422, 'not_ready', 'Finish setup before publishing', issues);
    t.status = 'published'; t.publishedAt = now(); audit(db, ctx, t, 'tournament', t.id, 'published'); return t;
  }],
  ['GET', '/tournaments/:id/checklist', (p, _b, _q, _c, db) => publishChecklist(db, T(db, p.id))],
  ['POST', '/tournaments/:id/unpublish', (p, b, _q, ctx, db) => { need(ctx, ADMIN); const t = T(db, p.id); t.status = 'unpublished'; audit(db, ctx, t, 'tournament', t.id, 'unpublished', b?.reason); return t; }],
  ['POST', '/tournaments/:id/archive', (p, _b, _q, ctx, db) => { need(ctx, ADMIN); const t = T(db, p.id); t.status = 'archived'; t.archivedAt = now(); audit(db, ctx, t, 'tournament', t.id, 'archived'); return t; }],
  ['GET', '/tournaments/:id/dashboard', (p, _b, _q, _c, db) => dashboard(db, T(db, p.id))],
  ['GET', '/tournaments/:id/journey', (p, _b, _q, _c, db) => {
    const t = T(db, p.id), ms = db.matches.filter(m => m.tournamentId === t.id), rs = db.registrations.filter(r => r.tournamentId === t.id), byes = (m: Match) => m.result?.detail === 'Bye';
    const real = ms.filter(m => !byes(m)), finished = real.filter(m => ['completed', 'walkover', 'abandoned'].includes(m.status));
    return journey({ setupIssues: publishChecklist(db, t).filter(c => !c.ok && c.id !== 'rules'), rulesPublished: db.rules.some(r => r.tournamentId === t.id && r.status === 'published'),
      published: t.status === 'published', archived: t.status === 'archived', finished: !!t.finishedAt, regOpensAt: t.regOpensAt || new Date().toISOString(), regClosesAt: t.regClosesAt || new Date().toISOString(), now: Date.now(),
      entries: { confirmed: rs.filter(r => r.status === 'confirmed').length, pending: rs.filter(r => r.status === 'pending_payment').length, capacity: t.categories.reduce((a, c) => a + c.capacity, 0) },
      categories: t.categories.filter(c => c.format.type !== 'custom').length, categoriesWithPublishedFixtures: t.categories.filter(c => c.format.type !== 'custom' && ms.some(m => m.categoryId === c.id && m.published)).length,
      matches: { total: real.length, finished: finished.length, unverified: finished.filter(m => m.result && m.result.verification !== 'verified').length } });
  }],
  ['POST', '/tournaments/:id/finish', (p, _b, _q, ctx, db) => {
    need(ctx, ADMIN); const t = T(db, p.id); if (t.finishedAt) throw new ApiError(409, 'already_finished', 'This tournament is already finished');
    const ms = db.matches.filter(m => m.tournamentId === t.id && m.result?.detail !== 'Bye');
    const open = ms.filter(m => !['completed', 'walkover', 'abandoned'].includes(m.status)).length, unverified = ms.filter(m => m.result && m.result.verification !== 'verified').length;
    if (!ms.length || open || unverified) throw new ApiError(409, 'not_ready', `${open} match(es) still to play and ${unverified} result(s) to verify before finishing`, { open, unverified });
    t.winners = t.categories.flatMap(c => {   // knockout: verified final winner; league/round robin: table leader
      const final = ms.find(m => m.categoryId === c.id && m.roundName === 'Final'), regs = db.registrations.filter(r => r.categoryId === c.id);
      const regId = final?.result?.winnerId ?? computeStandings(ms.filter(m => m.categoryId === c.id), regs, t.scoring, c.format.qualifiersPerGroup).find(r => r.rank === 1)?.regId;
      return regId ? [{ categoryId: c.id, regId, name: regs.find(r => r.id === regId)?.entryName ?? '' }] : [];
    });
    t.finishedAt = now();
    notify(db, ctx, t, 'result_published', `${t.name}: final results`, t.winners.map(w => `${t.categories.find(c => c.id === w.categoryId)?.name}: ${w.name}`).join(' · ') || 'Final results are published.', db.registrations.filter(r => r.tournamentId === t.id && r.status === 'confirmed').map(r => r.id));
    audit(db, ctx, t, 'tournament', t.id, 'finished', undefined, { winners: t.winners }); return t;
  }],

  // ---- rules ----
  ['GET', '/tournaments/:id/rules', (p, _b, _q, _c, db) => {
    const t = T(db, p.id), versions = db.rules.filter(r => r.tournamentId === t.id).sort((a, b) => b.version - a.version);
    const pub = versions.find(v => v.status === 'published');
    const regs = db.registrations.filter(r => r.tournamentId === t.id && !['withdrawn', 'rejected'].includes(r.status));
    return { versions, published: pub, ackStats: { total: regs.length, onLatest: regs.filter(r => r.ackVersion === pub?.version).length, needsReack: regs.filter(r => r.needsReack).length } };
  }],
  ['POST', '/tournaments/:id/rules', (p, b, _q, ctx, db) => {
    need(ctx, ADMIN); const t = T(db, p.id);
    if (db.rules.some(r => r.tournamentId === t.id && r.status === 'draft')) throw new ApiError(409, 'draft_exists', 'There is already a draft. Edit it instead.');
    const vs = db.rules.filter(r => r.tournamentId === t.id), base = b.fromTournamentId
      ? db.rules.filter(r => r.tournamentId === b.fromTournamentId).sort((a, c) => c.version - a.version)[0]?.sections
      : b.templateId ? db.templates.find(x => x.id === b.templateId)?.sections : vs.sort((a, c) => c.version - a.version)[0]?.sections;
    const v = { id: uid('rv'), tournamentId: t.id, version: Math.max(0, ...vs.map(x => x.version)) + 1, status: 'draft' as const, sections: JSON.parse(JSON.stringify(base ?? blankSections())), attachments: [], material: false, changeSummary: '', authorId: ctx.userId, authorName: userName(db, ctx.userId), createdAt: now() };
    db.rules.push(v); return v;
  }],
  ['PATCH', '/rule-versions/:id', (p, b, _q, ctx, db) => {
    need(ctx, ADMIN); const v = db.rules.find(r => r.id === p.id) ?? notFound('rule version');
    if (v.status !== 'draft') throw new ApiError(409, 'immutable', 'Published versions are immutable. Create a new draft.');
    Object.assign(v, { sections: b.sections ?? v.sections, attachments: b.attachments ?? v.attachments, changeSummary: b.changeSummary ?? v.changeSummary }); return v;
  }],
  ['POST', '/rule-versions/:id/publish', (p, b, _q, ctx, db) => {
    need(ctx, ADMIN); const v = db.rules.find(r => r.id === p.id) ?? notFound('rule version'), t = T(db, v.tournamentId);
    if (v.status !== 'draft') throw new ApiError(409, 'immutable', 'Only drafts can be published');
    if (!b.changeSummary && v.version > 1) throw new ApiError(422, 'validation', 'Summarise what changed', { field: 'changeSummary' });
    db.rules.filter(r => r.tournamentId === t.id && r.status === 'published').forEach(r => { r.status = 'superseded'; });
    Object.assign(v, { status: 'published', publishedAt: now(), material: !!b.material, changeSummary: b.changeSummary ?? v.changeSummary });
    const ids = activeRegIds(db, t.id);
    if (v.material && v.version > 1) {
      db.registrations.filter(r => ids.includes(r.id)).forEach(r => { r.needsReack = true; });
      notify(db, ctx, t, 'rules_ack_required', `Rules updated to v${v.version}: please re-accept`, v.changeSummary, ids);
    } else if (v.version > 1) notify(db, ctx, t, 'custom', `Rules updated (v${v.version})`, v.changeSummary, ids);
    audit(db, ctx, t, 'rules', v.id, `published v${v.version}`, v.material ? 'material change' : 'minor change'); return v;
  }],
  ['POST', '/rule-versions/:id/unpublish', (p, _b, _q, ctx, db) => {
    need(ctx, ADMIN); const v = db.rules.find(r => r.id === p.id) ?? notFound('rule version'); v.status = 'unpublished';
    const prev = db.rules.filter(r => r.tournamentId === v.tournamentId && r.status === 'superseded').sort((a, b) => b.version - a.version)[0];
    if (prev) prev.status = 'published';
    audit(db, ctx, T(db, v.tournamentId), 'rules', v.id, `unpublished v${v.version}`); return v;
  }],
  ['POST', '/rule-versions/:id/attachments', (p, b, _q, ctx, db) => {
    need(ctx, ADMIN); const v = db.rules.find(r => r.id === p.id) ?? notFound('rule version');
    if (!/pdf|word|officedocument/.test(b.mime)) throw new ApiError(422, 'validation', 'Upload a PDF or Word file');
    if (b.sizeBytes > 10 * 1024 * 1024) throw new ApiError(413, 'too_large', 'Files must be under 10 MB');
    const a = { id: uid('f'), name: b.name, sizeBytes: b.sizeBytes, mime: b.mime, url: '#' }; v.attachments.push(a); return a;
  }],

  // ---- registrations ----
  ['GET', '/tournaments/:id/registrations', (p, _b, q, _c, db) => {
    const t = T(db, p.id); let rs = db.registrations.filter(r => r.tournamentId === t.id);
    if (q.get('status')) rs = rs.filter(r => r.status === q.get('status'));
    if (q.get('categoryId')) rs = rs.filter(r => r.categoryId === q.get('categoryId'));
    const s = q.get('q')?.toLowerCase(); if (s) rs = rs.filter(r => r.entryName.toLowerCase().includes(s) || r.captainPhone.includes(s));
    return rs.map(r => ({ ...r, players: r.playerIds.map(id => db.players.find(x => x.id === id)) }));
  }],
  ['GET', '/registrations/:id', (p, _b, _q, _c, db) => {
    const r = R(db, p.id);
    return { ...r, players: r.playerIds.map(id => db.players.find(x => x.id === id)), payments: db.payments.filter(x => x.registrationId === r.id), refunds: db.refunds.filter(f => db.payments.some(x => x.id === f.paymentId && x.registrationId === r.id)), acks: db.acks.filter(a => a.registrationId === r.id), audit: db.audit.filter(a => a.entityId === r.id) };
  }],
  ['POST', '/tournaments/:id/registrations/validate', (p, b, _q, _c, db) => { const t = T(db, p.id), cat = t.categories.find(c => c.id === b.categoryId) ?? notFound('category'); return checkEntry(t, cat, b.players, db.registrations, b.captainPhone); }],
  ['POST', '/tournaments/:id/registrations', (p, b, _q, ctx, db) => {
    const t = T(db, p.id), cat = t.categories.find(c => c.id === b.categoryId) ?? notFound('category');
    if (t.status !== 'published') throw new ApiError(409, 'closed', 'Registration is not open');
    const n = Date.now();
    if ((n < Date.parse(t.regOpensAt) || n > Date.parse(t.regClosesAt)) && !t.registration.allowLate && ctx.role !== 'org_admin') throw new ApiError(409, 'window_closed', 'Registration window is closed');
    const pub = db.rules.find(r => r.tournamentId === t.id && r.status === 'published');
    if (!pub || b.ackVersion !== pub.version) throw new ApiError(422, 'ack_required', `Accept rules v${pub?.version} to continue`);
    const players: Player[] = b.players.map((x: Player) => ({ ...x, id: x.id || uid('p'), statsVisibility: x.statsVisibility ?? 'public' }));
    const issues = checkEntry(t, cat, players, db.registrations, b.captainPhone).filter(i => i.blocking);
    if (issues.length) throw new ApiError(422, 'ineligible', issues[0].message, issues);
    const st = initialStatus(cat, db.registrations, t.registration.waitlist);
    if (st === 'full') throw new ApiError(409, 'full', 'This category is full');
    db.players.push(...players);
    const r: Registration = { id: uid('r'), tournamentId: t.id, categoryId: cat.id, entryName: b.entryName || players.map(x => x.name).join(' / '), captainId: players[0].id, captainPhone: b.captainPhone, playerIds: players.map(x => x.id),
      status: st, payStatus: cat.feePaise ? 'unpaid' : 'waived', amountPaise: cat.feePaise, paidPaise: 0, ackVersion: pub.version, needsReack: false, exceptions: [], createdAt: now(),
      waitlistPos: st === 'waitlisted' ? db.registrations.filter(x => x.categoryId === cat.id && x.status === 'waitlisted').length + 1 : undefined,
      documents: (b.documents ?? []).map((d: any) => ({ ...d, id: uid('d'), status: 'pending' })) };
    if (st === 'confirmed') r.confirmedAt = now();
    db.registrations.push(r);
    db.acks.push({ id: uid('ack'), registrationId: r.id, ruleVersionId: pub.id, version: pub.version, userId: ctx.userId, acceptedAt: now() });
    audit(db, ctx, t, 'registration', r.id, 'created', `status ${st}`); return r;
  }],
  ['POST', '/registrations/:id/payments', (p, b, _q, ctx, db) => {
    // Real backend: create a Razorpay order, return order_id; the webhook (payment.captured) confirms. Mock captures instantly.
    const r = R(db, p.id), t = T(db, r.tournamentId);
    if (r.status !== 'pending_payment') throw new ApiError(409, 'bad_state', 'Nothing to pay');
    if (b.simulate === 'fail') { db.payments.push({ id: uid('pay'), registrationId: r.id, amountPaise: r.amountPaise, method: b.method, status: 'failed', createdAt: now() }); throw new ApiError(402, 'payment_failed', 'Payment failed at the bank. No money was taken.'); }
    const pay = { id: uid('pay'), registrationId: r.id, amountPaise: r.amountPaise, method: b.method ?? 'upi', status: 'captured' as const, gatewayRef: `pay_${uid('').slice(1)}`, receiptNo: `DSQ-${Date.now().toString().slice(-6)}`, createdAt: now() };
    db.payments.push(pay); Object.assign(r, { status: 'confirmed', payStatus: 'paid', paidPaise: r.amountPaise, confirmedAt: now() });
    notify(db, ctx, t, 'payment_receipt', `Receipt ${pay.receiptNo}`, `Entry confirmed for ${r.entryName}.`, [r.id]);
    return pay;
  }],
  ['POST', '/registrations/:id/ack', (p, b, _q, ctx, db) => {
    const r = R(db, p.id), pub = db.rules.find(x => x.tournamentId === r.tournamentId && x.status === 'published') ?? notFound('published rules');
    if (b.version !== pub.version) throw new ApiError(409, 'stale_version', `Current version is v${pub.version}`);
    db.acks.push({ id: uid('ack'), registrationId: r.id, ruleVersionId: pub.id, version: pub.version, userId: ctx.userId, acceptedAt: now() });
    r.ackVersion = pub.version; r.needsReack = false; return r;
  }],
  ['POST', '/registrations/:id/status', (p, b, _q, ctx, db) => {
    need(ctx, DESK); const r = R(db, p.id), t = T(db, r.tournamentId), cat = t.categories.find(c => c.id === r.categoryId)!;
    if (!canMove(r.status, b.status)) throw new ApiError(409, 'bad_transition', `Can't move from ${r.status} to ${b.status}`);
    if ((b.status === 'rejected' || b.status === 'withdrawn') && !b.reason) throw new ApiError(422, 'validation', 'Give a reason', { field: 'reason' });
    const from = r.status; r.status = b.status; if (b.status === 'rejected') r.rejectReason = b.reason;
    if (b.status === 'confirmed') r.confirmedAt = now();
    if (from === 'confirmed' || from === 'pending_payment') { // free a place: promote the first waitlisted entry
      const next = db.registrations.filter(x => x.categoryId === cat.id && x.status === 'waitlisted').sort((a, c) => (a.waitlistPos ?? 0) - (c.waitlistPos ?? 0))[0];
      if (next) { next.status = cat.feePaise ? 'pending_payment' : 'confirmed'; next.waitlistPos = undefined; notify(db, ctx, t, 'waitlist_promoted', 'A place opened up', `${next.entryName}: you're off the waitlist.`, [next.id]); }
    }
    if (b.status === 'confirmed') notify(db, ctx, t, 'registration_confirmed', 'Entry confirmed', r.entryName, [r.id]);
    audit(db, ctx, t, 'registration', r.id, `${from} → ${b.status}`, b.reason);
    return { ...r, refundDue: b.status === 'withdrawn' ? refundDue(t, r.paidPaise, new Date()) : 0 };
  }],
  ['POST', '/registrations/:id/exceptions', (p, b, _q, ctx, db) => {
    need(ctx, ADMIN); const r = R(db, p.id), t = T(db, r.tournamentId);
    if (!b.reason) throw new ApiError(422, 'validation', 'An exception needs a reason', { field: 'reason' });
    r.exceptions.push({ type: b.type, reason: b.reason, approvedBy: ctx.userId, at: now() });
    if (b.type === 'fee_waiver' && r.status === 'pending_payment') { Object.assign(r, { status: 'confirmed', payStatus: 'waived', confirmedAt: now() }); db.payments.push({ id: uid('pay'), registrationId: r.id, amountPaise: 0, method: 'waiver', status: 'captured', receiptNo: `DSQ-W-${Date.now().toString().slice(-5)}`, createdAt: now() }); }
    audit(db, ctx, t, 'registration', r.id, `exception: ${b.type}`, b.reason); return r;
  }],
  ['POST', '/registrations/:id/refunds', (p, b, _q, ctx, db) => {
    need(ctx, DESK); const r = R(db, p.id), t = T(db, r.tournamentId), pay = db.payments.find(x => x.registrationId === r.id && x.status === 'captured' && x.amountPaise > 0);
    if (!pay) throw new ApiError(409, 'no_payment', 'No captured payment to refund');
    if (b.amountPaise > r.paidPaise) throw new ApiError(422, 'validation', 'Refund is more than was paid', { field: 'amountPaise' });
    if (!b.reason) throw new ApiError(422, 'validation', 'Give a reason', { field: 'reason' });
    const f = { id: uid('rf'), paymentId: pay.id, amountPaise: b.amountPaise, reason: b.reason, status: 'processed' as const, createdAt: now(), by: ctx.userId };
    db.refunds.push(f); r.paidPaise -= b.amountPaise; r.payStatus = r.paidPaise ? 'partially_refunded' : 'refunded';
    audit(db, ctx, t, 'registration', r.id, `refund ₹${b.amountPaise / 100}`, b.reason); return f;
  }],
  ['PATCH', '/registrations/:id/documents/:docId', (p, b, _q, ctx, db) => { need(ctx, DESK); const r = R(db, p.id), d = r.documents.find(x => x.id === p.docId) ?? notFound('document'); d.status = b.status; audit(db, ctx, T(db, r.tournamentId), 'document', d.id, b.status); return d; }],
  ['PATCH', '/registrations/:id/roster', (p, b, _q, ctx, db) => {
    const r = R(db, p.id), t = T(db, r.tournamentId);
    if (Date.now() > Date.parse(t.rosterCutoffAt) && ctx.role !== 'org_admin') throw new ApiError(409, 'cutoff', 'The roster cutoff has passed. Ask the organizer for an exception.');
    const ps: Player[] = b.players.map((x: Player) => ({ ...x, id: x.id || uid('p') }));
    ps.forEach(x => { const i = db.players.findIndex(y => y.id === x.id); if (i >= 0) db.players[i] = x; else db.players.push(x); });
    r.playerIds = ps.map(x => x.id); audit(db, ctx, t, 'registration', r.id, 'roster edited'); return r;
  }],

  // ---- fixtures ----
  ['GET', '/tournaments/:id/matches', (p, _b, q, _c, db) => {
    const t = T(db, p.id); let ms = db.matches.filter(m => m.tournamentId === t.id);
    if (q.get('categoryId')) ms = ms.filter(m => m.categoryId === q.get('categoryId'));
    if (q.get('published') === 'true') ms = ms.filter(m => m.published);
    return ms.map(m => decorate(db, m));
  }],
  ['POST', '/tournaments/:id/fixtures/generate', (p, b, _q, ctx, db) => {
    need(ctx, ADMIN); const t = T(db, p.id), cat = t.categories.find(c => c.id === b.categoryId) ?? notFound('category');
    if (db.matches.some(m => m.categoryId === cat.id && (m.published || m.status !== 'scheduled'))) throw new ApiError(409, 'locked', 'Fixtures are published or under way. Edit matches individually instead.');
    const entries = db.registrations.filter(r => r.categoryId === cat.id && r.status === 'confirmed');
    if (entries.length < 2) throw new ApiError(422, 'too_few', 'Need at least 2 confirmed entries');
    db.matches = db.matches.filter(m => m.categoryId !== cat.id);
    const ms = generateFixtures(t.id, cat, entries, t.schedule.matchMinutes);
    schedule(ms, db.courts.filter(c => t.courtIds.includes(c.id)), t.schedule, t.startDate, t.endDate, [...busyFor(db, t), ...db.matches.filter(m => m.tournamentId === t.id && m.startAt).map(m => ({ courtId: m.courtId!, start: Date.parse(m.startAt!), end: Date.parse(m.startAt!) + (m.durationMin + t.schedule.bufferMinutes) * 60000, label: m.code }))]);
    db.matches.push(...ms); audit(db, ctx, t, 'fixtures', cat.id, `generated ${ms.length} matches`);
    return { matches: ms.map(m => decorate(db, m)), clashes: detectClashes(db.matches.filter(m => m.tournamentId === t.id), t.schedule, busyFor(db, t)) };
  }],
  ['GET', '/tournaments/:id/clashes', (p, _b, _q, _c, db) => { const t = T(db, p.id); return detectClashes(db.matches.filter(m => m.tournamentId === t.id), t.schedule, busyFor(db, t)); }],
  ['PATCH', '/matches/:id', (p, b, _q, ctx, db) => {
    need(ctx, ADMIN); const m = M(db, p.id), t = T(db, m.tournamentId);
    if (['completed', 'walkover'].includes(m.status)) throw new ApiError(409, 'finished', 'Finished matches cannot be moved');
    const before = { courtId: m.courtId, startAt: m.startAt, status: m.status };
    if (b.status === 'postponed' && !b.reason) throw new ApiError(422, 'validation', 'Give a reason for postponing', { field: 'reason' });
    Object.assign(m, { courtId: b.courtId ?? m.courtId, startAt: b.startAt ?? m.startAt, refereeIds: b.refereeIds ?? m.refereeIds });
    if (b.status) { m.status = b.status; m.postponedReason = b.reason; }
    if (b.status === 'scheduled' && before.status === 'postponed') m.postponedReason = undefined;
    const changed = m.published && (before.courtId !== m.courtId || before.startAt !== m.startAt || b.status === 'postponed');
    if (changed) m.fixturesVersion++; // a revised fixture; participants are told when the revision is published
    audit(db, ctx, t, 'match', m.id, 'rescheduled', b.reason, { before, after: { courtId: m.courtId, startAt: m.startAt, status: m.status } });
    return { match: decorate(db, m), clashes: detectClashes(db.matches.filter(x => x.tournamentId === t.id), t.schedule, busyFor(db, t)).filter(c => c.matchId === m.id || c.otherId === m.id) };
  }],
  ['POST', '/tournaments/:id/fixtures/publish', (p, b, _q, ctx, db) => {
    need(ctx, ADMIN); const t = T(db, p.id), ms = db.matches.filter(m => m.tournamentId === t.id && (!b.categoryId || m.categoryId === b.categoryId));
    const blocking = detectClashes(ms, t.schedule, busyFor(db, t)).filter(blockingClash);
    if (blocking.length) throw new ApiError(422, 'clashes', `${blocking.length} clash(es) must be fixed first`, blocking);
    const revised = ms.filter(m => m.published && m.fixturesVersion > 1);
    ms.forEach(m => { m.published = true; m.fixturesVersion = Math.max(1, m.fixturesVersion); });
    const affected = revised.length ? [...new Set(revised.flatMap(m => [m.homeId, m.awayId]).filter(Boolean) as string[])] : activeRegIds(db, t.id);
    if (b.notify !== false) notify(db, ctx, t, revised.length ? 'schedule_changed' : 'fixtures_published', revised.length ? 'Schedule changed' : 'Fixtures are out', revised.length ? `${revised.length} match(es) moved. Check your new times.` : `Fixtures for ${t.name} are published.`, affected);
    if (t.schedule.createVenueHolds) syncHolds(db, t);
    audit(db, ctx, t, 'fixtures', t.id, 'published', `${ms.length} matches`); return { published: ms.length, notified: affected.length };
  }],
  ['POST', '/tournaments/:id/fixtures/advance', (p, b, _q, ctx, db) => { need(ctx, ADMIN); const t = T(db, p.id); advance(db, t, b.categoryId); return db.matches.filter(m => m.categoryId === b.categoryId && m.stage === 'knockout').map(m => decorate(db, m)); }],
  ['GET', '/tournaments/:id/availability', (p, _b, _q, _c, db) => busyFor(db, T(db, p.id)).map(b => ({ courtId: b.courtId, startAt: new Date(b.start).toISOString(), endAt: new Date(b.end).toISOString(), label: b.label }))],
  ['GET', '/tournaments/:id/venue-holds', (p, _b, _q, _c, db) => db.holds.filter(h => h.tournamentId === T(db, p.id).id)],

  // ---- match control ----
  ['GET', '/matches/:id', (p, _b, _q, _c, db) => { const m = M(db, p.id), t = T(db, m.tournamentId); return { ...decorate(db, m), tournament: { id: t.id, name: t.name, sport: t.sport, scoring: t.scoring }, events: db.events.filter(e => e.matchId === m.id).sort((a, b) => a.seq - b.seq) }; }],
  ['POST', '/matches/:id/events', (p, b, _q, ctx, db) => {
    need(ctx, REF); const m = M(db, p.id);
    if (ctx.role === 'referee' && !m.refereeIds.includes(ctx.userId)) throw new ApiError(403, 'not_assigned', 'You are not assigned to this match');
    if (!['live', 'paused'].includes(m.status)) throw new ApiError(409, 'not_live', 'Start the match first');
    const out = [];
    for (const e of (b.events ?? [b]) as any[]) { // batch: offline queue flushes many at once; clientId makes it idempotent
      if (db.events.some(x => x.clientId === e.clientId)) continue;
      if (e.type === 'void') { const target = db.events.filter(x => x.matchId === m.id && !x.voided).sort((a, c) => c.seq - a.seq)[0]; if (target) target.voided = true; continue; }
      const seq = Math.max(0, ...db.events.filter(x => x.matchId === m.id).map(x => x.seq)) + 1;
      const ev = { id: uid('e'), matchId: m.id, seq, clientId: e.clientId, type: e.type, payload: e.payload ?? {}, by: ctx.userId, at: e.at ?? now() }; db.events.push(ev); out.push(ev);
    }
    return { accepted: out.length, events: db.events.filter(x => x.matchId === m.id).sort((a, c) => a.seq - c.seq) };
  }],
  ['POST', '/matches/:id/status', (p, b, _q, ctx, db) => {
    need(ctx, REF); const m = M(db, p.id), to = b.status as MatchStatus;
    if (!MATCH_TRANSITIONS[m.status].includes(to)) throw new ApiError(409, 'bad_transition', `Can't go from ${m.status} to ${to}`);
    if ((to === 'abandoned' || to === 'walkover') && !b.reason) throw new ApiError(422, 'validation', 'Give a reason', { field: 'reason' });
    const t = T(db, m.tournamentId);
    if (to === 'live' && !m.startedAt) m.startedAt = now();
    m.status = to;
    if (to === 'walkover') { m.result = { homeScore: 0, awayScore: 0, detail: `Walkover (${b.reason})`, isDraw: false, walkover: b.winner, winnerId: b.winner === 'home' ? m.homeId : m.awayId, verification: 'submitted', submittedBy: ctx.userId, submittedAt: now(), source: 'manual' }; m.endedAt = now(); }
    audit(db, ctx, t, 'match', m.id, `status → ${to}`, b.reason); return decorate(db, m);
  }],
  ['POST', '/matches/:id/submit', (p, b, _q, ctx, db) => {
    need(ctx, REF); const m = M(db, p.id), t = T(db, m.tournamentId);
    let res;
    if (b.manual || !t.scoring.autoScoring) {
      if (b.homeScore == null || b.awayScore == null) throw new ApiError(422, 'validation', 'Enter both scores');
      res = { homeScore: +b.homeScore, awayScore: +b.awayScore, detail: b.detail || `${b.homeScore}-${b.awayScore}`, isDraw: +b.homeScore === +b.awayScore && !b.winner, winnerId: b.winner ? (b.winner === 'home' ? m.homeId : m.awayId) : +b.homeScore > +b.awayScore ? m.homeId : +b.awayScore > +b.homeScore ? m.awayId : undefined, source: 'manual' as const };
    } else {
      const s = summarize(t.sport, db.events.filter(e => e.matchId === m.id), t.scoring);
      if (!s.finished && !b.force) throw new ApiError(409, 'not_finished', 'The scoring rules say this match is not over yet. Finish it, or end it early with a reason.');
      res = { homeScore: s.home, awayScore: s.away, detail: s.detail, isDraw: s.isDraw, winnerId: s.winner === 'home' ? m.homeId : s.winner === 'away' ? m.awayId : undefined, source: 'live' as const };
    }
    if (m.stage === 'knockout' && res.isDraw) throw new ApiError(422, 'draw_in_knockout', 'Knockout matches need a winner (use the tie-break, e.g. penalties)');
    m.result = { ...res, verification: 'submitted', submittedBy: ctx.userId, submittedAt: now() }; m.status = 'completed'; m.endedAt = now();
    audit(db, ctx, t, 'match', m.id, 'result submitted', b.reason, { result: m.result });
    if (ctx.role === 'org_admin' && b.verify) finalizeResult(db, ctx, m, t);
    return decorate(db, m);
  }],
  ['POST', '/matches/:id/verify', (p, _b, _q, ctx, db) => {
    need(ctx, [...ADMIN, 'captain']); const m = M(db, p.id), t = T(db, m.tournamentId);
    if (!m.result || m.result.verification === 'verified') throw new ApiError(409, 'bad_state', 'Nothing to verify');
    if (m.result.submittedBy === ctx.userId) throw new ApiError(409, 'four_eyes', 'Someone other than the scorer must verify');
    finalizeResult(db, ctx, m, t); audit(db, ctx, t, 'match', m.id, 'result verified'); return decorate(db, m);
  }],
  ['POST', '/matches/:id/dispute', (p, b, _q, ctx, db) => {
    const m = M(db, p.id); if (!b.reason) throw new ApiError(422, 'validation', 'Say what is wrong', { field: 'reason' });
    if (!m.result) throw new ApiError(409, 'bad_state', 'No result yet');
    m.result.verification = 'disputed'; m.result.disputeReason = b.reason; audit(db, ctx, T(db, m.tournamentId), 'match', m.id, 'result disputed', b.reason); return decorate(db, m);
  }],
  ['POST', '/matches/:id/correct', (p, b, _q, ctx, db) => {
    need(ctx, ADMIN); const m = M(db, p.id), t = T(db, m.tournamentId);
    if (!b.reason) throw new ApiError(422, 'validation', 'Corrections need a reason', { field: 'reason' });
    const before = { ...m.result };
    m.result = { ...m.result!, homeScore: +b.homeScore, awayScore: +b.awayScore, detail: b.detail || `${b.homeScore}-${b.awayScore}`, isDraw: +b.homeScore === +b.awayScore, winnerId: +b.homeScore > +b.awayScore ? m.homeId : +b.awayScore > +b.homeScore ? m.awayId : undefined, source: 'manual', verification: 'submitted', disputeReason: undefined };
    audit(db, ctx, t, 'match', m.id, 'result corrected', b.reason, { before, after: m.result });
    finalizeResult(db, ctx, m, t); return decorate(db, m);
  }],
  ['GET', '/me/matches', (_p, _b, _q, ctx, db) => db.matches.filter(m => ctx.role === 'org_admin' || m.refereeIds.includes(ctx.userId)).filter(m => m.published && ['scheduled', 'live', 'paused'].includes(m.status) && m.homeId && m.awayId).sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? '')).slice(0, 40).map(m => decorate(db, m))],

  // ---- standings & stats ----
  ['GET', '/tournaments/:id/standings', (p, _b, q, _c, db) => {
    const t = T(db, p.id), cats = q.get('categoryId') ? t.categories.filter(c => c.id === q.get('categoryId')) : t.categories;
    return cats.map(c => ({ categoryId: c.id, name: c.name, format: c.format.type, rows: computeStandings(db.matches.filter(m => m.categoryId === c.id), db.registrations.filter(r => r.categoryId === c.id), t.scoring, c.format.qualifiersPerGroup, db.overrides.filter(o => o.categoryId === c.id)),
      bracket: db.matches.filter(m => m.categoryId === c.id && m.stage === 'knockout').map(m => decorate(db, m)), overrides: db.overrides.filter(o => o.categoryId === c.id) }));
  }],
  ['POST', '/tournaments/:id/standings/overrides', (p, b, _q, ctx, db) => {
    need(ctx, ADMIN); const t = T(db, p.id); if (!b.reason) throw new ApiError(422, 'validation', 'Overrides need a reason', { field: 'reason' });
    const o = { id: uid('ov'), tournamentId: t.id, categoryId: b.categoryId, group: b.group, regId: b.regId, rank: +b.rank, reason: b.reason, requestedBy: ctx.userId, status: 'pending' as const, at: now() };
    db.overrides.push(o); audit(db, ctx, t, 'standings', o.id, 'override requested', b.reason); return o;
  }],
  ['POST', '/standings-overrides/:id/decide', (p, b, _q, ctx, db) => {
    need(ctx, ADMIN); const o = db.overrides.find(x => x.id === p.id) ?? notFound('override');
    if (o.requestedBy === ctx.userId && b.decision === 'approved' && !b.selfApprove) throw new ApiError(409, 'four_eyes', 'A second organizer must approve. (Demo: tick "approve my own request".)');
    o.status = b.decision; o.approvedBy = ctx.userId; const t = T(db, o.tournamentId); advance(db, t, o.categoryId); audit(db, ctx, t, 'standings', o.id, `override ${b.decision}`); return o;
  }],
  ['GET', '/tournaments/:id/stats', (p, _b, q, _c, db) => {
    const t = T(db, p.id), key = q.get('key'), rows = db.stats.filter(s => s.tournamentId === t.id && (!key || s.key === key));
    const by = new Map<string, { playerId: string; regId: string; value: number; matches: number; verified: boolean }>();
    for (const s of rows) { const r = by.get(s.playerId) ?? { playerId: s.playerId, regId: s.regId, value: 0, matches: 0, verified: true }; r.value += s.value; r.matches++; r.verified &&= s.verified; by.set(s.playerId, r); }
    const keys = [...new Set(db.stats.filter(s => s.tournamentId === t.id).map(s => s.key))];
    return { keys, leaderboard: [...by.values()].sort((a, b) => b.value - a.value).map(r => { const pl = db.players.find(x => x.id === r.playerId)!; const hide = pl?.statsVisibility !== 'public' && q.get('public') === 'true'; return { ...r, name: hide ? 'Hidden (minor / private)' : pl?.name, entry: db.registrations.find(x => x.id === r.regId)?.entryName, hidden: hide }; }),
      teams: teamSummary(db, t) };
  }],
  ['POST', '/tournaments/:id/stats', (p, b, _q, ctx, db) => {
    need(ctx, REF); const t = T(db, p.id); if (!b.reason) throw new ApiError(422, 'validation', 'Manual stats need a reason', { field: 'reason' });
    const s = { id: uid('st'), tournamentId: t.id, matchId: b.matchId, playerId: b.playerId, regId: b.regId, key: b.key, value: +b.value, verified: ctx.role === 'org_admin', source: 'manual' as const, by: ctx.userId, at: now() };
    db.stats.push(s); audit(db, ctx, t, 'stat', s.id, `manual ${b.key} ${b.value}`, b.reason); return s;
  }],
  ['GET', '/players/:id', (p, _b, _q, _c, db) => {
    const pl = db.players.find(x => x.id === p.id) ?? notFound('player'), regs = db.registrations.filter(r => r.playerIds.includes(pl.id));
    return { player: pl, entries: regs.map(r => ({ ...r, tournament: db.tournaments.find(t => t.id === r.tournamentId)?.name })), stats: db.stats.filter(s => s.playerId === pl.id),
      matches: db.matches.filter(m => regs.some(r => r.id === m.homeId || r.id === m.awayId)).map(m => decorate(db, m)) };
  }],

  // ---- reports & comms ----
  ['GET', '/tournaments/:id/reports', (p, _b, _q, _c, db) => reports(db, T(db, p.id))],
  ['GET', '/tournaments/:id/notifications', (p, _b, _q, _c, db) => db.notifications.filter(n => n.tournamentId === T(db, p.id).id)],
  ['POST', '/tournaments/:id/notifications', (p, b, _q, ctx, db) => {
    need(ctx, DESK); const t = T(db, p.id), ids = b.audience === 'all' ? activeRegIds(db, t.id) : b.audience === 'unpaid' ? db.registrations.filter(r => r.tournamentId === t.id && r.status === 'pending_payment').map(r => r.id) : db.registrations.filter(r => r.tournamentId === t.id && r.needsReack).map(r => r.id);
    if (!b.title || !b.body) throw new ApiError(422, 'validation', 'Add a title and a message');
    notify(db, ctx, t, 'custom', b.title, b.body, ids); return db.notifications[0];
  }],
  ['GET', '/me/notifications', (_p, _b, _q, ctx, db) => db.notifications.filter(n => ctx.role !== 'captain' || n.recipientRegIds.length).slice(0, 20)],

  // ---- public (no auth) ----
  ['GET', '/public/t/:slug', (p, _b, _q, _c, db) => {
    const t = T(db, p.slug); if (t.status !== 'published') throw new ApiError(404, 'not_found', 'This tournament is not public');
    const regs = db.registrations.filter(r => r.tournamentId === t.id);
    return { ...t, staff: undefined, phase: phase(db, t), venue: db.venues.find(v => v.id === t.venueId), rules: db.rules.find(r => r.tournamentId === t.id && r.status === 'published'),
      categories: t.categories.map(c => ({ ...c, taken: regs.filter(r => r.categoryId === c.id && ['confirmed', 'pending_payment'].includes(r.status)).length, waitlisted: regs.filter(r => r.categoryId === c.id && r.status === 'waitlisted').length })) };
  }],
  ['GET', '/public/t/:slug/matches', (p, _b, _q, _c, db) => { const t = T(db, p.slug); return db.matches.filter(m => m.tournamentId === t.id && m.published).map(m => decorate(db, m)); }],
  ['GET', '/public/registrations/:id', (p, _b, _q, _c, db) => { const r = R(db, p.id); return { ...r, captainPhone: r.captainPhone.replace(/^(\d{2})\d+(\d{3})$/, '$1•••••$2'), players: r.playerIds.map(id => ({ name: db.players.find(x => x.id === id)?.name })), receipt: db.payments.find(x => x.registrationId === r.id && x.status === 'captured')?.receiptNo }; }],
];

function decorate(db: DB, m: Match) {
  const nm = (id?: string, s?: Slot) => (id ? db.registrations.find(r => r.id === id)?.entryName : s?.kind === 'group' ? `${s.group}${s.rank}` : s?.kind === 'winner' ? `Winner ${db.matches.find(x => x.id === s.matchId)?.code}` : s?.kind === 'loser' ? `Loser ${db.matches.find(x => x.id === s.matchId)?.code}` : s?.kind === 'bye' ? 'Bye' : 'TBD');
  const t = db.tournaments.find(x => x.id === m.tournamentId)!;
  const evts = db.events.filter(e => e.matchId === m.id);
  return { ...m, homeName: nm(m.homeId, m.home), awayName: nm(m.awayId, m.away), courtName: db.courts.find(c => c.id === m.courtId)?.name, categoryName: t.categories.find(c => c.id === m.categoryId)?.name, sport: t.sport,
    live: ['live', 'paused'].includes(m.status) && evts.length ? summarize(t.sport, evts, t.scoring) : undefined, referees: m.refereeIds.map(id => userName(db, id)) };
}
export type MatchView = ReturnType<typeof decorate>;

function counts(db: DB, t: Tournament) {
  const rs = db.registrations.filter(r => r.tournamentId === t.id), ms = db.matches.filter(m => m.tournamentId === t.id);
  return { entries: rs.filter(r => r.status === 'confirmed').length, capacity: t.categories.reduce((a, c) => a + c.capacity, 0), matches: ms.length, done: ms.filter(m => ['completed', 'walkover'].includes(m.status)).length, live: ms.filter(m => m.status === 'live').length };
}

export function publishChecklist(db: DB, t: Tournament) {
  const rules = db.rules.filter(r => r.tournamentId === t.id);
  const c = (id: string, label: string, ok: boolean, step: number) => ({ id, label, ok, step });
  return [
    c('basics', 'Name, sport, dates and contact', !!(t.name && t.startDate && t.endDate && t.contact.phone), 1),
    c('dates', 'Registration closes before play starts', !!t.regClosesAt && !!t.startDate && Date.parse(t.regClosesAt) <= Date.parse(`${t.startDate}T23:59:00+05:30`), 5),
    c('categories', 'At least one category with capacity', t.categories.length > 0 && t.categories.every(x => x.capacity > 0 && x.name), 2),
    c('format', 'Format and qualifiers make sense', t.categories.every(x => x.format.type !== 'group_knockout' || (x.format.groups >= 2 && x.format.qualifiersPerGroup >= 1)), 3),
    c('scoring', 'Points and tie-breakers set', t.scoring.tieBreakers.length > 0, 4),
    c('courts', 'Courts assigned', t.courtIds.length > 0 || !!t.venueText, 6),
    c('rules', 'Rules published (or ready to publish)', rules.some(r => r.status === 'published' || r.sections.some(s => s.html.trim())), 0),
  ];
}

function dashboard(db: DB, t: Tournament) {
  const rs = db.registrations.filter(r => r.tournamentId === t.id), ms = db.matches.filter(m => m.tournamentId === t.id);
  const pays = db.payments.filter(p => rs.some(r => r.id === p.registrationId) && p.status === 'captured');
  const refunds = db.refunds.filter(f => pays.some(p => p.id === f.paymentId));
  const by = (s: string) => rs.filter(r => r.status === s).length;
  const collected = pays.reduce((a, p) => a + p.amountPaise, 0), refunded = refunds.reduce((a, f) => a + f.amountPaise, 0);
  const projected = rs.filter(r => r.status === 'pending_payment').reduce((a, r) => a + r.amountPaise, 0);
  const n = Date.now();
  const late = ms.filter(m => m.status === 'scheduled' && m.startAt && Date.parse(m.startAt) < n - 10 * 60000 && m.homeId && m.awayId);
  return {
    phase: phase(db, t), entries: { confirmed: by('confirmed'), pending: by('pending_payment'), waitlisted: by('waitlisted'), rejected: by('rejected'), withdrawn: by('withdrawn'), capacity: t.categories.reduce((a, c) => a + c.capacity, 0) },
    money: { collectedPaise: collected - refunded, refundedPaise: refunded, projectedPaise: projected },
    matches: { total: ms.length, completed: ms.filter(m => ['completed', 'walkover'].includes(m.status)).length, live: ms.filter(m => ['live', 'paused'].includes(m.status)).map(m => decorate(db, m)), toVerify: ms.filter(m => m.result && m.result.verification !== 'verified').map(m => decorate(db, m)), late: late.map(m => decorate(db, m)), next: ms.filter(m => m.status === 'scheduled' && m.startAt && Date.parse(m.startAt) >= n - 10 * 60000).sort((a, b) => a.startAt!.localeCompare(b.startAt!)).slice(0, 6).map(m => decorate(db, m)) },
    categories: t.categories.map(c => ({ id: c.id, name: c.name, capacity: c.capacity, confirmed: rs.filter(r => r.categoryId === c.id && r.status === 'confirmed').length, pending: rs.filter(r => r.categoryId === c.id && r.status === 'pending_payment').length, waitlisted: rs.filter(r => r.categoryId === c.id && r.status === 'waitlisted').length })),
    attention: [
      ...rs.filter(r => r.status === 'pending_payment').length ? [{ kind: 'money', text: `${by('pending_payment')} entries waiting on payment`, to: 'registrations?status=pending_payment' }] : [],
      ...rs.flatMap(r => r.documents).filter(d => d.status === 'pending').length ? [{ kind: 'neutral', text: `${rs.flatMap(r => r.documents).filter(d => d.status === 'pending').length} documents to review`, to: 'registrations' }] : [],
      ...rs.filter(r => r.needsReack).length ? [{ kind: 'money', text: `${rs.filter(r => r.needsReack).length} entries must re-accept the new rules`, to: 'rules' }] : [],
      ...ms.filter(m => m.result?.verification === 'disputed').map(m => ({ kind: 'danger', text: `${m.code}: result disputed`, to: `matches/${m.id}` })),
      ...ms.filter(m => m.result?.verification === 'submitted').map(m => ({ kind: 'neutral', text: `${m.code}: result to verify`, to: `matches/${m.id}` })),
      ...(late.length > 2 ? [{ kind: 'danger', text: `${late.length} matches haven't started on time (earliest ${late[0].code})`, to: 'matches?f=upcoming' }]
        : late.map(m => ({ kind: 'danger', text: `${m.code} hasn't started (due ${new Date(m.startAt!).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })})`, to: `matches/${m.id}` }))),
      ...db.holds.filter(h => h.tournamentId === t.id && h.playoStatus === 'block_todo').length ? [{ kind: 'money', text: `${db.holds.filter(h => h.tournamentId === t.id && h.playoStatus === 'block_todo').length} court holds still to block on Playo (venue desk)`, to: 'fixtures' }] : [],
    ],
  };
}

function reports(db: DB, t: Tournament) {
  const rs = db.registrations.filter(r => r.tournamentId === t.id), ms = db.matches.filter(m => m.tournamentId === t.id && m.startAt);
  const started = rs.length, submitted = rs.filter(r => r.status !== 'draft').length, paid = rs.filter(r => r.payStatus === 'paid' || r.payStatus === 'waived' || r.status === 'confirmed').length;
  const done = ms.filter(m => m.endedAt && m.startedAt);
  const delays = done.map(m => Math.max(0, (Date.parse(m.startedAt!) - Date.parse(m.startAt!)) / 60000));
  const courtMin = new Map<string, number>(); ms.forEach(m => courtMin.set(m.courtId!, (courtMin.get(m.courtId!) ?? 0) + m.durationMin));
  const days = Math.max(1, (Date.parse(t.endDate) - Date.parse(t.startDate)) / 86400000 + 1);
  const window = (parseInt(t.schedule.dayEnd) - parseInt(t.schedule.dayStart)) * 60 * days;
  return {
    funnel: { started, submitted, paid, confirmed: rs.filter(r => r.status === 'confirmed').length, conversion: started ? paid / started : 0 },
    byCategory: t.categories.map(c => ({ name: c.name, confirmed: rs.filter(r => r.categoryId === c.id && r.status === 'confirmed').length, capacity: c.capacity, withdrawn: rs.filter(r => r.categoryId === c.id && r.status === 'withdrawn').length, revenuePaise: rs.filter(r => r.categoryId === c.id).reduce((a, r) => a + r.paidPaise, 0) })),
    completion: { scheduled: ms.length, completed: ms.filter(m => ['completed', 'walkover'].includes(m.status)).length, abandoned: ms.filter(m => m.status === 'abandoned').length, avgDelayMin: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0, verified: ms.filter(m => m.result?.verification === 'verified').length, unverified: ms.filter(m => m.result && m.result.verification !== 'verified').length },
    courts: [...courtMin].map(([id, min]) => ({ court: db.courts.find(c => c.id === id)?.name ?? id, minutes: min, utilisation: min / window })),
  };
}

function teamSummary(db: DB, t: Tournament) {
  const ms = db.matches.filter(m => m.tournamentId === t.id && m.result);
  return db.registrations.filter(r => r.tournamentId === t.id && r.status === 'confirmed').map(r => {
    const mine = ms.filter(m => m.homeId === r.id || m.awayId === r.id);
    return { regId: r.id, name: r.entryName, played: mine.length, won: mine.filter(m => m.result!.winnerId === r.id).length, unverified: mine.filter(m => m.result!.verification !== 'verified').length,
      scored: mine.reduce((a, m) => a + (m.homeId === r.id ? m.result!.homeScore : m.result!.awayScore), 0), conceded: mine.reduce((a, m) => a + (m.homeId === r.id ? m.result!.awayScore : m.result!.homeScore), 0) };
  }).sort((a, b) => b.won - a.won || b.scored - a.scored);
}

function syncHolds(db: DB, t: Tournament) {
  // One event hold per court per day: first match - 30 min setup → last match end. Changes create Block/Unblock tasks for the venue desk.
  const ms = db.matches.filter(m => m.tournamentId === t.id && m.startAt && m.courtId && m.status !== 'postponed');
  const keyOf = (m: Match) => `${m.courtId}|${m.startAt!.slice(0, 10)}`;
  const groups = new Map<string, Match[]>(); ms.forEach(m => groups.set(keyOf(m), [...(groups.get(keyOf(m)) ?? []), m]));
  const old = db.holds.filter(h => h.tournamentId === t.id);
  const next = [...groups].map(([k, g]) => { const [courtId] = k.split('|'); const s = Math.min(...g.map(m => Date.parse(m.startAt!))) - 30 * 60000, e = Math.max(...g.map(m => Date.parse(m.startAt!) + (m.durationMin + t.schedule.bufferMinutes) * 60000));
    const same = old.find(h => h.courtId === courtId && Date.parse(h.startAt) === s && Date.parse(h.endAt) === e);
    return same ?? { id: uid('h'), tournamentId: t.id, courtId, startAt: new Date(s).toISOString(), endAt: new Date(e).toISOString(), type: 'event' as const, playoStatus: 'block_todo' as const, note: `${t.name} · includes 30 min setup` }; });
  const released = old.filter(h => !next.includes(h)).map(h => ({ ...h, playoStatus: h.playoStatus === 'blocked' ? 'unblock_todo' as const : 'unblocked' as const }));
  db.holds = [...db.holds.filter(h => h.tournamentId !== t.id), ...next, ...released.filter(h => h.playoStatus === 'unblock_todo')];
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

const compiled = [...routes, ...venueRoutes, ...academyRoutes].map(([method, path, h]) => ({ method, keys: [...path.matchAll(/:(\w+)/g)].map(x => x[1]), re: new RegExp('^' + path.replace(/:(\w+)/g, '([^/]+)') + '$'), h }));
export async function handle(method: string, url: string, body: unknown, ctx: Ctx) {
  const [path, qs] = url.split('?'), db = getDB();
  for (const r of compiled) {
    if (r.method !== method) continue; const m = path.match(r.re); if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const snapshot = method === 'GET' ? null : JSON.stringify(db);
    try { const out = r.h(params, body ?? {}, new URLSearchParams(qs), ctx, db); if (method !== 'GET') saveDB(); return JSON.parse(JSON.stringify(out ?? null)); }
    catch (e) { if (snapshot) Object.assign(db, JSON.parse(snapshot)); throw e; } // transactional: roll back on error
  }
  throw new ApiError(404, 'no_route', `${method} ${path} is not implemented`);
}

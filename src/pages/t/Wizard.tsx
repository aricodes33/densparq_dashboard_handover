// Create/edit tournament wizard. 8 steps, autosaves a draft on every step change (PUT /tournaments/:id).
// Validation: one zod schema per step (STEP_SCHEMAS), the same rules the backend enforces on PUT/publish.
import { useEffect, useMemo, useState } from 'react';
import { useForm, useFieldArray, type UseFormReturn } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { z } from 'zod';
import { useTournament, useVenues, useMembers, useChecklist, useAct } from '@/api/hooks';
import { api, ApiError } from '@/api/client';
import { PageHead, can, ORGANIZER } from '@/ui/Page';
import { Btn, Field, Input, Select, Check, Textarea, Banner, Chip, Icon, ErrorState, Loading, toast, human } from '@/ui/kit';
import { SPORT_LABEL, defaultScoring } from '@/domain/scoring';
import { roundRobin } from '@/domain/fixtures';
import { inr } from '@/domain/registration';
import type { Category, Sport, Tournament, TieBreaker, FormatType } from '@/domain/types';

const STEPS = ['Basics', 'Categories', 'Format', 'Scoring & standings', 'Registration', 'Courts & schedule', 'Prizes & staff', 'Review & publish'];
const SPORTS = Object.entries(SPORT_LABEL) as [Sport, string][];
const TB: [TieBreaker, string][] = [['points', 'Points'], ['head_to_head', 'Head-to-head'], ['score_diff', 'Score difference'], ['score_for', 'Score for'], ['wins', 'Wins'], ['fair_play', 'Fair play (cards)'], ['draw_lots', 'Drawing lots']];
const FORMATS: [FormatType, string, string][] = [
  ['knockout', 'Straight knockout', 'Lose once and you are out. Byes go to top seeds.'], ['round_robin', 'Round robin', 'Everyone plays everyone once. Best for 3–8 entries.'],
  ['group_knockout', 'Groups + knockout', 'Groups play round robin; the top finishers go to a bracket.'], ['league', 'League', 'A long round robin, usually over several days, optionally home and away.'],
  ['custom', 'Custom format', 'Add matches by hand. Results are entered manually (e.g. new formats being trialled).'],
];

// IST <-> datetime-local
const toLocal = (iso?: string) => (iso ? new Date(Date.parse(iso) + 330 * 60000).toISOString().slice(0, 16) : '');
const toIso = (l: string) => (l ? new Date(`${l}:00+05:30`).toISOString() : '');

type Form = Omit<Tournament, 'regOpensAt' | 'regClosesAt' | 'rosterCutoffAt'> & { regOpensAt: string; regClosesAt: string; rosterCutoffAt: string };
const rupees = z.coerce.number().min(0, 'Can’t be negative');
const STEP_SCHEMAS: z.ZodTypeAny[] = [
  z.object({ name: z.string().trim().min(3, 'Give the tournament a name (3+ characters)'), sport: z.string(), startDate: z.string().min(1, 'Pick a start date'), endDate: z.string().min(1, 'Pick an end date'),
    contact: z.object({ name: z.string().min(1, 'Who should players contact?'), phone: z.string().regex(/^\d{10}$/, '10-digit mobile number'), email: z.string().email('Enter a valid email') }) })
    .refine(v => v.endDate >= v.startDate, { path: ['endDate'], message: 'Ends before it starts' }),
  z.object({ categories: z.array(z.object({ name: z.string().min(1, 'Name the category'), capacity: z.coerce.number().int().min(2, 'At least 2 entries'), feePaise: rupees,
    minAge: z.coerce.number().optional().or(z.nan()), maxAge: z.coerce.number().optional().or(z.nan()), rosterMin: z.coerce.number().int().min(1), rosterMax: z.coerce.number().int().min(1) })
    .refine(c => c.rosterMax >= c.rosterMin, { path: ['rosterMax'], message: 'Max is below min' })
    .refine(c => !(c.minAge && c.maxAge) || c.maxAge >= c.minAge, { path: ['maxAge'], message: 'Max age is below min age' })).min(1, 'Add at least one category') }),
  z.object({ categories: z.array(z.object({ capacity: z.coerce.number(), format: z.object({ type: z.string(), groups: z.coerce.number().int(), qualifiersPerGroup: z.coerce.number().int() }) })
    .refine(c => c.format.type !== 'group_knockout' || (c.format.groups >= 2 && c.format.groups * 2 <= c.capacity), { path: ['format', 'groups'], message: 'Need 2+ groups with at least 2 entries each' })
    .refine(c => c.format.type !== 'group_knockout' || c.format.qualifiersPerGroup * c.format.groups >= 2, { path: ['format', 'qualifiersPerGroup'], message: 'At least 2 must go through' })) }),
  z.object({ scoring: z.object({ tieBreakers: z.array(z.string()).min(1, 'Pick at least one tie-breaker'), points: z.object({ win: z.coerce.number().min(0), draw: z.coerce.number().min(0), loss: z.coerce.number() }) }) }),
  z.object({ regOpensAt: z.string().min(1, 'When does registration open?'), regClosesAt: z.string().min(1, 'When does it close?'), rosterCutoffAt: z.string().min(1, 'Set a roster cutoff'), startDate: z.string() })
    .refine(v => v.regClosesAt > v.regOpensAt, { path: ['regClosesAt'], message: 'Closes before it opens' })
    .refine(v => v.regClosesAt.slice(0, 10) <= v.startDate, { path: ['regClosesAt'], message: 'Must close on or before the first day of play' })
    .refine(v => v.rosterCutoffAt >= v.regClosesAt || true, { path: ['rosterCutoffAt'], message: '' }),
  z.object({ courtIds: z.array(z.string()), venueText: z.string().optional(), venueId: z.string().nullable(), schedule: z.object({ matchMinutes: z.coerce.number().min(5, 'At least 5 minutes'), bufferMinutes: z.coerce.number().min(0), minRestMinutes: z.coerce.number().min(0), dayStart: z.string(), dayEnd: z.string() }).refine(s => s.dayEnd > s.dayStart, { path: ['dayEnd'], message: 'Day ends before it starts' }) })
    .refine(v => v.courtIds.length > 0 || !!v.venueText, { path: ['courtIds'], message: 'Pick at least one court (or type the venue for an external ground)' }),
  z.object({}), z.object({}),
];

export function Wizard() {
  const { org = 'densparq', tid } = useParams(); const nav = useNavigate();
  const [sp, setSp] = useSearchParams(); const step = Math.min(7, Math.max(0, Number(sp.get('step') ?? 1) - 1));
  const t = useTournament(tid);
  if (tid && t.isLoading) return <Loading />;
  if (tid && t.error) return <ErrorState error={t.error} />;
  if (!can(ORGANIZER)) return <ErrorState error={{ status: 403, message: 'Only organizers can change setup' }} />;
  return <WizardForm key={tid ?? 'new'} org={org} t={t.data} step={step} setStep={s => setSp({ step: String(s + 1) })} onCreated={id => nav(`/o/${org}/t/${id}/setup?step=2`, { replace: true })} />;
}

function WizardForm({ org, t, step, setStep, onCreated }: { org: string; t?: Tournament; step: number; setStep: (s: number) => void; onCreated: (id: string) => void }) {
  const defaults: Form = useMemo(() => {
    const base = t ?? { name: '', sport: 'badminton' as Sport, startDate: '', endDate: '', contact: { name: '', phone: '', email: '' }, description: '', categories: [], prizes: [], courtIds: [], venueId: 'v_kannuru', venueText: '', staff: [],
      schedule: { matchMinutes: 30, bufferMinutes: 10, minRestMinutes: 20, dayStart: '07:00', dayEnd: '22:00', createVenueHolds: true },
      registration: { requiredDocs: [], guardianConsentUnder: 18, waitlist: true, allowLate: false, refundPolicy: 'full_until_close', refundPercent: 80, duplicateCheck: 'phone' }, scoring: defaultScoring('badminton') } as unknown as Tournament;
    return { ...base, regOpensAt: toLocal(base.regOpensAt), regClosesAt: toLocal(base.regClosesAt), rosterCutoffAt: toLocal(base.rosterCutoffAt),
      categories: base.categories.map(c => ({ ...c, feePaise: c.feePaise / 100 })) } as Form;
  }, [t]);
  const form = useForm<Form>({ defaultValues: defaults });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [visited, setVisited] = useState<Set<number>>(new Set(t ? [0, 1, 2, 3, 4, 5, 6] : []));
  const save = useAct((b: Partial<Tournament>) => t ? api.put<Tournament>(`/tournaments/${t.id}`, b) : api.post<Tournament>(`/orgs/${org}/tournaments`, b));

  const payload = (): Partial<Tournament> => { const v = form.getValues(); return { ...v, regOpensAt: toIso(v.regOpensAt), regClosesAt: toIso(v.regClosesAt), rosterCutoffAt: toIso(v.rosterCutoffAt),
    categories: v.categories.map(c => ({ ...c, feePaise: Math.round(Number(c.feePaise) * 100), capacity: +c.capacity, rosterMin: +c.rosterMin, rosterMax: +c.rosterMax, minAge: c.minAge ? +c.minAge : undefined, maxAge: c.maxAge ? +c.maxAge : undefined,
      format: { ...c.format, groups: +c.format.groups, qualifiersPerGroup: +c.format.qualifiersPerGroup, legs: +c.format.legs as 1 | 2 } })) }; };
  const validate = (i: number) => {
    const r = STEP_SCHEMAS[i].safeParse(form.getValues()); if (r.success) { setErrors({}); return true; }
    const e: Record<string, string> = {}; r.error.issues.forEach(x => { const k = x.path.join('.'); if (!e[k] && x.message) e[k] = x.message; }); setErrors(e);
    setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 30); return !Object.keys(e).length;
  };
  const go = async (to: number, check = to > step) => {
    if (check && !validate(step)) { toast('Fix the highlighted fields first', 'danger'); return; }
    setVisited(v => new Set(v).add(step));
    try { const r = await save.mutateAsync(payload()); if (!t) { toast('Draft created'); onCreated(r.id); return; } toast('Draft saved'); } catch { return; }
    setStep(to); window.scrollTo({ top: 0 });
  };
  const stepBad = (i: number) => visited.has(i) && !STEP_SCHEMAS[i].safeParse(form.getValues()).success;
  const P = { form, errors };
  return <>
    <PageHead title={t ? `Setup · ${t.name}` : 'New tournament'} sub={t ? 'Changes save as you move between steps. Published tournaments update right away; formats lock once fixtures are published.' : 'Start with the basics. You can save and come back any time.'} />
    <div className="wiz">
      <nav aria-label="Setup steps" className="steps">{STEPS.map((s, i) => <button key={s} type="button" className={`step ${visited.has(i) && !stepBad(i) ? 'done' : ''} ${stepBad(i) ? 'bad' : ''}`} aria-current={i === step ? 'step' : undefined} disabled={!t && i > 0} onClick={() => go(i, false)}>
        <span className="n">{stepBad(i) ? '!' : visited.has(i) && i !== step ? <Icon name="check" size={13} /> : i + 1}</span><span>{s}</span></button>)}</nav>
      <form className="col loose" onSubmit={e => { e.preventDefault(); if (step < 7) go(step + 1); }} noValidate>
        <h2>{step + 1}. {STEPS[step]}</h2>
        {step === 0 && <Basics {...P} />}{step === 1 && <Categories {...P} />}{step === 2 && <Formats {...P} />}{step === 3 && <Scoring {...P} />}
        {step === 4 && <RegistrationStep {...P} />}{step === 5 && <Courts {...P} org={org} />}{step === 6 && <Prizes {...P} org={org} />}{step === 7 && t && <Review t={t} org={org} goto={setStep} />}
        <div className="wiz-foot"><Btn onClick={() => go(Math.max(0, step - 1), false)} disabled={step === 0} icon="back">Back</Btn>
          <div className="row tight">{step < 7 && <><Btn kind="ghost" onClick={() => go(step, false)} loading={save.isPending && false}>Save draft</Btn><Btn kind="primary" type="submit" loading={save.isPending}>{t ? 'Save & continue' : 'Create draft & continue'}</Btn></>}</div></div>
      </form>
    </div>
  </>;
}

type SP = { form: UseFormReturn<Form>; errors: Record<string, string> };

function Basics({ form: { register, watch, setValue }, errors }: SP) {
  const sport = watch('sport');
  return <div className="col loose">
    <Field label="Tournament name" error={errors.name}>{p => <Input {...p} {...register('name')} placeholder="e.g. Kannuru Smash Open" />}</Field>
    <fieldset className="col"><legend className="label">Sport</legend><div className="grid g3" style={{ gap: 10 }}>{SPORTS.map(([v, l]) => <label key={v} className="radio-card"><input type="radio" value={v} checked={sport === v} onChange={() => { setValue('sport', v); setValue('scoring', defaultScoring(v)); }} /><span className="bold">{l}</span></label>)}</div>
      <span className="hint small muted">Changing the sport resets scoring to that sport's defaults (step 4).</span></fieldset>
    <div className="grid g2"><Field label="First day of play" error={errors.startDate}>{p => <Input {...p} type="date" {...register('startDate')} />}</Field><Field label="Last day of play" error={errors.endDate}>{p => <Input {...p} type="date" {...register('endDate')} />}</Field></div>
    <Field label="Description" hint="Shown on the public page. What is it, who is it for, what makes it special?">{p => <Textarea {...p} rows={3} {...register('description')} />}</Field>
    <fieldset className="col"><legend className="label">Contact for players</legend><div className="grid g3">
      <Field label="Name" error={errors['contact.name']}>{p => <Input {...p} {...register('contact.name')} />}</Field>
      <Field label="Mobile" error={errors['contact.phone']}>{p => <Input {...p} inputMode="numeric" {...register('contact.phone')} />}</Field>
      <Field label="Email" error={errors['contact.email']}>{p => <Input {...p} type="email" {...register('contact.email')} />}</Field></div></fieldset>
  </div>;
}

const newCat = (sport: Sport): Category => ({ id: '', tournamentId: '', name: '', eventType: ['football', 'box_cricket', 'frisbee', 'lagori'].includes(sport) ? 'team' : 'singles', gender: 'open', skill: 'any', capacity: 16, feePaise: 500 as unknown as number, rosterMin: ['football', 'box_cricket', 'frisbee', 'lagori'].includes(sport) ? 7 : 1, rosterMax: ['football', 'box_cricket', 'frisbee', 'lagori'].includes(sport) ? 12 : 2,
  format: { type: 'knockout', groups: 2, qualifiersPerGroup: 2, legs: 1, seeding: 'random', thirdPlace: false } });

function Categories({ form: { register, control, watch }, errors }: SP) {
  const { fields, append, remove } = useFieldArray({ control, name: 'categories' }); const sport = watch('sport');
  return <div className="col loose">
    <p className="muted" style={{ margin: 0 }}>A category is one competition inside the tournament, such as Men's singles or Under-15. Each has its own capacity, fee, eligibility and format.</p>
    {errors.categories && <Banner tone="danger">{errors.categories}</Banner>}
    {fields.map((f, i) => { const type = watch(`categories.${i}.eventType`); const e = (k: string) => errors[`categories.${i}.${k}`];
      return <fieldset key={f.id} className="card col"><div className="row between"><legend className="display bold" style={{ fontSize: 17 }}>Category {i + 1}</legend><Btn size="sm" kind="ghost" icon="x" onClick={() => remove(i)} aria-label={`Remove category ${i + 1}`}>Remove</Btn></div>
        <div className="grid g3">
          <Field label="Name" error={e('name')}>{p => <Input {...p} {...register(`categories.${i}.name`)} placeholder="Men's singles" />}</Field>
          <Field label="Entry type">{p => <Select {...p} {...register(`categories.${i}.eventType`)} options={[['singles', 'Singles'], ['doubles', 'Doubles / pairs'], ['team', 'Team']]} />}</Field>
          <Field label="Gender">{p => <Select {...p} {...register(`categories.${i}.gender`)} options={[['open', 'Open'], ['men', 'Men'], ['women', 'Women'], ['mixed', 'Mixed']]} />}</Field>
          <Field label="Max entries" hint="Extra entries join the waitlist" error={e('capacity')}>{p => <Input {...p} type="number" min={2} {...register(`categories.${i}.capacity`)} />}</Field>
          <Field label="Entry fee (₹ per entry)" hint="0 for free entry" error={e('feePaise')}>{p => <Input {...p} type="number" min={0} {...register(`categories.${i}.feePaise`)} />}</Field>
          <Field label="Skill level">{p => <Select {...p} {...register(`categories.${i}.skill`)} options={[['any', 'Any'], ['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']]} />}</Field>
          <Field label="Min age (optional)" hint="Age on the first day of play">{p => <Input {...p} type="number" {...register(`categories.${i}.minAge`)} />}</Field>
          <Field label="Max age (optional)" error={e('maxAge')}>{p => <Input {...p} type="number" {...register(`categories.${i}.maxAge`)} />}</Field>
          {type === 'team' && <><Field label="Min roster" error={e('rosterMin')}>{p => <Input {...p} type="number" min={1} {...register(`categories.${i}.rosterMin`)} />}</Field><Field label="Max roster" error={e('rosterMax')}>{p => <Input {...p} type="number" {...register(`categories.${i}.rosterMax`)} />}</Field></>}
        </div></fieldset>; })}
    <Btn icon="plus" onClick={() => append(newCat(sport))} className="" >Add category</Btn>
  </div>;
}

function matchCount(type: FormatType, n: number, groups: number, q: number, legs: number) {
  if (n < 2) return 0;
  if (type === 'knockout') return n - 1;
  if (type === 'round_robin' || type === 'league') return roundRobin(Array.from({ length: n }, (_, i) => i), legs as 1 | 2).flat().length;
  if (type === 'group_knockout') { const per = Math.ceil(n / groups); return groups * (per * (per - 1) / 2) * legs + Math.max(0, groups * q - 1); }
  return 0;
}
function Formats({ form: { register, watch }, errors }: SP) {
  const cats = watch('categories');
  if (!cats.length) return <Banner tone="money">Add a category first (step 2).</Banner>;
  return <div className="col loose">{cats.map((c, i) => { const f = c.format; const n = Number(c.capacity) || 0;
    return <fieldset key={i} className="card col"><legend className="display bold" style={{ fontSize: 17 }}>{c.name || `Category ${i + 1}`}</legend>
      <div className="grid g2" style={{ gap: 10 }}>{FORMATS.map(([v, l, d]) => <label key={v} className="radio-card"><input type="radio" value={v} {...register(`categories.${i}.format.type`)} /><span className="col tight"><span className="bold">{l}</span><span className="small muted">{d}</span></span></label>)}</div>
      {f.type === 'group_knockout' && <div className="grid g3"><Field label="Number of groups" error={errors[`categories.${i}.format.groups`]}>{p => <Input {...p} type="number" min={2} {...register(`categories.${i}.format.groups`)} />}</Field><Field label="Go through from each group" error={errors[`categories.${i}.format.qualifiersPerGroup`]}>{p => <Input {...p} type="number" min={1} {...register(`categories.${i}.format.qualifiersPerGroup`)} />}</Field></div>}
      {(f.type === 'league' || f.type === 'round_robin' || f.type === 'group_knockout') && <Field label="Times each pair meets">{p => <Select {...p} {...register(`categories.${i}.format.legs`)} options={[['1', 'Once'], ['2', 'Twice (home & away)']]} />}</Field>}
      {f.type !== 'custom' && <div className="row"><Field label="Draw">{p => <Select {...p} {...register(`categories.${i}.format.seeding`)} options={[['random', 'Random draw'], ['seeded', 'Seeded (set seeds in Registrations)']]} />}</Field>{(f.type === 'knockout' || f.type === 'group_knockout') && <Check label="Third-place match" {...register(`categories.${i}.format.thirdPlace`)} />}</div>}
      {f.type === 'custom' ? <Banner tone="info" icon="rules">Custom formats are not generated automatically. Add matches by hand in Fixtures. Results are entered manually and standings use the points below.</Banner>
        : <Banner tone="good" icon="cal">At full capacity ({n} entries): about <strong>{matchCount(f.type, n, +f.groups || 1, +f.qualifiersPerGroup || 1, +f.legs || 1)} matches</strong>.</Banner>}
    </fieldset>; })}</div>;
}

function Scoring({ form: { register, watch, setValue, control }, errors }: SP) {
  const sport = watch('sport'), tbs = watch('scoring.tieBreakers'), auto = watch('scoring.autoScoring');
  const lag = useFieldArray({ control, name: 'scoring.lagori.actions' as 'scoring.lagori.actions' });
  const move = (i: number, d: number) => { const a = [...tbs]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setValue('scoring.tieBreakers', a); };
  return <div className="col loose">
    <Banner tone="info" icon="shield">This is the <strong>machine-readable</strong> setup that computes scores and standings. It is separate from the written rules (Rules tab), so write the same thing there in words for players.</Banner>
    <Check label="Live scoring with the sport's scoring pad" hint="Turn off to enter final scores by hand only (for formats the pad doesn't support yet)." {...register('scoring.autoScoring')} />
    <fieldset className="card col"><legend className="display bold">Points in tables</legend><div className="grid g4">
      {(['win', 'draw', 'loss', 'walkoverWin', 'walkoverLoss'] as const).map(k => <Field key={k} label={human(k.replace('walkover', 'walkover_'))} error={errors[`scoring.points.${k}`]}>{p => <Input {...p} type="number" {...register(`scoring.points.${k}`)} />}</Field>)}</div></fieldset>
    <fieldset className="card col"><legend className="display bold">Tie-breakers, in order</legend>
      {errors['scoring.tieBreakers'] && <span className="err small">{errors['scoring.tieBreakers']}</span>}
      <ol className="col tight" style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>{tbs.map((x, i) => <li key={x} className="row between card flat" style={{ padding: '8px 12px' }}><span className="row tight"><span className="tag">{i + 1}</span><span className="bold">{TB.find(t => t[0] === x)?.[1]}</span></span>
        <span className="row tight"><Btn size="sm" kind="ghost" aria-label={`Move ${x} up`} onClick={() => move(i, -1)} disabled={i === 0}>↑</Btn><Btn size="sm" kind="ghost" aria-label={`Move ${x} down`} onClick={() => move(i, 1)} disabled={i === tbs.length - 1}>↓</Btn><Btn size="sm" kind="ghost" aria-label={`Remove ${x}`} icon="x" onClick={() => setValue('scoring.tieBreakers', tbs.filter(t => t !== x))} /></span></li>)}</ol>
      <div className="row tight">{TB.filter(([v]) => !tbs.includes(v)).map(([v, l]) => <Btn key={v} size="sm" icon="plus" onClick={() => setValue('scoring.tieBreakers', [...tbs, v])}>{l}</Btn>)}</div></fieldset>
    {auto && <fieldset className="card col"><legend className="display bold">{SPORT_LABEL[sport]} scoring</legend>
      {(sport === 'badminton' || sport === 'pickleball') && <div className="grid g3"><Field label="Points to win a game">{p => <Input {...p} type="number" {...register('scoring.rally.pointsToWin')} />}</Field><Field label="Point cap" hint="Game ends here even without a 2-point lead">{p => <Input {...p} type="number" {...register('scoring.rally.cap')} />}</Field><Field label="Best of">{p => <Select {...p} {...register('scoring.rally.bestOf')} options={[['1', '1 game'], ['3', '3 games'], ['5', '5 games']]} />}</Field></div>}
      {sport === 'football' && <div className="grid g3"><Field label="Minutes per half">{p => <Input {...p} type="number" {...register('scoring.football.halfMinutes')} />}</Field><Field label="Extra time per half (knockout)">{p => <Input {...p} type="number" {...register('scoring.football.extraTimeMinutes')} />}</Field><Field label="Players on pitch">{p => <Input {...p} type="number" {...register('scoring.football.squadOnPitch')} />}</Field><Check label="Penalty shoot-out if still level" {...register('scoring.football.penalties')} /></div>}
      {sport === 'box_cricket' && <div className="grid g3"><Field label="Overs per side">{p => <Input {...p} type="number" {...register('scoring.cricket.overs')} />}</Field><Field label="Balls per over">{p => <Input {...p} type="number" {...register('scoring.cricket.ballsPerOver')} />}</Field><Field label="Players per side">{p => <Input {...p} type="number" {...register('scoring.cricket.playersPerSide')} />}</Field></div>}
      {sport === 'frisbee' && <div className="grid g3"><Field label="Game to">{p => <Input {...p} type="number" {...register('scoring.frisbee.pointsToWin')} />}</Field><Field label="Hard cap">{p => <Input {...p} type="number" {...register('scoring.frisbee.cap')} />}</Field><Field label="Half-time at">{p => <Input {...p} type="number" {...register('scoring.frisbee.halftimeAt')} />}</Field><Field label="Timeouts per half">{p => <Input {...p} type="number" {...register('scoring.frisbee.timeoutsPerHalf')} />}</Field><Check label="Spirit of the Game scores (0–20)" {...register('scoring.frisbee.spiritScoring')} /></div>}
      {sport === 'lagori' && <><div className="grid g3"><Field label="Rounds">{p => <Input {...p} type="number" {...register('scoring.lagori.rounds')} />}</Field><Field label="Seconds per round">{p => <Input {...p} type="number" {...register('scoring.lagori.roundSeconds')} />}</Field></div>
        <span className="label">Scoring actions (the referee taps these)</span>
        {lag.fields.map((f, i) => <div key={f.id} className="row nowrap"><Field label="Label">{p => <Input {...p} {...register(`scoring.lagori.actions.${i}.label` as const)} />}</Field><Field label="Points">{p => <Input {...p} type="number" style={{ width: 90 }} {...register(`scoring.lagori.actions.${i}.points` as const)} />}</Field>
          <Field label="Goes to">{p => <Select {...p} {...register(`scoring.lagori.actions.${i}.side` as const)} options={[['self', 'Team that did it'], ['opponent', 'Opponent']]} />}</Field><Btn kind="ghost" icon="x" aria-label="Remove action" onClick={() => lag.remove(i)} style={{ marginTop: 22 }} /></div>)}
        <Btn size="sm" icon="plus" onClick={() => lag.append({ key: `a${Date.now()}`, label: '', points: 1, side: 'self' })}>Add action</Btn></>}
    </fieldset>}
  </div>;
}

function RegistrationStep({ form: { register, watch }, errors }: SP) {
  const pol = watch('registration.refundPolicy'), docs = watch('registration.requiredDocs');
  return <div className="col loose">
    <div className="grid g3"><Field label="Registration opens" error={errors.regOpensAt}>{p => <Input {...p} type="datetime-local" {...register('regOpensAt')} />}</Field><Field label="Registration closes" error={errors.regClosesAt}>{p => <Input {...p} type="datetime-local" {...register('regClosesAt')} />}</Field>
      <Field label="Roster edits allowed until" hint="Captains can change players until then" error={errors.rosterCutoffAt}>{p => <Input {...p} type="datetime-local" {...register('rosterCutoffAt')} />}</Field></div>
    <fieldset className="card col"><legend className="display bold">What entrants must provide</legend>
      {([['id_proof', 'Photo ID'], ['age_proof', 'Age proof (birth certificate / school ID)'], ['institution_id', 'College or company ID']] as const).map(([v, l]) => <Check key={v} label={l} value={v} {...register('registration.requiredDocs')} defaultChecked={docs?.includes(v)} />)}
      <Field label="Guardian consent required under age" hint="Under-18 entries need a parent or guardian to consent (DPDP Act). Their stats stay private by default.">{p => <Input {...p} type="number" style={{ maxWidth: 120 }} {...register('registration.guardianConsentUnder')} />}</Field>
    </fieldset>
    <fieldset className="card col"><legend className="display bold">Capacity & duplicates</legend>
      <Check label="Waitlist when a category is full" hint="When someone withdraws, the first waitlisted entry is offered the place automatically." {...register('registration.waitlist')} />
      <Check label="Allow late entries (organizer only)" {...register('registration.allowLate')} />
      <Field label="Block duplicate entries by">{p => <Select {...p} {...register('registration.duplicateCheck')} options={[['phone', 'Captain phone number (per category)'], ['player_id', 'Densparq player ID'], ['none', 'Don’t check']]} />}</Field></fieldset>
    <fieldset className="card col"><legend className="display bold">Refunds</legend>
      <Field label="Refund policy">{p => <Select {...p} {...register('registration.refundPolicy')} options={[['full_until_close', 'Full refund until registration closes'], ['percent_until_close', 'Part refund until registration closes'], ['none', 'No refunds']]} />}</Field>
      {pol === 'percent_until_close' && <Field label="Refund %">{p => <Input {...p} type="number" min={0} max={100} style={{ maxWidth: 120 }} {...register('registration.refundPercent')} />}</Field>}
      <span className="small muted">Organizers can always approve exceptions with a reason (audited). Payments are collected through Razorpay (UPI, cards, netbanking).</span></fieldset>
  </div>;
}

function Courts({ form: { register, watch, setValue }, errors, org }: SP & { org: string }) {
  const venues = useVenues(org); const vId = watch('venueId'), sport = watch('sport'), courtIds = watch('courtIds') ?? [];
  const v = venues.data?.find(x => x.id === vId);
  return <div className="col loose">
    <Field label="Venue">{p => <Select {...p} value={vId ?? ''} onChange={e => { setValue('venueId', e.target.value || null); setValue('courtIds', []); }} options={[...(venues.data ?? []).map(x => [x.id, x.name] as [string, string]), ['', 'Somewhere else (type it)']]} />}</Field>
    {!vId && <Field label="Venue name and address">{p => <Input {...p} {...register('venueText')} />}</Field>}
    {v && <fieldset className="col"><legend className="label">Courts to use</legend>{errors.courtIds && <span className="err small">{errors.courtIds}</span>}
      <div className="grid g4" style={{ gap: 10 }}>{v.courts.map(c => { const fits = c.sports.includes(sport); return <label key={c.id} className="radio-card" style={{ opacity: fits ? 1 : .55 }}><input type="checkbox" checked={courtIds.includes(c.id)} onChange={e => setValue('courtIds', e.target.checked ? [...courtIds, c.id] : courtIds.filter(x => x !== c.id))} />
        <span className="col tight"><span className="bold">{c.name}</span><span className="xs muted">{fits ? 'Suits this sport' : `Not set up for ${SPORT_LABEL[sport]}`}</span></span></label>; })}</div></fieldset>}
    <div className="grid g3">
      <Field label="Match length (minutes)" error={errors['schedule.matchMinutes']}>{p => <Input {...p} type="number" {...register('schedule.matchMinutes')} />}</Field>
      <Field label="Buffer between matches" hint="Changeover on the same court">{p => <Input {...p} type="number" {...register('schedule.bufferMinutes')} />}</Field>
      <Field label="Minimum rest for an entry" hint="Between two matches of the same team">{p => <Input {...p} type="number" {...register('schedule.minRestMinutes')} />}</Field>
      <Field label="Play starts each day">{p => <Input {...p} type="time" {...register('schedule.dayStart')} />}</Field>
      <Field label="Play ends each day" error={errors['schedule.dayEnd']}>{p => <Input {...p} type="time" {...register('schedule.dayEnd')} />}</Field></div>
    {v?.isDensparq && <div className="card flat col"><Check label="Hold these courts on the Densparq venue calendar" hint="When fixtures are published, each court gets an event hold (first match − 30 min setup → last match). The venue desk gets a 'Block on Playo' task for each. The scheduler skips the academy hold (3–6 pm) and existing bookings." {...register('schedule.createVenueHolds')} /></div>}
  </div>;
}

function Prizes({ form: { register, control }, org }: SP & { org: string }) {
  const { fields, append, remove } = useFieldArray({ control, name: 'prizes' }); const members = useMembers(org);
  const st = useFieldArray({ control, name: 'staff' });
  return <div className="col loose">
    <fieldset className="card col"><legend className="display bold">Prizes</legend>
      {fields.map((f, i) => <div key={f.id} className="row nowrap"><Field label="Place">{p => <Input {...p} {...register(`prizes.${i}.place`)} />}</Field><Field label="What they win">{p => <Input {...p} {...register(`prizes.${i}.description`)} />}</Field><Btn kind="ghost" icon="x" aria-label="Remove prize" onClick={() => remove(i)} style={{ marginTop: 22 }} /></div>)}
      <Btn size="sm" icon="plus" onClick={() => append({ place: fields.length ? `Place ${fields.length + 1}` : 'Winner', description: '' })}>Add prize</Btn></fieldset>
    <fieldset className="card col"><legend className="display bold">Tournament staff</legend>
      <span className="small muted">Organizers of your organization always have access. Add referees here; assign them to matches in Fixtures.</span>
      {st.fields.map((f, i) => <div key={f.id} className="row nowrap"><Field label="Person">{p => <Select {...p} {...register(`staff.${i}.userId`)} options={(members.data ?? []).map(m => [m.userId, m.user?.name ?? m.userId])} />}</Field>
        <Field label="Role">{p => <Select {...p} {...register(`staff.${i}.role`)} options={[['referee', 'Referee / scorekeeper'], ['registration_manager', 'Registration manager']]} />}</Field><Btn kind="ghost" icon="x" aria-label="Remove" onClick={() => st.remove(i)} style={{ marginTop: 22 }} /></div>)}
      <Btn size="sm" icon="plus" onClick={() => st.append({ userId: members.data?.[0]?.userId ?? '', role: 'referee' })}>Add staff</Btn></fieldset>
  </div>;
}

function Review({ t, org, goto }: { t: Tournament; org: string; goto: (s: number) => void }) {
  const c = useChecklist(t.id); const nav = useNavigate();
  const publish = useAct(() => api.post(`/tournaments/${t.id}/publish`), 'Published. Registration opens on schedule.');
  const unpublish = useAct(() => api.post(`/tournaments/${t.id}/unpublish`, { reason: 'Organizer unpublished' }), 'Unpublished. The public page is hidden.');
  const ready = c.data?.every(x => x.ok);
  return <div className="col loose">
    <div className="card col"><h3>Before you publish</h3>
      {c.isLoading ? <Loading rows={3} /> : c.data!.map(x => <div key={x.id} className="row between" style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}><span className="row tight"><Chip tone={x.ok ? 'good' : 'danger'}>{x.ok ? 'Done' : 'To do'}</Chip>{x.label}</span>
        {!x.ok && (x.step === 0 ? <Link className="btn sm" to={`/o/${org}/t/${t.id}/rules`}>Open rules</Link> : <Btn size="sm" onClick={() => goto(x.step - 1)}>Fix</Btn>)}</div>)}</div>
    <div className="grid g3">{t.categories.map(cat => <div key={cat.id} className="card flat col tight"><span className="bold">{cat.name}</span><span className="small muted">{human(cat.eventType)} · up to {cat.capacity} · {cat.feePaise ? inr(cat.feePaise) : 'Free'}</span><span className="small">{FORMATS.find(f => f[0] === cat.format.type)?.[1]}</span></div>)}</div>
    {t.status === 'published' ? <Banner tone="good" icon="check" action={<Btn kind="danger" onClick={() => unpublish.mutate(undefined)} loading={unpublish.isPending}>Unpublish</Btn>}>This tournament is live. <a href={`#/t/${t.slug}`} target="_blank" rel="noreferrer">See the public page ↗</a></Banner>
      : <div className="row"><Btn kind="lime" size="lg" icon="globe" disabled={!ready} loading={publish.isPending} onClick={() => publish.mutate(undefined, { onSuccess: () => nav(`/o/${org}/t/${t.id}`), onError: (e: ApiError) => void e })}>Publish tournament</Btn>{!ready && <span className="small muted">Finish the to-do items to publish.</span>}</div>}
  </div>;
}

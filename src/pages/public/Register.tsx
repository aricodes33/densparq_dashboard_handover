// Participant registration: category -> players (+guardian consent) -> documents -> accept rules vN -> pay (Razorpay) -> receipt.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePublicT, useAct } from '@/api/hooks';
import { api, ApiError } from '@/api/client';
import { Banner, Btn, Check, Chip, ErrorState, Field, Input, Loading, Select, Icon, fmtDate, toast, Status, fmtDT } from '@/ui/kit';
import { ageOn, inr, type EligibilityIssue } from '@/domain/registration';
import type { Category, Player } from '@/domain/types';

type P = Omit<Player, 'id' | 'statsVisibility'> & { id: string; guardianConsent: boolean };
const blank = (): P => ({ id: '', name: '', phone: '', dob: '', gender: 'm', guardianConsent: false, guardian: { name: '', phone: '', relation: 'Parent' } });
const STEPS = ['Category', 'Players', 'Documents', 'Rules', 'Pay'];

export function Register() {
  const { slug = '' } = useParams(); const t = usePublicT(slug); const nav = useNavigate();
  const [step, setStep] = useState(0); const [catId, setCatId] = useState(''); const [team, setTeam] = useState(''); const [players, setPlayers] = useState<P[]>([blank()]);
  const [docs, setDocs] = useState<Record<string, string>>({}); const [ack, setAck] = useState(false); const [readAll, setReadAll] = useState(false);
  const [issues, setIssues] = useState<EligibilityIssue[]>([]); const [errs, setErrs] = useState<Record<string, string>>({});
  const [regId, setRegId] = useState<string | null>(null); const [method, setMethod] = useState('upi'); const [failNext, setFailNext] = useState(false);
  const rulesRef = useRef<HTMLDivElement>(null);
  const create = useAct((b: object) => api.post<{ id: string; status: string }>(`/tournaments/${t.data?.id}/registrations`, b));
  const pay = useAct((b: object) => api.post(`/registrations/${regId}/payments`, b));
  useEffect(() => { const el = rulesRef.current; if (el && el.scrollHeight <= el.clientHeight + 4) setReadAll(true); }, [step]);
  if (t.isLoading) return <div className="pub"><Loading /></div>; if (t.error) return <div className="pub"><ErrorState error={t.error} /></div>;
  const x = t.data, cat: (Category & { taken: number }) | undefined = x.categories.find((c: Category) => c.id === catId);
  const size = !cat ? 1 : cat.eventType === 'singles' ? 1 : cat.eventType === 'doubles' ? 2 : cat.rosterMin;
  const needDocs = x.registration.requiredDocs as string[], u = x.registration.guardianConsentUnder as number;
  const steps = STEPS.filter(s => s !== 'Documents' || needDocs.length);
  const cur = steps[step];
  const full = cat && cat.taken >= cat.capacity;

  const toPlayers = (): Player[] => players.map(p => ({ id: p.id, name: p.name.trim(), phone: p.phone, dob: p.dob, gender: p.gender, statsVisibility: ageOn(p.dob, x.startDate) < u ? 'private' : 'public',
    guardian: ageOn(p.dob, x.startDate) < u ? { ...p.guardian!, consentAt: p.guardianConsent ? new Date().toISOString() : undefined } : undefined }));
  const checkPlayers = async () => {
    const e: Record<string, string> = {};
    players.forEach((p, i) => { if (!p.name.trim()) e[`${i}.name`] = 'Enter a name'; if (!/^\d{10}$/.test(p.phone)) e[`${i}.phone`] = '10-digit mobile'; if (!p.dob) e[`${i}.dob`] = 'Date of birth is needed for age rules';
      if (p.dob && ageOn(p.dob, x.startDate) < u) { if (!p.guardian?.name) e[`${i}.gname`] = 'Guardian name'; if (!/^\d{10}$/.test(p.guardian?.phone ?? '')) e[`${i}.gphone`] = 'Guardian mobile'; if (!p.guardianConsent) e[`${i}.consent`] = 'A guardian must consent'; } });
    if (cat?.eventType === 'team' && !team.trim()) e.team = 'Name your team';
    setErrs(e); if (Object.keys(e).length) { setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 20); return false; }
    const r = await api.post<EligibilityIssue[]>(`/tournaments/${x.id}/registrations/validate`, { categoryId: catId, players: toPlayers(), captainPhone: players[0].phone }); setIssues(r);
    return !r.some(i => i.blocking);
  };
  const next = async () => {
    if (cur === 'Category' && !catId) { setErrs({ cat: 'Pick a category' }); return; }
    if (cur === 'Players' && !(await checkPlayers())) return;
    if (cur === 'Documents' && needDocs.some(d => !docs[d])) { setErrs({ docs: 'Upload every required document' }); return; }
    if (cur === 'Rules') {
      if (!ack) { setErrs({ ack: `Tick to accept version ${x.rules?.version}` }); return; }
      try { const r = await create.mutateAsync({ categoryId: catId, entryName: team || undefined, players: toPlayers(), captainPhone: players[0].phone, ackVersion: x.rules?.version, documents: needDocs.map(d => ({ type: d, name: docs[d], playerId: '' })) });
        setRegId(r.id); if (r.status !== 'pending_payment') { nav(`/t/${slug}/entry/${r.id}`); return; } } catch { return; }
    }
    setErrs({}); setStep(s => s + 1); window.scrollTo({ top: 0 });
  };
  const upd = (i: number, p: Partial<P>) => setPlayers(ps => ps.map((q, j) => (j === i ? { ...q, ...p, guardian: { ...q.guardian!, ...(p.guardian ?? {}) } } : q)));

  return <div className="pub" style={{ maxWidth: 680 }}>
    <Link to={`/t/${slug}`} className="small row tight" style={{ textDecoration: 'none' }}><Icon name="back" size={15} />{x.name}</Link>
    <h1 style={{ margin: '10px 0 4px' }}>Register</h1>
    <ol className="row tight" aria-label="Progress" style={{ listStyle: 'none', padding: 0, margin: '0 0 20px' }}>{steps.map((s, i) => <li key={s}><Chip tone={i === step ? 'ink' : i < step ? 'good' : 'neutral'}>{i + 1}. {s}</Chip></li>)}</ol>
    <div className="col loose">
      {cur === 'Category' && <fieldset className="col"><legend className="label">Which category?</legend>{errs.cat && <span className="err small">{errs.cat}</span>}
        {x.categories.map((c: any) => <label key={c.id} className="radio-card"><input type="radio" name="cat" checked={catId === c.id} onChange={() => { setCatId(c.id); const n = c.eventType === 'singles' ? 1 : c.eventType === 'doubles' ? 2 : c.rosterMin; setPlayers(ps => Array.from({ length: n }, (_, i) => ps[i] ?? blank())); }} />
          <span className="col tight grow"><span className="row between"><span className="bold">{c.name}</span><span className="display bold">{c.feePaise ? inr(c.feePaise) : 'Free'}</span></span><span className="small muted">{c.eventType === 'team' ? `Team of ${c.rosterMin}–${c.rosterMax}` : c.eventType}{c.maxAge ? ` · under ${c.maxAge + 1} on ${fmtDate(x.startDate)}` : ''}</span>
            <span className="xs">{c.taken >= c.capacity ? <Chip tone="info">Full: you'll join the waitlist</Chip> : `${c.capacity - c.taken} places left`}</span></span></label>)}</fieldset>}
      {cur === 'Players' && cat && <>
        {cat.eventType === 'team' && <Field label="Team name" error={errs.team}>{p => <Input {...p} value={team} onChange={e => setTeam(e.target.value)} />}</Field>}
        {players.map((p, i) => { const minor = !!p.dob && ageOn(p.dob, x.startDate) < u; const e = (k: string) => errs[`${i}.${k}`];
          return <fieldset key={i} className="card col"><legend className="display bold">{i === 0 ? (size > 1 ? 'Captain (player 1)' : 'Player') : `Player ${i + 1}`}</legend>
            <div className="grid g2"><Field label="Full name" error={e('name')}>{q => <Input {...q} autoComplete="name" value={p.name} onChange={ev => upd(i, { name: ev.target.value })} />}</Field>
              <Field label="Mobile" hint={i === 0 ? 'We send your confirmation and receipt here' : undefined} error={e('phone')}>{q => <Input {...q} inputMode="numeric" autoComplete="tel" value={p.phone} onChange={ev => upd(i, { phone: ev.target.value.replace(/\D/g, '').slice(0, 10) })} />}</Field>
              <Field label="Date of birth" error={e('dob')}>{q => <Input {...q} type="date" value={p.dob} onChange={ev => upd(i, { dob: ev.target.value })} />}</Field>
              <Field label="Gender">{q => <Select {...q} value={p.gender} onChange={ev => upd(i, { gender: ev.target.value as P['gender'] })} options={[['m', 'Male'], ['f', 'Female'], ['x', 'Prefer not to say']]} />}</Field></div>
            {minor && <div className="card flat col"><Banner tone="info" icon="shield">{p.name || 'This player'} is under {u}. A parent or guardian must consent. Their stats stay private unless the guardian chooses otherwise.</Banner>
              <div className="grid g2"><Field label="Guardian name" error={e('gname')}>{q => <Input {...q} value={p.guardian?.name} onChange={ev => upd(i, { guardian: { ...p.guardian!, name: ev.target.value } })} />}</Field>
                <Field label="Guardian mobile" error={e('gphone')}>{q => <Input {...q} inputMode="numeric" value={p.guardian?.phone} onChange={ev => upd(i, { guardian: { ...p.guardian!, phone: ev.target.value.replace(/\D/g, '').slice(0, 10) } })} />}</Field></div>
              <Check label="I am the parent or guardian and I consent to this registration and to Densparq processing their data for the tournament." checked={p.guardianConsent} onChange={ev => upd(i, { guardianConsent: ev.target.checked })} aria-invalid={!!e('consent')} />{e('consent') && <span className="err small">{e('consent')}</span>}</div>}
          </fieldset>; })}
        {cat.eventType === 'team' && players.length < cat.rosterMax && <Btn icon="plus" onClick={() => setPlayers([...players, blank()])}>Add player ({players.length}/{cat.rosterMax})</Btn>}
        {issues.length > 0 && <div className="col tight">{issues.map((s, k) => <Banner key={k} tone={s.blocking ? 'danger' : 'money'}>{s.message}{!s.blocking && ' (the organizer will review this)'}</Banner>)}</div>}
      </>}
      {cur === 'Documents' && <div className="col">{errs.docs && <Banner tone="danger">{errs.docs}</Banner>}{needDocs.map(d => <div key={d} className="card row between"><span className="col tight"><span className="bold">{d === 'age_proof' ? 'Age proof' : d === 'id_proof' ? 'Photo ID' : 'College / company ID'}</span><span className="small muted">{docs[d] ?? 'PDF or photo, under 5 MB'}</span></span>
        <label className="btn sm"><Icon name="upload" />{docs[d] ? 'Replace' : 'Upload'}<input type="file" className="sr" accept="image/*,.pdf" onChange={e => { const f = e.target.files?.[0]; if (f) { if (f.size > 5e6) toast('That file is over 5 MB', 'danger'); else setDocs({ ...docs, [d]: f.name }); } }} /></label></div>)}</div>}
      {cur === 'Rules' && (x.rules ? <>
        <div className="row between"><h2>Rules · version {x.rules.version}</h2><span className="small muted">Published {fmtDate(x.rules.publishedAt)}</span></div>
        <div ref={rulesRef} className="card prose" tabIndex={0} aria-label="Tournament rules" style={{ maxHeight: 360, overflow: 'auto' }} onScroll={e => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setReadAll(true); }}>
          {x.rules.sections.filter((s: any) => s.html).map((s: any) => <section key={s.key}><h3>{s.title}</h3><div dangerouslySetInnerHTML={{ __html: s.html }} /></section>)}</div>
        {!readAll && <span className="small muted">Scroll to the end to continue.</span>}
        <Check label={`I have read and accept the rules (version ${x.rules.version}) for everyone on this entry.`} hint="We save the version and the time you accepted it." checked={ack} disabled={!readAll} onChange={e => setAck(e.target.checked)} />
        {errs.ack && <span className="err small">{errs.ack}</span>}
        {full && <Banner tone="info">This category is full. You'll join the waitlist and pay only if a place opens up.</Banner>}
      </> : <Banner tone="money">The organizer hasn't published rules yet, so registration can't be completed. Check back soon.</Banner>)}
      {cur === 'Pay' && cat && <div className="col">
        <div className="card col"><div className="row between"><span>Entry fee · {cat.name}</span><span className="display bold" style={{ fontSize: 26 }}>{inr(cat.feePaise)}</span></div><span className="small muted">Your place is held while you pay. Refunds follow the published policy.</span></div>
        <fieldset className="col"><legend className="label">Pay with</legend>{[['upi', 'UPI (GPay, PhonePe, Paytm)'], ['card', 'Debit / credit card'], ['netbanking', 'Netbanking']].map(([v, l]) => <label key={v} className="radio-card"><input type="radio" name="pm" checked={method === v} onChange={() => setMethod(v)} /><span className="bold">{l}</span></label>)}</fieldset>
        <Check label="Demo: make this payment fail" checked={failNext} onChange={e => setFailNext(e.target.checked)} />
        <span className="xs muted">Payments are processed by Razorpay. Densparq never sees your card details.</span>
      </div>}
      <div className="row between"><Btn icon="back" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0 || cur === 'Pay'}>Back</Btn>
        {cur === 'Pay' ? <Btn kind="lime" size="lg" loading={pay.isPending} onClick={() => pay.mutate({ method, simulate: failNext ? 'fail' : undefined }, { onSuccess: () => nav(`/t/${slug}/entry/${regId}`), onError: (e: ApiError) => void e })}>Pay {cat && inr(cat.feePaise)}</Btn>
          : <Btn kind="primary" size="lg" loading={create.isPending} onClick={next} disabled={cur === 'Rules' && !x.rules}>{cur === 'Rules' ? (full ? 'Join waitlist' : cat?.feePaise ? 'Continue to payment' : 'Confirm entry') : 'Continue'}</Btn>}</div>
      {cur === 'Pay' && regId && <Link className="small" to={`/t/${slug}/entry/${regId}`}>Pay later. Your entry is saved as pending payment.</Link>}
    </div>
  </div>;
}

export function EntryStatus() {
  const { slug = '', rid = '' } = useParams(); const t = usePublicT(slug);
  const r = useQuery({ queryKey: ['pubreg', rid], queryFn: () => api.get<any>(`/public/registrations/${rid}`) });
  const ack = useAct((version: number) => api.post(`/registrations/${rid}/ack`, { version }), 'Thanks. You have accepted the new rules.');
  const pay = useAct(() => api.post(`/registrations/${rid}/payments`, { method: 'upi' }), 'Paid. Entry confirmed.');
  const [ok, setOk] = useState(false);
  if (r.isLoading || t.isLoading) return <div className="pub"><Loading /></div>; if (r.error) return <div className="pub"><ErrorState error={r.error} /></div>;
  const x = r.data, rules = t.data?.rules;
  const head: Record<string, [string, string]> = { confirmed: ["You're in!", 'Your entry is confirmed. We sent the details to your phone.'], pending_payment: ['Almost there', 'Pay the entry fee to confirm your place.'], waitlisted: ["You're on the waitlist", `You're number ${x.waitlistPos ?? '—'}. If a place opens we'll message you with a payment link.`], rejected: ['Entry not accepted', x.rejectReason ?? ''], withdrawn: ['Entry withdrawn', 'Any refund due goes back to your original payment method.'] };
  const [h, sub] = head[x.status] ?? ['Entry', ''];
  return <div className="pub" style={{ maxWidth: 620 }}>
    <Link to={`/t/${slug}`} className="small row tight" style={{ textDecoration: 'none' }}><Icon name="back" size={15} />{t.data?.name}</Link>
    <section className="hero" style={{ marginTop: 12 }}><Status s={x.status} /><h1 style={{ position: 'relative', zIndex: 1 }}>{h}</h1><span style={{ color: '#D6D6D6', position: 'relative', zIndex: 1 }}>{sub}</span></section>
    <div className="col" style={{ marginTop: 16 }}>
      {x.needsReack && rules && <div className="card col" style={{ borderColor: 'var(--money-line)' }}><h3>The rules changed (version {rules.version})</h3><p className="small" style={{ margin: 0 }}>Please read the updated rules and accept them to keep your place.</p>
        <details><summary className="btn sm">Read version {rules.version}</summary><div className="prose small" style={{ marginTop: 10 }}>{rules.sections.filter((s: any) => s.html).map((s: any) => <section key={s.key}><h3>{s.title}</h3><div dangerouslySetInnerHTML={{ __html: s.html }} /></section>)}</div></details>
        <Check label={`I accept version ${rules.version}`} checked={ok} onChange={e => setOk(e.target.checked)} /><Btn kind="primary" disabled={!ok} loading={ack.isPending} onClick={() => ack.mutate(rules.version, { onSuccess: () => r.refetch() })}>Accept</Btn></div>}
      {x.status === 'pending_payment' && <Btn kind="lime" size="lg" loading={pay.isPending} onClick={() => pay.mutate(undefined, { onSuccess: () => r.refetch() })}>Pay {inr(x.amountPaise)}</Btn>}
      <div className="card col tight"><div className="row between"><span className="muted">Entry</span><span className="bold">{x.entryName}</span></div><div className="row between"><span className="muted">Players</span><span>{x.players.map((p: any) => p.name).join(', ')}</span></div>
        <div className="row between"><span className="muted">Captain phone</span><span className="mono">{x.captainPhone}</span></div><div className="row between"><span className="muted">Rules accepted</span><span>v{x.ackVersion}</span></div>
        {x.receipt && <div className="row between"><span className="muted">Receipt</span><span className="mono bold">{x.receipt}</span></div>}<div className="row between"><span className="muted">Registered</span><span>{fmtDT(x.createdAt)}</span></div></div>
      <Link className="btn" to={`/t/${slug}`}>Back to the tournament</Link>
    </div>
  </div>;
}

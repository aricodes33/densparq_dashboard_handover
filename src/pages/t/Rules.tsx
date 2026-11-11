// Rules & regulations: per-tournament, versioned. Draft -> publish (material | minor) -> superseded. Published versions are immutable.
import { useEffect, useMemo, useState } from 'react';
import { useRules, useAct, useTournaments, useTemplates } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, useTid, can, ORGANIZER } from '@/ui/Page';
import { RichText } from '@/ui/RichText';
import { Banner, Btn, Chip, Empty, ErrorState, Loading, Modal, Status, Field, Textarea, Select, Seg, fmtDT, toast, Icon } from '@/ui/kit';
import type { RuleSection, RuleVersion } from '@/domain/types';

export function Rules() {
  const { tid, org } = useTid(); const r = useRules(tid); const admin = can(ORGANIZER);
  const [sel, setSel] = useState<string | null>(null); const [mode, setMode] = useState<'edit' | 'preview' | 'compare'>('edit');
  const [sections, setSections] = useState<RuleSection[]>([]); const [dirty, setDirty] = useState(false);
  const [pub, setPub] = useState(false); const [copy, setCopy] = useState(false);
  const versions = r.data?.versions ?? [];
  const v = versions.find(x => x.id === sel) ?? versions.find(x => x.status === 'draft') ?? versions[0];
  useEffect(() => { if (v) { setSections(v.sections); setDirty(false); } }, [v?.id]);
  const prev = useMemo(() => versions.find(x => x.version === (v?.version ?? 0) - 1), [versions, v]);
  const saveDraft = useAct((s: RuleSection[]) => api.patch(`/rule-versions/${v!.id}`, { sections: s }), 'Draft saved');
  const newDraft = useAct((b: object) => api.post<RuleVersion>(`/tournaments/${tid}/rules`, b), 'New draft created from the latest version');
  const unpublish = useAct(() => api.post(`/rule-versions/${v!.id}/unpublish`), 'Unpublished. The previous version is live again.');
  const upload = useAct((f: File) => api.post(`/rule-versions/${v!.id}/attachments`, { name: f.name, sizeBytes: f.size, mime: f.type }), 'Rulebook attached');
  if (r.isLoading) return <Loading rows={6} />; if (r.error) return <ErrorState error={r.error} />;
  const editable = admin && v?.status === 'draft' && mode === 'edit'; const draftExists = versions.some(x => x.status === 'draft');
  const st = r.data!.ackStats;
  return <>
    <PageHead title="Rules & regulations" sub="This tournament's own rulebook. Changes never touch other tournaments. Entrants accept a specific published version when they register."
      actions={admin && <>{!draftExists && <Btn icon="plus" onClick={() => newDraft.mutate({}, { onSuccess: n => setSel(n.id) })} loading={newDraft.isPending}>New draft</Btn>}<Btn icon="copy" onClick={() => setCopy(true)} disabled={draftExists}>Copy from…</Btn></>} />
    {st.needsReack > 0 && <Banner tone="money" icon="users">{st.needsReack} of {st.total} entries still need to accept the latest material change. They were notified and can't take part until they accept.</Banner>}
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 280px', alignItems: 'start', marginTop: 16 }}>
      <section className="col">
        {!v ? <Empty icon="rules" title="No rules yet" action={admin && <Btn kind="primary" onClick={() => newDraft.mutate({})}>Start a draft</Btn>} /> : <>
          <div className="row between"><div className="row tight"><h2>Version {v.version}</h2><Status s={v.status} />{v.status !== 'draft' && <Chip tone={v.material ? 'money' : 'neutral'}>{v.material ? 'Material change' : 'Minor change'}</Chip>}</div>
            <Seg label="View" value={mode} onChange={setMode} options={[['edit', v.status === 'draft' && admin ? 'Edit' : 'Read'], ['preview', 'Player preview'], ...(prev ? [['compare', `Compare with v${prev.version}`] as ['compare', string]] : [])]} /></div>
          {v.status === 'draft' && admin && <Banner tone="info" icon="rules" action={<div className="row tight"><Btn onClick={() => saveDraft.mutate(sections, { onSuccess: () => setDirty(false) })} disabled={!dirty} loading={saveDraft.isPending}>Save draft</Btn><Btn kind="primary" onClick={() => { if (dirty) saveDraft.mutate(sections); setPub(true); }}>Publish v{v.version}</Btn></div>}>Draft. Players can't see it until you publish. {dirty && <strong>Unsaved changes.</strong>}</Banner>}
          {v.status === 'published' && admin && <div className="row tight"><Btn size="sm" kind="ghost" onClick={() => unpublish.mutate(undefined)}>Unpublish this version</Btn></div>}
          {mode === 'preview' ? <article className="card col prose">{sections.filter(s => s.html).map(s => <section key={s.key}><h3>{s.title}</h3><div dangerouslySetInnerHTML={{ __html: s.html }} /></section>)}{!sections.some(s => s.html) && <p className="muted">Nothing written yet.</p>}</article>
            : mode === 'compare' && prev ? <div className="col">{sections.map(s => { const o = prev.sections.find(x => x.key === s.key)?.html ?? ''; const changed = o !== s.html; return <div key={s.key} className="card col" style={changed ? { borderColor: 'var(--money-line)' } : undefined}><div className="row between"><h3>{s.title}</h3>{changed ? <Chip tone="money">Changed</Chip> : <Chip>Same</Chip>}</div>
              {changed && <div className="grid g2"><div className="col tight"><span className="xs muted">v{prev.version}</span><div className="prose small diff-del" dangerouslySetInnerHTML={{ __html: o || '<p>(empty)</p>' }} /></div><div className="col tight"><span className="xs muted">v{v.version}</span><div className="prose small diff-add" dangerouslySetInnerHTML={{ __html: s.html || '<p>(empty)</p>' }} /></div></div>}</div>; })}</div>
            : sections.map((s, i) => <div key={s.key} className="col tight"><h3>{s.title}</h3>{editable ? <RichText label={s.title} value={s.html} onChange={h => { setSections(x => x.map((y, j) => j === i ? { ...y, html: h } : y)); setDirty(true); }} /> : <div className="card prose small" dangerouslySetInnerHTML={{ __html: s.html || '<p class="muted">Not written.</p>' }} />}</div>)}
          <section className="card flat col"><h3>Rulebook files</h3>{v.attachments.map(a => <div key={a.id} className="row tight small"><Icon name="rules" />{a.name} <span className="muted">· {(a.sizeBytes / 1024).toFixed(0)} KB</span></div>)}
            {!v.attachments.length && <span className="small muted">No files. Upload the official PDF or Word rulebook if you have one.</span>}
            {editable && <label className="btn sm" style={{ alignSelf: 'flex-start' }}><Icon name="upload" />Upload PDF / Word<input type="file" className="sr" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} /></label>}</section>
        </>}
      </section>
      <aside className="col" aria-label="Version history">
        <div className="card col"><h3>Acknowledgements</h3><span className="display bold" style={{ fontSize: 28 }}>{st.onLatest}/{st.total}</span><span className="small muted">entries accepted the live version{r.data!.published ? ` (v${r.data!.published.version})` : ''}</span></div>
        <div className="card col tight"><h3>Version history</h3>{versions.map(x => <button key={x.id} type="button" onClick={() => setSel(x.id)} className="row between" aria-current={x.id === v?.id} style={{ border: 0, background: x.id === v?.id ? 'var(--soft)' : 'none', borderRadius: 10, padding: '8px 10px', cursor: 'pointer', textAlign: 'left' }}>
          <span className="col tight" style={{ gap: 0 }}><span className="bold">v{x.version}</span><span className="xs muted">{x.authorName} · {fmtDT(x.publishedAt ?? x.createdAt)}</span>{x.changeSummary && <span className="xs">{x.changeSummary}</span>}</span><Status s={x.status} /></button>)}</div>
      </aside>
    </div>
    {pub && v && <PublishDialog v={v} isFirst={v.version === 1} total={st.total} onClose={() => setPub(false)} />}
    {copy && <CopyDialog tid={tid} org={org} onClose={() => setCopy(false)} onDone={id => setSel(id)} />}
  </>;
}

function PublishDialog({ v, isFirst, total, onClose }: { v: RuleVersion; isFirst: boolean; total: number; onClose: () => void }) {
  const [material, setMaterial] = useState<'material' | 'minor'>(v.material ? 'material' : 'minor'); const [summary, setSummary] = useState(v.changeSummary); const [tried, setTried] = useState(false);
  const pub = useAct((b: object) => api.post(`/rule-versions/${v.id}/publish`, b), material === 'material' && !isFirst ? `Published. ${total} entries asked to re-accept.` : 'Rules published');
  const go = () => { setTried(true); if (!isFirst && !summary.trim()) return; pub.mutate({ material: material === 'material', changeSummary: summary.trim() || 'First publication' }, { onSuccess: onClose }); };
  return <Modal title={`Publish rules v${v.version}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={go} loading={pub.isPending}>Publish</Btn></>}>
    {!isFirst && <fieldset className="col"><legend className="label">What kind of change is this?</legend>
      <label className="radio-card"><input type="radio" checked={material === 'material'} onChange={() => setMaterial('material')} /><span className="col tight"><span className="bold">Material change</span><span className="small muted">Affects how people play, qualify or get refunds. All {total} entries are notified and must accept v{v.version} again.</span></span></label>
      <label className="radio-card"><input type="radio" checked={material === 'minor'} onChange={() => setMaterial('minor')} /><span className="col tight"><span className="bold">Minor change</span><span className="small muted">Typos, clarifications. Entrants are told, but their earlier acceptance still counts.</span></span></label></fieldset>}
    <Field label="Summary of changes" hint="Shown to players in the notification and in version history" error={tried && !isFirst && !summary.trim() ? 'Summarise what changed' : undefined}>{p => <Textarea {...p} rows={3} value={summary} onChange={e => setSummary(e.target.value)} />}</Field>
  </Modal>;
}

function CopyDialog({ tid, org, onClose, onDone }: { tid: string; org: string; onClose: () => void; onDone: (id: string) => void }) {
  const ts = useTournaments(org); const tpl = useTemplates(org); const [src, setSrc] = useState('');
  const go = useAct((b: object) => api.post<RuleVersion>(`/tournaments/${tid}/rules`, b), 'Copied into a new draft. The source is unchanged.');
  const opts: [string, string][] = [['', 'Choose…'], ...(tpl.data ?? []).map(x => [`tpl:${x.id}`, `Template · ${x.name}`] as [string, string]), ...(ts.data ?? []).filter(x => x.id !== tid).map(x => [`t:${x.id}`, `Tournament · ${x.name}`] as [string, string])];
  return <Modal title="Copy rules from…" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!src} loading={go.isPending} onClick={() => go.mutate(src.startsWith('tpl:') ? { templateId: src.slice(4) } : { fromTournamentId: src.slice(2) }, { onSuccess: n => { onDone(n.id); onClose(); } })}>Copy into new draft</Btn></>}>
    <p className="muted" style={{ margin: 0 }}>Makes an independent copy. You can edit it freely without changing the original.</p>
    <Field label="Source">{p => <Select {...p} value={src} onChange={e => setSrc(e.target.value)} options={opts} />}</Field>
  </Modal>;
}
void toast;

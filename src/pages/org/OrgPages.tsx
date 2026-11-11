import { useParams } from 'react-router-dom';
import { useState } from 'react';
import { useMembers, useTemplates, useAudit, useAct } from '@/api/hooks';
import { api } from '@/api/client';
import { PageHead, can } from '@/ui/Page';
import { Btn, Chip, ErrorState, Loading, Modal, Field, Input, Select, Empty, fmtDT, human, Confirm } from '@/ui/kit';

export function OrgStaff() {
  const { org = 'densparq' } = useParams(); const m = useMembers(org); const [add, setAdd] = useState(false); const [f, setF] = useState({ name: '', phone: '', role: 'referee' });
  const [rm, setRm] = useState<string | null>(null);
  const create = useAct((b: typeof f) => api.post(`/orgs/${org}/members`, b), 'Invited. They get an OTP login link on WhatsApp.');
  const del = useAct((id: string) => api.del(`/memberships/${id}`), 'Access removed');
  const err = !f.name ? 'Name is required' : !/^\d{10}$/.test(f.phone) ? 'Enter a 10-digit mobile number' : '';
  const [tried, setTried] = useState(false);
  return <><PageHead crumbs={false} title="Staff & roles" sub="Who can do what. Referees only see matches they're assigned to. Registration managers handle entries and payments but can't change setup or rules." actions={can(['org_admin']) && <Btn kind="lime" icon="plus" onClick={() => setAdd(true)}>Invite staff</Btn>} />
    {m.isLoading ? <Loading /> : m.error ? <ErrorState error={m.error} /> : <div className="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Role</th><th /></tr></thead><tbody>{m.data!.map(x => <tr key={x.id}><td className="bold">{x.user?.name}</td><td className="mono">{x.user?.phone}</td><td><Chip tone={x.role === 'org_admin' ? 'ink' : 'neutral'}>{human(x.role)}</Chip></td><td className="num"><Btn size="sm" kind="ghost" onClick={() => setRm(x.id)}>Remove</Btn></td></tr>)}</tbody></table></div>}
    <section className="card flat col" style={{ marginTop: 20 }}><h3>Role permissions</h3><div className="table-wrap"><table><thead><tr><th>Capability</th><th>Organizer</th><th>Registration mgr</th><th>Referee</th><th>Captain</th><th>Spectator</th></tr></thead><tbody>
      {[['Create, edit, publish tournaments', 1, 0, 0, 0, 0], ['Edit & publish rules', 1, 0, 0, 0, 0], ['Manage entries, payments, refunds', 1, 1, 0, 0, 0], ['Fee waivers & exceptions', 1, 0, 0, 0, 0], ['Generate & publish fixtures', 1, 0, 0, 0, 0], ['Score assigned matches', 1, 0, 1, 0, 0], ['Verify results / approve overrides', 1, 0, 0, '✓ (own match)', 0], ['Register, edit roster, accept rules', 0, 0, 0, 1, 0], ['View fixtures, standings, public stats', 1, 1, 1, 1, 1]].map(r => <tr key={r[0] as string}>{r.map((c, i) => <td key={i} className={i ? '' : 'bold'}>{i === 0 ? c : c === 1 ? '✓' : c === 0 ? '—' : c}</td>)}</tr>)}
    </tbody></table></div></section>
    {add && <Modal title="Invite staff" onClose={() => setAdd(false)} footer={<><Btn onClick={() => setAdd(false)}>Cancel</Btn><Btn kind="primary" loading={create.isPending} onClick={() => { setTried(true); if (!err) create.mutate(f, { onSuccess: () => setAdd(false) }); }}>Send invite</Btn></>}>
      <Field label="Full name" error={tried && !f.name ? err : undefined}>{p => <Input {...p} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}</Field>
      <Field label="Mobile number" hint="10 digits, India" error={tried && f.name && err ? err : undefined}>{p => <Input {...p} inputMode="numeric" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />}</Field>
      <Field label="Role">{p => <Select {...p} value={f.role} onChange={e => setF({ ...f, role: e.target.value })} options={[['org_admin', 'Owner / admin'], ['branch_manager', 'Branch manager'], ['front_desk', 'Front desk'], ['coach', 'Academy coach'], ['registration_manager', 'Tournament registration manager'], ['referee', 'Referee / scorekeeper']]} />}</Field>
    </Modal>}
    {rm && <Confirm title="Remove access?" body="They lose access to every tournament in this organization immediately." confirm="Remove" danger onClose={() => setRm(null)} onConfirm={() => del.mutate(rm, { onSuccess: () => setRm(null) })} />}
  </>;
}

export function OrgTemplates() {
  const { org = 'densparq' } = useParams(); const t = useTemplates(org); const [open, setOpen] = useState<string | null>(null);
  return <><PageHead crumbs={false} title="Rule templates" sub="Reusable rulebooks. Copying a template into a tournament makes an independent copy: editing it never changes the template or other tournaments." />
    {t.isLoading ? <Loading /> : !t.data?.length ? <Empty title="No templates" /> : t.data.map(x => <section key={x.id} className="card col"><div className="row between"><h2>{x.name}</h2><Btn size="sm" onClick={() => setOpen(open === x.id ? null : x.id)} aria-expanded={open === x.id}>{open === x.id ? 'Hide' : 'Preview'}</Btn></div>
      {open === x.id && x.sections.filter(s => s.html).map(s => <div key={s.key}><h3>{s.title}</h3><div className="prose small" dangerouslySetInnerHTML={{ __html: s.html }} /></div>)}</section>)}</>;
}

export function OrgAudit() {
  const { org = 'densparq' } = useParams(); const a = useAudit(org);
  return <><PageHead crumbs={false} title="Audit log" sub="Every change to setup, rules, entries, fixtures, results and standings, with who did it and why." />
    {a.isLoading ? <Loading /> : a.error ? <ErrorState error={a.error} /> : !a.data!.length ? <Empty title="No activity yet" /> : <div className="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th>Reason</th></tr></thead><tbody>{a.data!.map(x => <tr key={x.id}><td className="small mono">{fmtDT(x.at)}</td><td>{x.byName}</td><td className="bold">{x.action}</td><td><Chip>{x.entity}</Chip></td><td className="small muted">{x.reason ?? '—'}</td></tr>)}</tbody></table></div>}</>;
}

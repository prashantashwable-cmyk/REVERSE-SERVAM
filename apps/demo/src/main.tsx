import { StrictMode, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CALL_OUTCOMES,
  DEFAULT_SURVEY_REQUIREMENTS,
  DomainError,
  LOST_REASONS,
  errorMessage,
  formatDateTimeIST,
  formatInr,
  formatPhone,
  t,
  classifyGps,
  toMillimetres,
  type LengthUnit,
  type LostReason,
} from '@aiec/domain';
import * as S from './store';
import type { DemoState, DemoUser, Lead, Survey } from './store';

/* ------------------------------ small helpers ----------------------------- */

const pretty = (x: string) => x.replace(/^doc_/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const dt = (iso: string | null) => (iso ? formatDateTimeIST(iso) : '—');

type Route =
  | { name: 'home' }
  | { name: 'leads' }
  | { name: 'lead'; id: string }
  | { name: 'new-lead' }
  | { name: 'surveys' }
  | { name: 'survey'; id: string }
  | { name: 'audit' }
  | { name: 'inbox' }
  | { name: 'about' };

interface Ctx {
  state: DemoState;
  user: DemoUser;
  go: (r: Route) => void;
  /** Run an action against a copy of state; commit on success, show the explained error otherwise. */
  act: (fn: (s: DemoState) => void, success?: string) => boolean;
}

function Chip({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'ok' | 'warn' | 'crit' | 'gold' }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

const STATE_TONE: Record<string, 'info' | 'ok' | 'warn' | 'crit' | 'gold'> = {
  qualified: 'gold', submitted: 'gold', won: 'ok', reviewed: 'ok', lost: 'info', invalid: 'info',
  revision_requested: 'warn', reschedule_requested: 'warn', revisit_requested: 'warn', site_inaccessible: 'crit', cancelled: 'info',
};

function StateChip({ kind, state }: { kind: 'lead' | 'survey'; state: string }) {
  return <Chip tone={STATE_TONE[state] ?? 'info'}>{t(`${kind}.state.${state}`)}</Chip>;
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">
        {label}
        {required ? <span className="req" aria-hidden="true"> *</span> : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

/* ---------------------------------- app ----------------------------------- */

function App() {
  const [state, setState] = useState<DemoState>(() => S.load());
  const [userId, setUserId] = useState<string>(() => {
    try {
      return localStorage.getItem('aiec-demo-user') ?? 'u-sales1';
    } catch {
      return 'u-sales1';
    }
  });
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [toast, setToast] = useState<{ tone: 'ok' | 'crit'; title: string; body?: string } | null>(null);
  const user = S.userById(userId) ?? S.USERS[1]!;

  useEffect(() => S.save(state), [state]);
  useEffect(() => {
    try {
      localStorage.setItem('aiec-demo-user', userId);
    } catch {
      /* ignore */
    }
  }, [userId]);
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), toast.tone === 'ok' ? 2500 : 7000);
    return () => clearTimeout(h);
  }, [toast]);

  const go = (r: Route) => {
    setRoute(r);
    window.scrollTo(0, 0);
  };
  const act: Ctx['act'] = (fn, success) => {
    const draft = structuredClone(state);
    try {
      fn(draft);
      setState(draft);
      if (success) setToast({ tone: 'ok', title: success });
      return true;
    } catch (e) {
      const code = e instanceof DomainError ? e.code : 'UNKNOWN_ERROR';
      const m = errorMessage(code);
      const d = e instanceof DomainError ? e.details : {};
      const list = [...((d.fields as string[]) ?? []), ...((d.missing as string[]) ?? [])].map(pretty);
      const allowed = Array.isArray(d.allowedActions) ? `Allowed now: ${(d.allowedActions as string[]).map(pretty).join(', ') || 'none'}` : '';
      setToast({ tone: 'crit', title: m.title, body: [m.nextAction, list.length ? `→ ${list.join(', ')}` : '', allowed].filter(Boolean).join(' ') });
      return false;
    }
  };
  const ctx: Ctx = { state, user, go, act };
  const unread = state.notices.filter((n) => n.to === user.id && !n.read).length;

  const tabs: { route: Route; label: string; show: boolean; badge?: number }[] = [
    { route: { name: 'home' }, label: 'Home', show: true },
    { route: { name: 'leads' }, label: 'Leads', show: S.perms(user).has('lead.read_all') || S.perms(user).has('lead.read_assigned') || user.role === 'partner_admin' },
    { route: { name: 'surveys' }, label: user.role === 'surveyor' ? 'My surveys' : 'Surveys', show: user.role !== 'partner_admin' },
    { route: { name: 'audit' }, label: 'Audit', show: S.perms(user).has('audit.read') },
    { route: { name: 'inbox' }, label: 'Inbox', show: true, badge: unread },
  ];

  return (
    <div className="app">
      <div className="demo-banner" role="note">
        DEMO — simulated data on this phone only · <button className="linkish" onClick={() => go({ name: 'about' })}>What is this?</button>
      </div>
      <header className="topbar">
        <div>
          <div className="brand">AIEC</div>
          <div className="sub">Elevator Installation OS</div>
        </div>
        <label className="role">
          <span className="sr-only">Viewing as</span>
          <select
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              go({ name: 'home' });
            }}
          >
            {S.USERS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {t(`role.${u.role}`)}
              </option>
            ))}
          </select>
        </label>
      </header>

      {toast ? (
        <div className={`toast toast-${toast.tone}`} role={toast.tone === 'crit' ? 'alert' : 'status'} onClick={() => setToast(null)}>
          <strong>{toast.title}</strong>
          {toast.body ? <div>{toast.body}</div> : null}
        </div>
      ) : null}

      <main className="content">
        {route.name === 'home' && <Home ctx={ctx} />}
        {route.name === 'leads' && <Leads ctx={ctx} />}
        {route.name === 'new-lead' && <NewLead ctx={ctx} />}
        {route.name === 'lead' && <LeadDetail ctx={ctx} id={route.id} />}
        {route.name === 'surveys' && <Surveys ctx={ctx} />}
        {route.name === 'survey' && <SurveyDetail ctx={ctx} id={route.id} />}
        {route.name === 'audit' && <Audit ctx={ctx} />}
        {route.name === 'inbox' && <Inbox ctx={ctx} setState={setState} />}
        {route.name === 'about' && <About reset={() => { setState(S.reset()); go({ name: 'home' }); setToast({ tone: 'ok', title: 'Demo data reset' }); }} />}
      </main>

      <nav className="tabs" aria-label="Main">
        {tabs.filter((x) => x.show).map((x) => (
          <button key={x.label} className={route.name === x.route.name ? 'tab active' : 'tab'} onClick={() => go(x.route)} aria-current={route.name === x.route.name ? 'page' : undefined}>
            {x.label}
            {x.badge ? <span className="badge" aria-label={`${x.badge} unread`}>{x.badge}</span> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ---------------------------------- home ---------------------------------- */

function Home({ ctx }: { ctx: Ctx }) {
  const { state, user, go } = ctx;
  const leads = S.visibleLeads(state, user);
  const surveys = S.visibleSurveys(state, user);
  const open = (l: Lead) => ['assigned', 'contacted', 'qualified'].includes(l.status);
  const kpis: { label: string; value: number; def: string; to: Route }[] = [];
  if (S.perms(user).has('lead.read_all')) {
    kpis.push({ label: 'Unassigned leads', value: leads.filter((l) => l.status === 'new').length, def: 'Leads in state New', to: { name: 'leads' } });
    kpis.push({ label: 'Qualified leads', value: leads.filter((l) => l.status === 'qualified').length, def: 'Leads in state Qualified', to: { name: 'leads' } });
  }
  if (S.perms(user).has('lead.read_assigned')) {
    kpis.push({ label: 'My uncontacted leads', value: leads.filter((l) => l.status === 'assigned').length, def: 'My leads with no two-way contact yet', to: { name: 'leads' } });
    kpis.push({ label: 'Overdue follow-ups', value: leads.filter((l) => open(l) && l.nextActionAt && Date.parse(l.nextActionAt) < Date.now()).length, def: 'My open leads whose next action is past', to: { name: 'leads' } });
  }
  if (user.role === 'surveyor') {
    kpis.push({ label: 'Assigned surveys', value: surveys.filter((v) => !['submitted', 'cancelled', 'reviewed'].includes(v.status)).length, def: 'Surveys to do', to: { name: 'surveys' } });
  }
  if (S.perms(user).has('survey.read_all')) {
    kpis.push({ label: 'Awaiting technical review', value: surveys.filter((v) => v.status === 'submitted').length, def: 'Surveys in state Submitted', to: { name: 'surveys' } });
  }
  return (
    <>
      <h1>Hello, {user.name.split(' ')[0]}</h1>
      <p className="muted">{t(`role.${user.role}`)} · {user.org}</p>
      {user.role === 'partner_admin' ? (
        <Card title="Partner workspace">
          <p>Partner companies are separate tenants: you cannot see AIEC leads, customers or other partners. Project assignments, teams and tasks arrive in Slice 5.</p>
        </Card>
      ) : null}
      <div className="kpis">
        {kpis.map((k) => (
          <button key={k.label} className="kpi" onClick={() => go(k.to)}>
            <span className="kpi-label">{k.label}</span>
            <span className="kpi-value">{k.value}</span>
            <span className="kpi-def">Basis: count. {k.def}.</span>
          </button>
        ))}
      </div>
      <Card title="Try this">
        <ol className="steps">
          <li>As <b>Rahul (Sales)</b>: Leads → New lead. Use phone <b>98220 11001</b> to see the duplicate check.</li>
          <li>Open <b>Green Valley Society</b>: record a call, then qualify it, then book a survey with Vikram.</li>
          <li>Switch to <b>Vikram (Surveyor)</b>: accept, check in (uses your phone GPS), measure, take photos, submit.</li>
          <li>Switch to <b>Meera (Technical)</b>: review the survey and return it for revision.</li>
          <li>Switch to <b>Asha (Owner)</b>: see the Audit trail of everything.</li>
        </ol>
      </Card>
    </>
  );
}

/* ---------------------------------- leads --------------------------------- */

function Leads({ ctx }: { ctx: Ctx }) {
  const { state, user, go } = ctx;
  if (!(S.perms(user).has('lead.read_all') || S.perms(user).has('lead.read_assigned'))) {
    return (
      <Card title="No access to leads">
        <p className="warn-text">Your role does not include AIEC leads. This is enforced by the server for every request (tenant isolation), not just hidden in the menu.</p>
      </Card>
    );
  }
  const leads = S.visibleLeads(state, user);
  return (
    <>
      <div className="row-between">
        <h1>Leads</h1>
        {S.perms(user).has('lead.create') ? <button className="btn" onClick={() => go({ name: 'new-lead' })}>+ New lead</button> : null}
      </div>
      <p className="muted">{S.perms(user).has('lead.read_all') ? 'All leads (owner view)' : 'Leads assigned to you'}</p>
      {leads.length === 0 ? <p className="empty">No leads yet.</p> : null}
      <ul className="list">
        {leads.map((l) => {
          const late = l.nextActionAt && Date.parse(l.nextActionAt) < Date.now() && ['assigned', 'contacted', 'qualified'].includes(l.status);
          return (
            <li key={l.id}>
              <button className="item" onClick={() => go({ name: 'lead', id: l.id })}>
                <span className="item-title">{l.projectName}</span>
                <span className="mono small">{l.number}</span>
                <span className="small muted">{[l.locality, l.city].filter(Boolean).join(', ')} · {l.contactName}</span>
                <span className="row">
                  <StateChip kind="lead" state={l.status} />
                  {late ? <Chip tone="crit">Follow-up overdue</Chip> : null}
                  {l.score !== null ? <Chip tone="gold">Score {l.score}</Chip> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const EMPTY_LEAD: S.NewLeadInput = { contactName: '', phone: '', email: '', projectName: '', builderName: '', city: 'Pune', locality: '', lat: '', lng: '', liftRequirement: '', source: '', confirmSeparate: [], duplicateReason: '' };

function NewLead({ ctx }: { ctx: Ctx }) {
  const { state, user, go, act } = ctx;
  const [f, setF] = useState<S.NewLeadInput>(EMPTY_LEAD);
  const [showDups, setShowDups] = useState(false);
  const set = (k: keyof S.NewLeadInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const dups = useMemo(() => (showDups ? S.duplicateCandidates(state, f) : []), [showDups, state, f]);
  if (!S.perms(user).has('lead.create')) return <Card title="Not allowed"><p>Only Sales can create leads (the Owner reads and assigns).</p></Card>;
  const submit = () => {
    let created: Lead | undefined;
    const ok = act((s) => {
      created = S.createLead(s, user, f);
    }, 'Lead created');
    if (ok && created) go({ name: 'lead', id: created.id });
    else {
      setShowDups(true);
      window.scrollTo(0, 0); // the duplicate review panel is at the top
    }
  };
  return (
    <>
      <button className="back" onClick={() => go({ name: 'leads' })}>← Leads</button>
      <h1>New lead</h1>
      <p className="muted">Capture what is known; technical details can stay “to be confirmed”.</p>
      {dups.length > 0 ? (
        <Card title="Possible duplicates — review first">
          <p className="small">Nothing is merged automatically. Confirm each is a separate opportunity and give a reason, or go back.</p>
          {dups.map((d) => (
            <label key={d.id} className="dup">
              <input
                type="checkbox"
                checked={f.confirmSeparate.includes(d.id)}
                onChange={(e) => setF({ ...f, confirmSeparate: e.target.checked ? [...f.confirmSeparate, d.id] : f.confirmSeparate.filter((x) => x !== d.id) })}
              />
              <span>
                <b>{d.lead.number}</b> · {d.lead.projectName} <Chip tone={d.level === 'strong' ? 'crit' : 'warn'}>{d.level === 'strong' ? 'Strong match' : 'Possible match'}</Chip>
                <br />
                <span className="small muted">
                  Matched on: {d.reasons.map(pretty).join(', ')}
                  {d.distanceM !== undefined ? ` (${Math.round(d.distanceM)} m away)` : ''} · Owner: {S.userById(d.lead.ownerId)?.name ?? 'unassigned'}
                </span>
              </span>
            </label>
          ))}
          <Field label="Why is this a separate opportunity?" required>
            <textarea value={f.duplicateReason} onChange={set('duplicateReason')} rows={2} />
          </Field>
        </Card>
      ) : null}
      <Card title="Contact">
        <Field label="Contact name" required><input value={f.contactName} onChange={set('contactName')} autoComplete="name" /></Field>
        <Field label="Mobile" hint="Phone or email is required"><input value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="98765 43210" /></Field>
        <Field label="Email"><input value={f.email} onChange={set('email')} type="email" /></Field>
      </Card>
      <Card title="Site and requirement">
        <Field label="Project name" required><input value={f.projectName} onChange={set('projectName')} /></Field>
        <Field label="Builder / developer"><input value={f.builderName} onChange={set('builderName')} /></Field>
        <Field label="City" required><input value={f.city} onChange={set('city')} list="cities" /></Field>
        <datalist id="cities"><option value="Pune" /><option value="PCMC" /></datalist>
        <Field label="Locality"><input value={f.locality} onChange={set('locality')} /></Field>
        <Field label="Initial requirement" required hint="e.g. one 6-passenger lift for G+4"><input value={f.liftRequirement} onChange={set('liftRequirement')} /></Field>
        <Field label="Source" required>
          <select value={f.source} onChange={set('source')}>
            <option value="" disabled>Select…</option>
            {['website', 'phone', 'whatsapp', 'referral', 'builder_visit', 'marketing_campaign', 'existing_customer', 'manual'].map((x) => (
              <option key={x} value={x}>{pretty(x)}</option>
            ))}
          </select>
        </Field>
      </Card>
      <button className="btn block" onClick={submit}>{dups.length ? 'Confirm and create lead' : 'Create lead'}</button>
    </>
  );
}

function LeadDetail({ ctx, id }: { ctx: Ctx; id: string }) {
  const { state, user, go, act } = ctx;
  const lead = S.visibleLeads(state, user).find((l) => l.id === id);
  const [a, setA] = useState({ type: 'call', outcome: '' as S.Activity['outcome'] | '', summary: '', next: '', noActionReason: '' });
  const [q, setQ] = useState<Record<string, string>>({});
  const [sv, setSv] = useState({ surveyorId: 'u-surv1', start: '', hours: '2' });
  const [close, setClose] = useState({ outcome: 'lost' as 'lost' | 'invalid', lostReason: '' as LostReason | '', reason: '' });
  const [assignee, setAssignee] = useState({ id: 'u-sales1', reason: '' });
  if (!lead) return <Card title="Record not found"><p>It does not exist or is not shared with you.</p></Card>;
  const isOwner = lead.ownerId === user.id;
  const open = ['assigned', 'contacted', 'qualified'].includes(lead.status);
  const activities = state.activities.filter((x) => x.leadId === id);
  const surveys = state.surveys.filter((v) => v.leadId === id);
  const qual = { ...(lead.qualification ?? {}), ...q };
  return (
    <>
      <button className="back" onClick={() => go({ name: 'leads' })}>← Leads</button>
      <h1>{lead.projectName}</h1>
      <p className="row"><span className="mono small">{lead.number}</span> <StateChip kind="lead" state={lead.status} /></p>
      <Card title="Overview">
        <dl className="kv">
          <dt>Contact</dt><dd>{lead.contactName}</dd>
          <dt>Phone</dt><dd>{lead.phone ? <a href={`tel:${lead.phone}`}>{formatPhone(lead.phone)}</a> : '—'}</dd>
          <dt>Site</dt><dd>{[lead.locality, lead.city].filter(Boolean).join(', ')}</dd>
          <dt>Requirement</dt><dd>{lead.liftRequirement}</dd>
          <dt>Owner</dt><dd>{S.userById(lead.ownerId)?.name ?? 'Unassigned'}</dd>
          <dt>Next action</dt><dd>{dt(lead.nextActionAt)}</dd>
          {lead.lostReason ? (<><dt>Lost</dt><dd>{pretty(lead.lostReason)} — {lead.closedReason}</dd></>) : null}
        </dl>
      </Card>
      {lead.scoreExplanation ? (
        <Card title={`Lead score: ${lead.score}`}>
          <ul className="small">
            {lead.scoreExplanation.map((e) => <li key={e.key}>{e.matched ? '✓' : '—'} {pretty(e.key)}: {e.points} pts</li>)}
          </ul>
          <p className="hint">A prioritization aid only — not a credit or legal decision.</p>
        </Card>
      ) : null}
      {surveys.length > 0 ? (
        <Card title="Surveys">
          {surveys.map((v) => (
            <button key={v.id} className="item" onClick={() => go({ name: 'survey', id: v.id })}>
              <span className="mono small">{v.number}</span> <StateChip kind="survey" state={v.status} /> <span className="small muted">{dt(v.start)}</span>
            </button>
          ))}
        </Card>
      ) : null}

      {isOwner && open ? (
        <Card title="Record call / meeting">
          <Field label="Outcome">
            <select value={a.outcome ?? ''} onChange={(e) => setA({ ...a, outcome: e.target.value as typeof a.outcome })}>
              <option value="">No outcome (note)</option>
              {CALL_OUTCOMES.map((o) => <option key={o} value={o}>{pretty(o)}</option>)}
            </select>
          </Field>
          <Field label="Summary" required><textarea rows={2} value={a.summary} onChange={(e) => setA({ ...a, summary: e.target.value })} /></Field>
          <Field label="Next follow-up (IST)" hint="Required, unless you record why no action is needed"><input type="datetime-local" value={a.next} onChange={(e) => setA({ ...a, next: e.target.value })} /></Field>
          <Field label="No next action because…"><input value={a.noActionReason} onChange={(e) => setA({ ...a, noActionReason: e.target.value })} /></Field>
          <button className="btn block" onClick={() => act((s) => S.recordActivity(s, user, id, { ...a, outcome: a.outcome ?? '' }), 'Activity recorded') && setA({ type: 'call', outcome: '', summary: '', next: '', noActionReason: '' })}>Record activity</button>
        </Card>
      ) : null}

      {isOwner && ['contacted', 'qualified'].includes(lead.status) ? (
        <Card title={lead.status === 'qualified' ? 'Update qualification' : 'Qualify'}>
          <Field label="Need" required><input value={qual.need ?? ''} onChange={(e) => setQ({ ...qual, need: e.target.value })} /></Field>
          {([['decision_authority', 'Decision authority', ['confirmed', 'influencer', 'unknown_yet']], ['budget_readiness', 'Budget readiness', ['ready', 'approval_pending', 'exploring']], ['timeline', 'Timeline', ['within_3_months', 'within_6_months', 'later']], ['site_readiness', 'Site readiness', ['ready', 'under_construction', 'not_started']]] as const).map(([k, label, opts]) => (
            <Field key={k} label={label} required={k === 'decision_authority' || k === 'timeline'}>
              <select value={qual[k] ?? ''} onChange={(e) => setQ({ ...qual, [k]: e.target.value })}>
                <option value="">Unknown</option>
                {opts.map((o) => <option key={o} value={o}>{pretty(o)}</option>)}
              </select>
            </Field>
          ))}
          <Field label="Next action" required><input value={qual.next_action ?? ''} onChange={(e) => setQ({ ...qual, next_action: e.target.value })} /></Field>
          <button className="btn block" onClick={() => act((s) => S.qualify(s, user, id, Object.fromEntries(Object.entries(qual).filter(([, v]) => v))), 'Lead qualified')}>Save qualification</button>
        </Card>
      ) : null}

      {isOwner && lead.status === 'qualified' ? (
        <Card title="Book a site survey">
          <Field label="Surveyor" required>
            <select value={sv.surveyorId} onChange={(e) => setSv({ ...sv, surveyorId: e.target.value })}>
              {S.USERS.filter((u) => u.role === 'surveyor').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Start (IST)" required><input type="datetime-local" value={sv.start} onChange={(e) => setSv({ ...sv, start: e.target.value })} /></Field>
          <Field label="Duration (hours)" required><input inputMode="decimal" value={sv.hours} onChange={(e) => setSv({ ...sv, hours: e.target.value })} /></Field>
          <button className="btn block" onClick={() => act((s) => { S.scheduleSurvey(s, user, id, sv.surveyorId, sv.start, Number(sv.hours) || 2); }, 'Survey booked — surveyor notified')}>Book survey</button>
          <p className="hint">Double-booking the same surveyor is refused.</p>
        </Card>
      ) : null}

      {isOwner && open ? (
        <Card title="Close lead">
          <Field label="Close as">
            <select value={close.outcome} onChange={(e) => setClose({ ...close, outcome: e.target.value as 'lost' | 'invalid' })}>
              <option value="lost">Lost</option>
              <option value="invalid">Invalid enquiry</option>
            </select>
          </Field>
          {close.outcome === 'lost' ? (
            <Field label="Lost reason" required>
              <select value={close.lostReason} onChange={(e) => setClose({ ...close, lostReason: e.target.value as LostReason })}>
                <option value="">Select…</option>
                {LOST_REASONS.map((r) => <option key={r} value={r}>{pretty(r)}</option>)}
              </select>
            </Field>
          ) : null}
          <Field label="Explanation" required><input value={close.reason} onChange={(e) => setClose({ ...close, reason: e.target.value })} /></Field>
          <button className="btn danger block" onClick={() => act((s) => S.closeLead(s, user, id, close.outcome, close.lostReason, close.reason), 'Lead closed')}>Close lead</button>
        </Card>
      ) : null}

      {S.perms(user).has('lead.assign') && ['new', 'assigned', 'contacted', 'qualified', 'lost'].includes(lead.status) ? (
        <Card title={lead.status === 'new' ? 'Assign lead' : lead.status === 'lost' ? 'Reopen lead' : 'Reassign lead'}>
          <Field label="Sales owner" required>
            <select value={assignee.id} onChange={(e) => setAssignee({ ...assignee, id: e.target.value })}>
              {S.USERS.filter((u) => u.role === 'sales_executive').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Reason" required={lead.status !== 'new'}><input value={assignee.reason} onChange={(e) => setAssignee({ ...assignee, reason: e.target.value })} /></Field>
          <button className="btn block" onClick={() => act((s) => S.assignLead(s, user, id, assignee.id, assignee.reason), 'Lead assigned — owner notified')}>Save</button>
        </Card>
      ) : null}

      {!isOwner && S.perms(user).has('lead.read_all') ? <p className="hint">Owner view: read-only. Calls, qualification and closure belong to the lead's sales owner.</p> : null}

      <Card title="Communication history">
        {activities.length === 0 ? <p className="empty">No activities yet.</p> : null}
        {activities.map((x) => (
          <div key={x.id} className="history">
            <b>{pretty(x.type)}{x.outcome ? ` · ${pretty(x.outcome)}` : ''}</b> <span className="small muted">{dt(x.at)}</span>
            <div>{x.summary}</div>
            <div className="small muted">Next: {x.next ? dt(x.next) : `none — ${x.noActionReason}`}</div>
          </div>
        ))}
      </Card>
    </>
  );
}

/* --------------------------------- surveys -------------------------------- */

function Surveys({ ctx }: { ctx: Ctx }) {
  const { state, user, go } = ctx;
  const list = S.visibleSurveys(state, user);
  return (
    <>
      <h1>{user.role === 'surveyor' ? 'My surveys' : 'Surveys'}</h1>
      {list.length === 0 ? <p className="empty">No surveys visible to you.</p> : null}
      <ul className="list">
        {list.map((v) => (
          <li key={v.id}>
            <button className="item" onClick={() => go({ name: 'survey', id: v.id })}>
              <span className="item-title">{v.site}</span>
              <span className="mono small">{v.number}</span>
              <span className="small muted">{dt(v.start)} · {S.userById(v.surveyorId)?.name}</span>
              <span className="row"><StateChip kind="survey" state={v.status} /></span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

const SECTIONS: { key: string; title: string; fields: [string, string][] }[] = [
  { key: 'building', title: 'Building', fields: [['usage', 'Building usage'], ['floors', 'Floors'], ['stops', 'Stops'], ['construction_stage', 'Construction stage']] },
  { key: 'shaft', title: 'Shaft', fields: [['access_conditions', 'Access conditions'], ['obstructions', 'Obstructions']] },
  { key: 'machine_room', title: 'Machine room / drive', fields: [['availability', 'Availability (machine room / MRL)']] },
  { key: 'electrical', title: 'Electrical', fields: [['supply_type', 'Supply type'], ['phase', 'Phase (single / three)']] },
  { key: 'logistics', title: 'Logistics & safety', fields: [['material_access_route', 'Material access route'], ['safety_hazards', 'Safety hazards observed']] },
];
const M_LABELS: Record<string, string> = { shaft_width: 'Shaft width', shaft_depth: 'Shaft depth', pit_depth: 'Pit depth', overhead: 'Overhead', entrance_width: 'Entrance clear width', entrance_height: 'Entrance clear height' };

function getPosition(): Promise<{ permission: 'granted' | 'denied' | 'undetermined'; lat: number | null; lng: number | null; acc: number | null }> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve({ permission: 'undetermined', lat: null, lng: null, acc: null });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ permission: 'granted', lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => resolve({ permission: e.code === e.PERMISSION_DENIED ? 'denied' : 'granted', lat: null, lng: null, acc: null }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

function thumbnail(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas');
      const scale = 160 / Math.max(img.width, img.height);
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function SurveyDetail({ ctx, id }: { ctx: Ctx; id: string }) {
  const { state, user, go, act } = ctx;
  const v = S.visibleSurveys(state, user).find((x) => x.id === id);
  const [reason, setReason] = useState('');
  const [gpsReason, setGpsReason] = useState('');
  const [needsReason, setNeedsReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!v) return <Card title="Record not found"><p>It does not exist or is not shared with you.</p></Card>;
  const rev = S.currentRevision(v);
  const isSurveyor = v.surveyorId === user.id && S.perms(user).has('survey.capture');
  const editing = isSurveyor && v.status === 'in_progress';
  const g = S.gate1(v);

  const updateData = (section: string, field: string, value: string) =>
    act((s) => {
      const sv = s.surveys.find((x) => x.id === id)!;
      const r = S.currentRevision(sv);
      const data = { ...r.data, [section]: { ...(r.data[section] as Record<string, string> | undefined), [field]: value } };
      S.saveDraft(s, user, id, data, r.measurements);
    });
  const updateMeasure = (key: string, entered: string, unit: LengthUnit) =>
    act((s) => {
      const sv = s.surveys.find((x) => x.id === id)!;
      const r = S.currentRevision(sv);
      const n = Number(entered.replace(',', '.'));
      const rest = r.measurements.filter((m) => m.key !== key);
      S.saveDraft(s, user, id, r.data, entered.trim() && Number.isFinite(n) && n > 0 ? [...rest, { key, entered: n, unit }] : rest);
    });
  const docReason = (doc: string, text: string) =>
    act((s) => {
      const sv = s.surveys.find((x) => x.id === id)!;
      const r = S.currentRevision(sv);
      S.saveDraft(s, user, id, { ...r.data, documents_unavailable: { ...(r.data.documents_unavailable ?? {}), [doc]: text } }, r.measurements);
    });
  const capture = async (category: string, file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    const [thumb, pos] = await Promise.all([thumbnail(file), getPosition()]);
    setBusy(false);
    const gps = pos.lat !== null ? `GPS ±${Math.round(pos.acc ?? 0)} m` : pos.permission === 'denied' ? 'Location permission denied' : 'Location unavailable';
    act((s) => S.addEvidence(s, user, id, category, thumb, gps), `${pretty(category)} photo added`);
  };

  return (
    <>
      <button className="back" onClick={() => go({ name: 'surveys' })}>← Surveys</button>
      <h1>{v.site}</h1>
      <p className="row"><span className="mono small">{v.number}</span> <StateChip kind="survey" state={v.status} /> {rev.no > 1 ? <Chip tone="warn">Revision {rev.no}</Chip> : null}</p>
      <Card title="Assignment">
        <dl className="kv">
          <dt>When</dt><dd>{dt(v.start)} → {dt(v.end)}</dd>
          <dt>Scope</dt><dd>{v.scope}</dd>
          <dt>Site contact</dt><dd>{v.contactName}{v.contactPhone ? <> · <a href={`tel:${v.contactPhone}`}>{formatPhone(v.contactPhone)}</a></> : null}</dd>
          <dt>Surveyor</dt><dd>{S.userById(v.surveyorId)?.name}</dd>
          <dt>Check-in</dt><dd>{v.checkedInAt ? `${dt(v.checkedInAt)} · ${v.gpsStatus === 'verified' ? 'GPS verified' : `${pretty(v.gpsStatus ?? '')} — ${v.gpsReason}`}` : 'Not yet'}</dd>
        </dl>
        {v.statusReason ? <p className="warn-text">Note: {v.statusReason}</p> : null}
      </Card>

      {isSurveyor && v.status === 'scheduled' ? (
        <Card title="Accept assignment">
          <button className="btn block" onClick={() => act((s) => S.surveyAction(s, user, id, 'accept'), 'Survey accepted')}>Accept</button>
          <Field label="Reason (to request a reschedule)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <button className="btn secondary block" onClick={() => act((s) => S.surveyAction(s, user, id, 'request_reschedule', reason), 'Reschedule requested — sales notified')}>Request reschedule</button>
        </Card>
      ) : null}

      {isSurveyor && v.status === 'accepted' ? (
        <Card title="Site check-in">
          <p className="small">Records your location and accuracy from this phone. If location is unavailable you must explain why — a location is never invented.</p>
          {needsReason ? (
            <>
              <p className="warn-text">Location not verified ({pretty(needsReason)}).</p>
              <Field label="Why is location unavailable?" required><input value={gpsReason} onChange={(e) => setGpsReason(e.target.value)} /></Field>
            </>
          ) : null}
          <button
            className="btn block"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const pos = await getPosition();
              setBusy(false);
              const ok = act((s) => {
                S.checkIn(s, user, id, pos, gpsReason);
              }, 'Checked in');
              const gps = classifyGps({ permission: pos.permission, latitude: pos.lat, longitude: pos.lng, accuracyM: pos.acc });
              setNeedsReason(!ok && gps !== 'verified' ? gps : null);
            }}
          >
            {busy ? 'Getting location…' : 'Check in now'}
          </button>
          <Field label="Reason (if the site is inaccessible)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <button className="btn danger block" onClick={() => act((s) => S.surveyAction(s, user, id, 'report_inaccessible', reason), 'Reported — sales notified')}>Report site inaccessible</button>
        </Card>
      ) : null}

      {isSurveyor && v.status === 'revision_requested' ? (
        <Card title="Revision requested">
          <p>{v.statusReason}</p>
          <button className="btn block" onClick={() => act((s) => S.surveyAction(s, user, id, 'start_revision'), 'Revision started')}>Start revision</button>
        </Card>
      ) : null}

      {editing ? (
        <>
          {SECTIONS.map((sec) => (
            <Card key={sec.key} title={sec.title}>
              {sec.fields.map(([k, label]) => (
                <Field key={k} label={label} required={DEFAULT_SURVEY_REQUIREMENTS.required_fields.includes(`${sec.key}.${k}`)}>
                  <input
                    defaultValue={(rev.data[sec.key] as Record<string, string> | undefined)?.[k] ?? ''}
                    onBlur={(e) => updateData(sec.key, k, e.target.value)}
                    inputMode={k === 'floors' || k === 'stops' ? 'numeric' : undefined}
                    placeholder="Unknown / to be confirmed"
                  />
                </Field>
              ))}
            </Card>
          ))}
          <Card title="Measurements">
            <p className="hint">Enter each value with its unit. Stored in mm; your entered value and unit are kept. Range checks are hints, not engineering approval.</p>
            {Object.keys(M_LABELS).map((key) => {
              const m = rev.measurements.find((x) => x.key === key);
              const unit = m?.unit ?? 'mm';
              return (
                <div key={key} className="measure">
                  <Field label={`${M_LABELS[key]} (${unit})`} required>
                    <input inputMode="decimal" defaultValue={m ? String(m.entered) : ''} onBlur={(e) => updateMeasure(key, e.target.value, unit)} />
                  </Field>
                  <div className="units" role="radiogroup" aria-label={`Unit for ${M_LABELS[key]}`}>
                    {(['mm', 'cm', 'm'] as const).map((u) => (
                      <button key={u} role="radio" aria-checked={unit === u} className={unit === u ? 'unit on' : 'unit'} onClick={() => m && updateMeasure(key, String(m.entered), u)} disabled={!m}>
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </Card>
          <Card title="Photo evidence">
            <p className="hint">Opens the camera. Each photo records capture time and location.</p>
            {[...DEFAULT_SURVEY_REQUIREMENTS.required_evidence, 'machine_room', 'other'].map((cat) => {
              const n = v.evidence.filter((e) => e.category === cat && !e.superseded).length;
              return (
                <div key={cat} className="evidence-row">
                  <span>{pretty(cat)} {DEFAULT_SURVEY_REQUIREMENTS.required_evidence.includes(cat) ? <span className="req">*</span> : null} <span className="small muted">· {n} photo{n === 1 ? '' : 's'}</span></span>
                  <label className={`btn ${n ? 'secondary' : ''} small-btn`}>
                    {n ? 'Add' : 'Capture'}
                    <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void capture(cat, e.target.files?.[0])} />
                  </label>
                </div>
              );
            })}
          </Card>
          <Card title="Documents">
            <p className="hint">Photograph each drawing, or record why it is unavailable.</p>
            {DEFAULT_SURVEY_REQUIREMENTS.required_documents.map((doc) => {
              const n = v.evidence.filter((e) => e.category === doc).length;
              return (
                <div key={doc} className="doc">
                  <div className="evidence-row">
                    <span>{pretty(doc)} <span className="small muted">· {n ? 'attached' : 'missing'}</span></span>
                    <label className="btn secondary small-btn">
                      Photo
                      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void capture(doc, e.target.files?.[0])} />
                    </label>
                  </div>
                  {n === 0 ? <input placeholder="Or: why is it unavailable?" defaultValue={rev.data.documents_unavailable?.[doc] ?? ''} onBlur={(e) => docReason(doc, e.target.value)} /> : null}
                </div>
              );
            })}
          </Card>
          <Card title="Review and submit">
            <p className="small">Complete: <b>{g.completion.done}</b> of {g.completion.total}</p>
            {g.failures.map((f) => (
              <p key={f.message} className="crit-text">✗ {f.message}: {[...(f.fields ?? []), ...(f.missing ?? [])].map((x) => pretty(x.replace(/^measurement\./, ''))).join(', ')}</p>
            ))}
            {g.warnings.map((w) => <p key={w.key} className="warn-text">⚠ {w.message}</p>)}
            <button className="btn block" disabled={g.failures.length > 0} onClick={() => act((s) => S.submitSurvey(s, user, id), 'Submitted — technical review notified')}>Submit survey</button>
            <Field label="Reason (revisit / inaccessible)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <button className="btn secondary block" onClick={() => act((s) => S.surveyAction(s, user, id, 'request_revisit', reason), 'Revisit requested')}>Request revisit</button>
          </Card>
        </>
      ) : null}

      {!editing ? (
        <Card title={`Revision ${rev.no} (${rev.status})`}>
          {rev.reason ? <p className="warn-text">Reason for this revision: {rev.reason}</p> : null}
          {rev.measurements.length === 0 ? <p className="empty">No measurements yet.</p> : (
            <table className="tbl">
              <thead><tr><th>Measurement</th><th>mm</th><th>Entered</th></tr></thead>
              <tbody>
                {rev.measurements.map((m) => {
                  let mm = '—';
                  try {
                    mm = String(toMillimetres(m.entered, m.unit));
                  } catch {
                    /* invalid entry: shown as — */
                  }
                  return <tr key={m.key}><td>{M_LABELS[m.key] ?? m.key}</td><td className="mono">{mm}</td><td className="mono">{m.entered} {m.unit}</td></tr>;
                })}
              </tbody>
            </table>
          )}
          {v.evidence.length ? (
            <div className="thumbs">
              {v.evidence.map((e) => (
                <figure key={e.id}>
                  {e.thumb ? <img src={e.thumb} alt={pretty(e.category)} /> : <div className="nothumb">{pretty(e.category)}</div>}
                  <figcaption>{pretty(e.category)}<br />{e.gps}</figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {S.perms(user).has('survey.review') && ['submitted', 'under_review'].includes(v.status) ? (
        <Card title="Technical review">
          <Field label="What must be corrected or re-measured?" required><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <button className="btn block" onClick={() => act((s) => S.requestRevision(s, user, id, reason), 'Returned to the surveyor for revision')}>Return for revision</button>
          <p className="hint">Feasibility decisions and configuration approval come in Slice 3. The submitted version stays locked; corrections create a new revision.</p>
        </Card>
      ) : null}
    </>
  );
}

/* ------------------------------ audit & inbox ----------------------------- */

function Audit({ ctx }: { ctx: Ctx }) {
  const { state, user } = ctx;
  if (!S.perms(user).has('audit.read')) return <Card title="No access"><p>Only the Owner reads the audit log.</p></Card>;
  return (
    <>
      <h1>Audit log</h1>
      <p className="muted">Append-only record of every action, with the role used.</p>
      <ul className="list">
        {state.audit.map((x, i) => (
          <li key={i} className="audit">
            <b>{x.action}</b> · <span className="mono small">{x.entity}</span>
            <div className="small muted">{dt(x.at)} · {x.actor} as {t(`role.${x.role}`)}</div>
            {x.reason ? <div className="small">Reason: {x.reason}</div> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function Inbox({ ctx, setState }: { ctx: Ctx; setState: (s: DemoState) => void }) {
  const { state, user } = ctx;
  const mine = state.notices.filter((n) => n.to === user.id);
  return (
    <>
      <h1>Notifications</h1>
      {mine.length === 0 ? <p className="empty">You are all caught up.</p> : null}
      <ul className="list">
        {mine.map((n) => (
          <li key={n.id} className={n.read ? 'notice read' : 'notice'}>
            <div>{n.read ? null : <span className="sr-only">Unread: </span>}{n.text}</div>
            <div className="small muted">{dt(n.at)}</div>
            {!n.read ? (
              <button className="linkish" onClick={() => setState({ ...state, notices: state.notices.map((x) => (x.id === n.id ? { ...x, read: true } : x)) })}>Mark read</button>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function About({ reset }: { reset: () => void }) {
  return (
    <>
      <h1>About this demo</h1>
      <Card>
        <p>This page lets you try the AIEC Elevator OS workflow on your phone. It runs the <b>real business rules</b> of the product (workflow stages, permissions, duplicate detection, survey completeness gate, unit conversion, lead scoring) but uses <b>simulated data stored only in this browser</b>. Nothing is sent to a server, and nothing here is secure or shared.</p>
        <p>The real system runs on a server with a database that enforces every permission for every request. Example of the money format used across the system: {formatInr(1638878_40n)}.</p>
        <p className="small muted">All names, phone numbers and sites are fictional.</p>
      </Card>
      <button className="btn danger block" onClick={reset}>Reset demo data</button>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
